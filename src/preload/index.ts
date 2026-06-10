/**
 * Preload 橋接 (Preload bridge)
 *
 * 透過 contextBridge 將型別安全的 window.api 暴露給 renderer。
 * renderer 永遠不直接接觸 Node / Electron / ipcRenderer。
 */

import { contextBridge, ipcRenderer } from 'electron'
import { IPC, type RendererApi } from '@shared/types/ipc'
import type { EngineAnalysisRequest } from '@shared/types/EngineAnalysis'
import type { AIExplanationRequest } from '@shared/types/AIExplanationTypes'
import type { AIProviderId } from '@shared/types/AIProviderTypes'

const api: RendererApi = {
  engine: {
    analyze: (request: EngineAnalysisRequest) =>
      ipcRenderer.invoke(IPC.ENGINE_ANALYZE, request),
    status: () => ipcRenderer.invoke(IPC.ENGINE_STATUS)
  },
  ai: {
    explain: (request: AIExplanationRequest) =>
      ipcRenderer.invoke(IPC.AI_EXPLAIN, request)
  },
  secret: {
    set: (providerId: AIProviderId, apiKey: string) =>
      ipcRenderer.invoke(IPC.SECRET_SET, providerId, apiKey),
    has: (providerId: AIProviderId) => ipcRenderer.invoke(IPC.SECRET_HAS, providerId),
    delete: (providerId: AIProviderId) =>
      ipcRenderer.invoke(IPC.SECRET_DELETE, providerId),
    isAvailable: () => ipcRenderer.invoke(IPC.SECRET_IS_AVAILABLE)
  }
}

contextBridge.exposeInMainWorld('api', api)
