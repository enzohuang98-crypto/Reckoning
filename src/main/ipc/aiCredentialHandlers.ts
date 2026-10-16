/**
 * API 憑證與模型設定通道：secret:*（加密金鑰的 set/status/activate/delete）、單一金鑰自動設定、
 * OpenRouter 已存模型清單／切換／備援模型，以及低用量的金鑰測試。
 *
 * 金鑰流向：renderer 只負責 set/has/delete/test；解密與使用只在 main 內進行，API key 不得被 log（§2.11）。
 * 同一把金鑰的測試以 sha256 摘要作為併發閘門的鍵，最多同時 2 個。
 */

import { createHash } from 'node:crypto'
import { ipcMain } from 'electron'
import {
  IPC,
  type AutoConfigureCredentialResult,
  type OpenRouterBackupModelsResult,
  type SavedOpenRouterModelsResult,
  type SecretCredentialRef,
  type SecretMutationResult,
  type SwitchSavedOpenRouterModelResult,
  type TestCredentialResult
} from '@shared/types/ipc'
import type { SecretStore } from '../storage/SecretStore'
import { getAIProvider } from '../ai/AIProvider'
import { autoConfigureCredential } from '../ai/autoConfigureCredential'
import { OpenRouterSavedModelService } from '../ai/switchOpenRouterModel'
import {
  type AiPreferencesStore,
  validateOpenRouterBackupModels
} from '../ai/AiPreferencesStore'
import { describeCredentialTestError } from '../ai/http'
import { modelRegistry } from '../ai/ModelRegistry'
import { logger } from '../logger'
import { assertTrustedIpcSender } from '../security/IpcSecurity'
import {
  isLoopbackAiBaseUrl,
  normalizeAiBaseUrl,
  normalizeApiKey,
  normalizeProviderId,
  SecurityValidationError
} from '../security/InputValidation'
import {
  KeyedOperationGate,
  OperationBusyError
} from '../security/KeyedOperationGate'

