/**
 * Preload 橋接 (Preload bridge) — SDS v0.2 §2.16.1
 *
 * 透過 contextBridge 將型別安全的 window.api 暴露給 renderer。
 * renderer 永遠不直接接觸 Node / Electron / ipcRenderer。
 * 事件式通道（engine:analysis-result 等）以訂閱函式包裝，回傳取消訂閱。
 */

import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import {
  IPC,
  type AnalyzePositionStartPayload,
  type EngineAnalysisErrorPayload,
  type EngineAnalysisProgressPayload,
  type EngineAnalysisResultPayload,
  type GenerateExplanationChunkPayload,
  type GenerateExplanationDonePayload,
  type GenerateExplanationErrorPayload,
  type GenerateExplanationStartPayload,
  type RendererApi
} from '@shared/types/ipc'
import type { HarnessProgressPayload } from '@shared/types/Harness'
import type { AppUpdateStatus } from '@shared/types/AppUpdate'

/** 包裝 main→renderer 事件為「訂閱 + 取消訂閱」形式 */
function subscribe<T>(channel: string, listener: (payload: T) => void): () => void {
  const wrapped = (_event: IpcRendererEvent, payload: T): void => listener(payload)
  ipcRenderer.on(channel, wrapped)
  return () => ipcRenderer.removeListener(channel, wrapped)
}

const api: RendererApi = {
  engine: {
    startAnalysis: (payload: AnalyzePositionStartPayload) =>
      ipcRenderer.send(IPC.ENGINE_ANALYZE_POSITION_START, payload),
    onAnalysisProgress: (listener: (payload: EngineAnalysisProgressPayload) => void) =>
      subscribe(IPC.ENGINE_ANALYSIS_PROGRESS, listener),
    onAnalysisResult: (listener: (payload: EngineAnalysisResultPayload) => void) =>
      subscribe(IPC.ENGINE_ANALYSIS_RESULT, listener),
    onAnalysisError: (listener: (payload: EngineAnalysisErrorPayload) => void) =>
      subscribe(IPC.ENGINE_ANALYSIS_ERROR, listener),
    cancelAnalysis: (requestId: string) =>
      ipcRenderer.send(IPC.ENGINE_ANALYSIS_CANCEL, { requestId }),
    status: () => ipcRenderer.invoke(IPC.ENGINE_STATUS),
    getPath: () => ipcRenderer.invoke(IPC.ENGINE_GET_PATH),
    setPath: (path: string | null) => ipcRenderer.invoke(IPC.ENGINE_SET_PATH, path),
    browsePath: () => ipcRenderer.invoke(IPC.ENGINE_BROWSE_PATH),
    test: () => ipcRenderer.invoke(IPC.ENGINE_TEST),
    listInstallations: () => ipcRenderer.invoke(IPC.ENGINE_REGISTRY_LIST),
    addInstallation: (input) => ipcRenderer.invoke(IPC.ENGINE_REGISTRY_ADD, input),
    removeInstallation: (id) => ipcRenderer.invoke(IPC.ENGINE_REGISTRY_REMOVE, id),
    selectInstallation: (activeEngineId, verificationEngineId) =>
      ipcRenderer.invoke(IPC.ENGINE_REGISTRY_SELECT, {
        activeEngineId,
        verificationEngineId
      }),
    testInstallation: (id) => ipcRenderer.invoke(IPC.ENGINE_REGISTRY_TEST, id)
  },
  ai: {
    startExplanation: (payload: GenerateExplanationStartPayload) =>
      ipcRenderer.send(IPC.AI_GENERATE_EXPLANATION_START, payload),
    onExplanationChunk: (listener: (payload: GenerateExplanationChunkPayload) => void) =>
      subscribe(IPC.AI_GENERATE_EXPLANATION_CHUNK, listener),
    onExplanationDone: (listener: (payload: GenerateExplanationDonePayload) => void) =>
      subscribe(IPC.AI_GENERATE_EXPLANATION_DONE, listener),
    onExplanationError: (listener: (payload: GenerateExplanationErrorPayload) => void) =>
      subscribe(IPC.AI_GENERATE_EXPLANATION_ERROR, listener),
    onHarnessProgress: (listener: (payload: HarnessProgressPayload) => void) =>
      subscribe(IPC.AI_HARNESS_PROGRESS, listener),
    listHarnessTraces: () => ipcRenderer.invoke(IPC.AI_HARNESS_TRACE_LIST),
    clearHarnessTraces: () => ipcRenderer.invoke(IPC.AI_HARNESS_TRACE_CLEAR),
    exportHarnessTraces: () => ipcRenderer.invoke(IPC.AI_HARNESS_TRACE_EXPORT),
    setHarnessFeedback: (traceId, feedback) =>
      ipcRenderer.invoke(IPC.AI_HARNESS_TRACE_FEEDBACK, { traceId, feedback }),
    cancelExplanation: (requestId: string) =>
      ipcRenderer.send(IPC.AI_GENERATE_EXPLANATION_CANCEL, { requestId })
  },
  data: {
    load: () => ipcRenderer.invoke(IPC.DATA_LOAD),
    save: (snapshot) => ipcRenderer.invoke(IPC.DATA_SAVE, snapshot),
    exportBackup: () => ipcRenderer.invoke(IPC.DATA_EXPORT),
    importBackup: () => ipcRenderer.invoke(IPC.DATA_IMPORT)
  },
  secret: {
    set: (apiKey: string) => ipcRenderer.invoke(IPC.SECRET_SET, apiKey),
    status: () => ipcRenderer.invoke(IPC.SECRET_STATUS),
    delete: () => ipcRenderer.invoke(IPC.SECRET_DELETE),
    isAvailable: () => ipcRenderer.invoke(IPC.SECRET_IS_AVAILABLE)
  },
  license: {
    status: () => ipcRenderer.invoke(IPC.LICENSE_STATUS),
    activate: (licenseKey: string) => ipcRenderer.invoke(IPC.LICENSE_ACTIVATE, licenseKey),
    deactivate: () => ipcRenderer.invoke(IPC.LICENSE_DEACTIVATE)
  },
  update: {
    status: () => ipcRenderer.invoke(IPC.APP_UPDATE_STATUS),
    check: () => ipcRenderer.invoke(IPC.APP_UPDATE_CHECK),
    download: () => ipcRenderer.invoke(IPC.APP_UPDATE_DOWNLOAD),
    install: () => ipcRenderer.invoke(IPC.APP_UPDATE_INSTALL),
    onChanged: (listener: (status: AppUpdateStatus) => void) =>
      subscribe(IPC.APP_UPDATE_CHANGED, listener)
  }
}

contextBridge.exposeInMainWorld('api', api)
