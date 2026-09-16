import type { AIModelInfo, AITestCredentialResult } from '@shared/types/AIProviderTypes'
import type {
  SavedOpenRouterModelsResult,
  SecretCredentialRef,
  SwitchSavedOpenRouterModelResult
} from '@shared/types/ipc'
import {
  SecretCredentialChangedError,
  SecretCredentialConflictError,
  type SecretCredentialSnapshot,
  type SecretStore
} from '../storage/SecretStore'
import { describeCredentialTestError } from './http'
import { OpenRouterProvider } from './providers/OpenRouterProvider'

interface OpenRouterSwitchProvider {
  listFreeModels(apiKey: string): Promise<AIModelInfo[]>
  testCredentialWithModels(
    apiKey: string,
    model: string,
    availableModels: readonly AIModelInfo[]
  ): Promise<AITestCredentialResult>
}

interface OpenRouterSwitchStore {
  captureActiveCredential(
    expected?: SecretCredentialRef
  ): Promise<SecretCredentialSnapshot | null>
  rebindOpenRouterCredential(
    snapshot: SecretCredentialSnapshot,
    targetModel: string
  ): Promise<SecretCredentialRef>
  getStatus(): ReturnType<SecretStore['getStatus']>
}

interface PendingOperation {
  sourceId: string
  targetModel: string
  promise: Promise<SwitchSavedOpenRouterModelResult>
}

function sourceId(source: SecretCredentialRef): string {
  return `${source.provider}\u001f${source.model}\u001f${source.baseUrl ?? ''}`
}

function changedResult(): SwitchSavedOpenRouterModelResult {
  return {
    ok: false,
    code: 'credential_changed',
    message: '目前使用中的 OpenRouter 憑證已變更，請重新讀取模型清單。'
  }
}

export class OpenRouterSavedModelService {
  private readonly operations = new Map<string, PendingOperation>()
  private readonly busySources = new Set<string>()

  constructor(
    private readonly store: OpenRouterSwitchStore,
    private readonly provider: OpenRouterSwitchProvider = new OpenRouterProvider()
  ) {}

  async listModels(
    source: SecretCredentialRef
  ): Promise<SavedOpenRouterModelsResult> {
    const snapshot = await this.store.captureActiveCredential(source)
    if (!snapshot) {
      return {
        ok: false,
        code: 'credential_changed',
        message: '目前使用中的 OpenRouter 憑證已變更，請重新整理設定。'
      }
    }
    try {
      const models = await this.provider.listFreeModels(snapshot.apiKey)
      const current = await this.store.captureActiveCredential(source)
      if (
        !current ||
        current.revision !== snapshot.revision ||
        current.apiKey !== snapshot.apiKey
      ) {
        return {
          ok: false,
          code: 'credential_changed',
          message: '目前使用中的 OpenRouter 憑證已變更，請重新讀取模型清單。'
        }
      }
      if (models.length === 0) {
        return {
          ok: false,
          code: 'catalog_unavailable',
          message: '目前沒有可用的具名免費文字模型，請稍後重新讀取。',
          diagnostic: {
            stage: 'catalog',
            category: 'model_unavailable',
            retryable: true,
            message: '目前沒有可用的具名免費文字模型，請稍後重新讀取。'
          }
        }
      }
      return { ok: true, models, status: await this.store.getStatus() }
    } catch (error) {
      const classified = describeCredentialTestError(error, 'OpenRouter', 'catalog')
      return {
        ok: false,
        code: 'catalog_unavailable',
        message: classified.message,
        ...(classified.diagnostic ? { diagnostic: classified.diagnostic } : {})
      }
    }
  }

  switchModel(
    source: SecretCredentialRef,
    targetModel: string,
    operationId: string
  ): Promise<SwitchSavedOpenRouterModelResult> {
    const id = sourceId(source)
    const existing = this.operations.get(operationId)
    if (existing) {
      if (existing.sourceId !== id || existing.targetModel !== targetModel) {
        return Promise.resolve({
          ok: false,
          code: 'validation_failed',
          message: '操作識別碼已用於不同的模型切換。'
        })
      }
      return existing.promise
    }
    if (this.busySources.has(id)) {
      return Promise.resolve({
        ok: false,
        code: 'operation_busy',
        message: '這把 OpenRouter 憑證已有模型切換進行中，請等待完成。'
      })
    }

    this.busySources.add(id)
    const promise = this.performSwitch(source, targetModel).finally(() => {
      this.busySources.delete(id)
      while (this.operations.size > 64) {
        const oldest = this.operations.keys().next().value as string | undefined
        if (!oldest) break
        this.operations.delete(oldest)
      }
    })
    this.operations.set(operationId, { sourceId: id, targetModel, promise })
    return promise
  }

  private async performSwitch(
    source: SecretCredentialRef,
    targetModel: string
  ): Promise<SwitchSavedOpenRouterModelResult> {
    const snapshot = await this.store.captureActiveCredential(source)
    if (!snapshot) return changedResult()
    try {
      const models = await this.provider.listFreeModels(snapshot.apiKey)
      const tested = await this.provider.testCredentialWithModels(
        snapshot.apiKey,
        targetModel,
        models
      )
      if (!tested.ok) {
        return {
          ok: false,
          code: 'validation_failed',
          message: tested.message,
          ...(tested.diagnostic ? { diagnostic: tested.diagnostic } : {})
        }
      }
      const credential = await this.store.rebindOpenRouterCredential(
        snapshot,
        targetModel
      )
      return {
        ok: true,
        credential,
        status: await this.store.getStatus(),
        message: `已改用 ${targetModel}；下一次明確提交才會使用新模型。`
      }
    } catch (error) {
      if (error instanceof SecretCredentialChangedError) return changedResult()
      if (error instanceof SecretCredentialConflictError) {
        return {
          ok: false,
          code: 'credential_conflict',
          message: '目標模型已有不同的 OpenRouter 金鑰；原有憑證均未覆寫，請改選其他模型。'
        }
      }
      const classified = describeCredentialTestError(error, 'OpenRouter', 'storage')
      const storageFailure = classified.diagnostic?.stage === 'storage'
      return {
        ok: false,
        code: storageFailure ? 'storage_failed' : 'validation_failed',
        message: classified.message,
        ...(classified.diagnostic ? { diagnostic: classified.diagnostic } : {})
      }
    }
  }
}