export function registerAiCredentialHandlers(
  secretStore: SecretStore,
  aiPreferences: () => AiPreferencesStore
): void {
  const credentialTestGate = new KeyedOperationGate(2)
  const savedOpenRouterModels = new OpenRouterSavedModelService(secretStore)

  const normalizeCredential = (rawInput: unknown): SecretCredentialRef => {
    if (typeof rawInput !== 'object' || rawInput === null) {
      throw new SecurityValidationError('API 憑證格式無效。')
    }
    const value = rawInput as Record<string, unknown>
    const provider = normalizeProviderId(value.provider)
    if (typeof value.model !== 'string') {
      throw new SecurityValidationError('模型 ID 格式無效。')
    }
    const model = modelRegistry.getModel(provider, value.model.trim()).model
    const baseUrl =
      provider === 'openai-compatible'
        ? normalizeAiBaseUrl(value.baseUrl)
        : undefined
    return { provider, model, ...(baseUrl ? { baseUrl } : {}) }
  }

  const normalizeSavedOpenRouterSource = (rawInput: unknown): SecretCredentialRef => {
    if (typeof rawInput !== 'object' || rawInput === null) {
      throw new SecurityValidationError('OpenRouter 模型操作格式無效。')
    }
    const value = rawInput as Record<string, unknown>
    const rawSource = value.sourceCredential
    if (typeof rawSource !== 'object' || rawSource === null) {
      throw new SecurityValidationError('OpenRouter 來源憑證格式無效。')
    }
    const source = rawSource as Record<string, unknown>
    if (
      source.provider !== 'openrouter' ||
      typeof source.model !== 'string' ||
      source.baseUrl !== undefined
    ) {
      throw new SecurityValidationError('只允許使用沒有自訂網址的 OpenRouter 已存憑證。')
    }
    const model = modelRegistry.getModel('openrouter', source.model.trim()).model
    return { provider: 'openrouter', model }
  }

  // ---- SecretStore 通道 ----
  ipcMain.handle(IPC.SECRET_IS_AVAILABLE, (event): boolean => {
    assertTrustedIpcSender(event)
    return secretStore.isEncryptionAvailable()
  })

  ipcMain.handle(
    IPC.SECRET_SET,
    async (
      event,
      rawInput: unknown
    ): Promise<SecretMutationResult> => {
      assertTrustedIpcSender(event)
      const credential = normalizeCredential(rawInput)
      const value = rawInput as Record<string, unknown>
      const { apiKey } = normalizeApiKey(value.apiKey, credential.provider)
      await secretStore.setCredential(
        credential.provider,
        credential.model,
        apiKey,
        credential.baseUrl
      )
      return { ok: true, status: await secretStore.getStatus() }
    }
  )

  ipcMain.handle(
    IPC.SECRET_ACTIVATE,
    async (event, rawInput: unknown): Promise<SecretMutationResult> => {
      assertTrustedIpcSender(event)
      const credential = normalizeCredential(rawInput)
      if (!(await secretStore.setActiveCredential(
        credential.provider,
        credential.model,
        credential.baseUrl
      ))) {
        throw new SecurityValidationError('所選 API 憑證不存在或無法解密。')
      }
      return { ok: true, status: await secretStore.getStatus() }
    }
  )

  ipcMain.handle(IPC.SECRET_STATUS, async (event) => {
    assertTrustedIpcSender(event)
    return await secretStore.getStatus()
  })

  ipcMain.handle(
    IPC.SECRET_DELETE,
    async (event, rawInput: unknown): Promise<SecretMutationResult> => {
      assertTrustedIpcSender(event)
      const credential = normalizeCredential(rawInput)
      await secretStore.deleteCredential(
        credential.provider,
        credential.model,
        credential.baseUrl
      )
      return { ok: true, status: await secretStore.getStatus() }
    }
  )

  // ---- 單一金鑰自動辨識、列出實際可用模型、驗證並儲存 ----
  ipcMain.handle(
    IPC.AI_AUTO_CONFIGURE_CREDENTIAL,
    async (event, rawInput: unknown): Promise<AutoConfigureCredentialResult> => {
      assertTrustedIpcSender(event)
      const value =
        typeof rawInput === 'object' && rawInput !== null
          ? (rawInput as Record<string, unknown>)
          : {}
      const apiKeyForGate =
        typeof value.apiKey === 'string' ? value.apiKey.trim() : ''
      const requestedModel =
        typeof value.model === 'string' ? value.model.trim() : ''
      const digest = createHash('sha256').update(apiKeyForGate).digest('hex')
      try {
        return await credentialTestGate.run(
          `auto\u001f${digest}\u001f${requestedModel}`,
          () =>
            autoConfigureCredential(rawInput, {
              getProvider: getAIProvider,
              secretStore
            })
        )
      } catch (error) {
        if (error instanceof OperationBusyError) {
          return { ok: false, message: '已有金鑰連線測試進行中，請稍後再試。' }
        }
        logger.warn('AI credential auto configuration failed', {
          error: error instanceof Error ? error.name : 'unknown'
        })
        const classified = describeCredentialTestError(error, 'AI', 'key')
        return {
          ok: false,
          message: classified.message,
          ...(classified.diagnostic
            ? { diagnostic: classified.diagnostic }
            : {})
        }
      }
    }
  )

  ipcMain.handle(
    IPC.AI_OPENROUTER_SAVED_MODELS,
    async (event, rawInput: unknown): Promise<SavedOpenRouterModelsResult> => {
      assertTrustedIpcSender(event)
      const source = normalizeSavedOpenRouterSource(rawInput)
      return await savedOpenRouterModels.listModels(source)
    }
  )

  ipcMain.handle(
    IPC.AI_OPENROUTER_SWITCH_MODEL,
    async (event, rawInput: unknown): Promise<SwitchSavedOpenRouterModelResult> => {
      assertTrustedIpcSender(event)
      const source = normalizeSavedOpenRouterSource(rawInput)
      const value = rawInput as Record<string, unknown>
      if (typeof value.targetModel !== 'string') {
        throw new SecurityValidationError('目標模型格式無效。')
      }
      const targetModel = modelRegistry.getModel(
        'openrouter',
        value.targetModel.trim()
      ).model
      if (
        typeof value.operationId !== 'string' ||
        !/^[A-Za-z0-9._:-]{1,128}$/.test(value.operationId)
      ) {
        throw new SecurityValidationError('操作識別碼格式無效。')
      }
      return await savedOpenRouterModels.switchModel(
        source,
        targetModel,
        value.operationId
      )
    }
  )

  ipcMain.handle(
    IPC.AI_OPENROUTER_GET_BACKUP_MODELS,
    async (event): Promise<OpenRouterBackupModelsResult> => {
      assertTrustedIpcSender(event)
      return { ok: true, models: (await aiPreferences().get()).openRouterBackupModels }
    }
  )

  ipcMain.handle(
    IPC.AI_OPENROUTER_SET_BACKUP_MODELS,
    async (event, rawInput: unknown): Promise<OpenRouterBackupModelsResult> => {
      assertTrustedIpcSender(event)
      const source = normalizeSavedOpenRouterSource(rawInput)
      const requested = (rawInput as Record<string, unknown>).models
      if (Array.isArray(requested) && requested.length === 0) {
        await aiPreferences().setOpenRouterBackupModels([])
        return { ok: true, models: [] }
      }
      // 只接受這把已存金鑰此刻讀得到的免費模型；renderer 無法塞入任意模型。
      const listed = await savedOpenRouterModels.listModels(source)
      if (!listed.ok) return { ok: false, message: listed.message }
      const validation = validateOpenRouterBackupModels(
        requested,
        source.model,
        listed.models.map((model) => model.id)
      )
      if (!validation.ok) return validation
      await aiPreferences().setOpenRouterBackupModels(validation.models)
      return { ok: true, models: validation.models }
    }
  )

  // ---- 低用量實際推論測試（不落地草稿金鑰） ----
  ipcMain.handle(
    IPC.AI_TEST_CREDENTIAL,
    async (event, rawInput: unknown): Promise<TestCredentialResult> => {
      assertTrustedIpcSender(event)
      const credential = normalizeCredential(rawInput)
      const value = rawInput as Record<string, unknown>
      let apiKey: string
      if (typeof value.apiKey === 'string' && value.apiKey.trim()) {
        apiKey = normalizeApiKey(value.apiKey, credential.provider).apiKey
      } else {
        const stored = await secretStore.getCredential(
          credential.provider,
          credential.model,
          credential.baseUrl
        )
        if (stored) {
          apiKey = stored
        } else if (
          credential.provider === 'openai-compatible' &&
          isLoopbackAiBaseUrl(credential.baseUrl)
        ) {
          apiKey = ''
        } else {
          return { ok: false, message: '尚未設定金鑰，請先貼上金鑰再測試。' }
        }
      }
      const apiKeyDigest = createHash('sha256').update(apiKey).digest('hex')
      const admissionKey = [
        credential.provider,
        credential.model,
        credential.baseUrl ?? '',
        apiKeyDigest
      ].join('\u001f')
      try {
        return await credentialTestGate.run(admissionKey, () =>
          getAIProvider(credential.provider).testCredential(
            apiKey,
            credential.model,
            credential.baseUrl
          )
        )
      } catch (error) {
        if (error instanceof OperationBusyError) {
          return {
            ok: false,
            message: '同時測試工作過多，請等目前測試完成後再試。'
          }
        }
        throw error
      }
    }
  )
}
