import type {
  AIModelInfo,
  AIProvider,
  AIProviderId,
  AITestCredentialResult
} from '@shared/types/AIProviderTypes'
import { PROVIDER_LABEL, isValidAIModelId } from '@shared/types/AIProviderTypes'
import type {
  AutoConfigureCredentialResult,
  SecretCredentialRef,
  SecretStatus
} from '@shared/types/ipc'
import { selectAutomaticModel } from '@shared/logic/ai/AutoCredential'
import { CREDENTIAL_TEST_TIMEOUT_MS, describeCredentialTestError } from './http'
import {
  OPENROUTER_CREDENTIAL_TEST_GENERATION_TIMEOUT_MS,
  OpenRouterProvider
} from './providers/OpenRouterProvider'
import type { SecretStore } from '../storage/SecretStore'
import {
  normalizeApiKey,
  SecurityValidationError
} from '../security/InputValidation'

export interface AutoConfigureCredentialDependencies {
  getProvider(provider: AIProviderId): AIProvider
  secretStore: Pick<SecretStore, 'setCredential' | 'getStatus'>
}

interface OpenRouterAdapter {
  listFreeModels(apiKey: string, timeoutMs?: number): Promise<AIModelInfo[]>
  testCredentialWithModels(
    apiKey: string,
    model: string,
    availableModels: readonly AIModelInfo[],
    timeoutMs?: number
  ): Promise<AITestCredentialResult>
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function failure(
  message: string,
  diagnostic: NonNullable<Extract<AutoConfigureCredentialResult, { ok: false }>['diagnostic']>
): Extract<AutoConfigureCredentialResult, { ok: false }> {
  return { ok: false, message, diagnostic }
}

function invalidInput(message: string): Extract<AutoConfigureCredentialResult, { ok: false }> {
  return failure(message, {
    stage: 'key',
    category: 'invalid_request',
    retryable: false,
    message
  })
}

function isOpenRouterAdapter(adapter: AIProvider): adapter is AIProvider & OpenRouterAdapter {
  return (
    adapter instanceof OpenRouterProvider ||
    (typeof (adapter as Partial<OpenRouterAdapter>).listFreeModels === 'function' &&
      typeof (adapter as Partial<OpenRouterAdapter>).testCredentialWithModels === 'function')
  )
}

function sameCredential(
  actual: SecretCredentialRef | null | undefined,
  expected: SecretCredentialRef
): boolean {
  return Boolean(
    actual &&
      actual.provider === expected.provider &&
      actual.model === expected.model &&
      (actual.baseUrl ?? '') === (expected.baseUrl ?? '')
  )
}

function storageFailure(message: string): Extract<AutoConfigureCredentialResult, { ok: false }> {
  return failure(message, {
    stage: 'storage',
    category: 'storage',
    retryable: true,
    message
  })
}

async function persistAndVerify(
  dependencies: AutoConfigureCredentialDependencies,
  credential: SecretCredentialRef,
  apiKey: string
): Promise<
  | { ok: true; status: SecretStatus }
  | { ok: false; result: Extract<AutoConfigureCredentialResult, { ok: false }> }
  > {
  try {
    await dependencies.secretStore.setCredential(
      credential.provider,
      credential.model,
      apiKey,
      credential.baseUrl
    )
    const status = await dependencies.secretStore.getStatus()
    if (!status.configured || !sameCredential(status.activeCredential, credential)) {
      return {
        ok: false,
        result: storageFailure(
          '實際生成驗證成功，但安全儲存後的啟用狀態不一致；新憑證未確認啟用，請重試。'
        )
      }
    }
    return { ok: true, status }
  } catch {
    return {
      ok: false,
      result: storageFailure(
        '實際生成驗證成功，但安全儲存失敗；新憑證未啟用，請重試。'
      )
    }
  }
}

function failedTest(result: AITestCredentialResult): Extract<AutoConfigureCredentialResult, { ok: false }> {
  return {
    ok: false,
    message: result.message,
    ...(result.diagnostic ? { diagnostic: result.diagnostic } : {})
  }
}

/**
 * 自動辨識、列出清單、實際生成驗證並安全儲存的 main-process 核心。
 * 這個純協調層由 IPC 呼叫，讓測試能以本機 HTTP fixture 覆蓋真正的連線順序。
 */
export async function autoConfigureCredential(
  rawInput: unknown,
  dependencies: AutoConfigureCredentialDependencies
): Promise<AutoConfigureCredentialResult> {
  const value = isRecord(rawInput) ? rawInput : {}
  let normalized: ReturnType<typeof normalizeApiKey>
  try {
    normalized = normalizeApiKey(value.apiKey)
  } catch (error) {
    if (error instanceof SecurityValidationError) {
      return invalidInput(error.message)
    }
    return invalidInput('API key 格式無效，請重新貼上。')
  }

  const { provider, apiKey } = normalized
  if (provider === 'openai-compatible') {
    return invalidInput('只支援 OpenAI、Anthropic、Google Gemini 與 OpenRouter 官方金鑰。')
  }

  const requestedModel = typeof value.model === 'string' ? value.model.trim() : ''
  if (requestedModel && !isValidAIModelId(requestedModel)) {
    return invalidInput('模型 ID 格式無效，請重新讀取模型清單。')
  }

  const adapter = dependencies.getProvider(provider)
  try {
    if (provider === 'openrouter') {
      if (!isOpenRouterAdapter(adapter)) {
        return failure('OpenRouter Provider 綁定錯誤。', {
          stage: 'catalog',
          category: 'unknown',
          retryable: false,
          message: 'OpenRouter Provider 綁定錯誤。'
        })
      }
      const models = await adapter.listFreeModels(apiKey, CREDENTIAL_TEST_TIMEOUT_MS)
      if (models.length === 0) {
        return failure(
          'OpenRouter 金鑰可連線，但官方目前沒有可用的具名免費文字模型。',
          {
            stage: 'catalog',
            category: 'model_unavailable',
            retryable: true,
            message: 'OpenRouter 金鑰可連線，但官方目前沒有可用的具名免費文字模型。'
          }
        )
      }
      if (!requestedModel) {
        return {
          ok: true,
          configured: false,
          provider,
          models,
          message: `OpenRouter 已連線；請選擇要使用的免費模型（目前 ${models.length} 個）。`
        }
      }
      const tested = await adapter.testCredentialWithModels(
        apiKey,
        requestedModel,
        models,
        OPENROUTER_CREDENTIAL_TEST_GENERATION_TIMEOUT_MS
      )
      if (!tested.ok) return failedTest(tested)

      const credential: SecretCredentialRef = {
        provider,
        model: requestedModel
      }
      const persisted = await persistAndVerify(dependencies, credential, apiKey)
      if (!persisted.ok) return persisted.result
      return {
        ok: true,
        configured: true,
        credential,
        status: persisted.status,
        message: `OpenRouter · ${requestedModel} 已通過實際生成驗證並安全儲存。`
      }
    }

    const availableModels = await adapter.listModels(apiKey, CREDENTIAL_TEST_TIMEOUT_MS)
    const model = selectAutomaticModel(provider, availableModels)
    if (!model) {
      return failure(
        '金鑰可連線，但目前帳號沒有本軟體支援的穩定文字生成模型。',
        {
          stage: 'catalog',
          category: 'model_unavailable',
          retryable: true,
          message: '金鑰可連線，但目前帳號沒有本軟體支援的穩定文字生成模型。'
        }
      )
    }
    // Gemini 的 models.list 已同時證明金鑰可用、模型可見且宣告支援生成；
    // 其他官方 provider 仍保留一次低用量生成驗證。
    if (provider !== 'gemini') {
      const tested = await adapter.testCredential(apiKey, model, undefined, CREDENTIAL_TEST_TIMEOUT_MS)
      if (!tested.ok) return failedTest(tested)
    }

    const credential: SecretCredentialRef = { provider, model }
    const persisted = await persistAndVerify(dependencies, credential, apiKey)
    if (!persisted.ok) return persisted.result
    return {
      ok: true,
      configured: true,
      credential,
      status: persisted.status,
      message: `${adapter.displayName} · ${model} 已通過官方模型與能力驗證並安全儲存。`
    }
  } catch (error) {
    const classified = describeCredentialTestError(
      error,
      PROVIDER_LABEL[provider],
      'catalog'
    )
    return failedTest(classified)
  }
}
