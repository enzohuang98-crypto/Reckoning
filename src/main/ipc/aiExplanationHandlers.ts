/**
 * AI 解釋 IPC 處理器 (aiExplanationHandlers)
 *
 * 註冊 AI 解釋與 SecretStore 的 IPC。
 * 金鑰流向：renderer 只負責 set/has/delete；解密與使用只在 main 內進行。
 */

import { ipcMain } from 'electron'
import { IPC } from '@shared/types/ipc'
import type { AIExplanationRequest } from '@shared/types/AIExplanationTypes'
import type { AIProviderId, AIProviderConfig } from '@shared/types/AIProviderTypes'
import { SecretStore } from '../storage/SecretStore'
import { createProvider } from '../ai/AIProvider'

export function registerAiExplanationHandlers(secretStore: SecretStore): void {
  // ---- SecretStore 通道 ----
  ipcMain.handle(IPC.SECRET_IS_AVAILABLE, (): boolean =>
    secretStore.isEncryptionAvailable()
  )

  ipcMain.handle(
    IPC.SECRET_SET,
    (_e, providerId: AIProviderId, apiKey: string): { ok: boolean } => {
      secretStore.setApiKey(providerId, apiKey)
      return { ok: true }
    }
  )

  ipcMain.handle(IPC.SECRET_HAS, (_e, providerId: AIProviderId): boolean =>
    secretStore.hasApiKey(providerId)
  )

  ipcMain.handle(
    IPC.SECRET_DELETE,
    (_e, providerId: AIProviderId): { ok: boolean } => {
      secretStore.deleteApiKey(providerId)
      return { ok: true }
    }
  )

  // ---- AI 解釋通道 ----
  ipcMain.handle(IPC.AI_EXPLAIN, async (_e, request: AIExplanationRequest) => {
    const apiKey = secretStore.getApiKey(request.provider)
    if (!apiKey) {
      throw new Error(
        `尚未設定 ${request.provider} 的 API 金鑰，請至設定頁輸入。`
      )
    }
    const config: AIProviderConfig = {
      providerId: request.provider,
      apiKey,
      model: request.model
    }
    const provider = createProvider(request.provider, config)
    return provider.generateExplanation(request)
  })
}
