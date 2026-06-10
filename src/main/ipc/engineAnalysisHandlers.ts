/**
 * 引擎分析 IPC 處理器 (engineAnalysisHandlers)
 *
 * 註冊 main 端對 renderer 的引擎分析請求處理。
 */

import { ipcMain } from 'electron'
import { IPC, type EngineStatus } from '@shared/types/ipc'
import type { EngineAnalysisRequest } from '@shared/types/EngineAnalysis'
import { PikafishAdapter } from '../engine/PikafishAdapter'

export function registerEngineAnalysisHandlers(adapter: PikafishAdapter): void {
  ipcMain.handle(IPC.ENGINE_STATUS, (): EngineStatus => {
    const available = adapter.isAvailable()
    return {
      available,
      engineName: adapter.engineName,
      message: available
        ? undefined
        : '未偵測到 Pikafish 引擎。請設定 PIKAFISH_PATH 或放置 resources/engine/pikafish.exe。'
    }
  })

  ipcMain.handle(IPC.ENGINE_ANALYZE, async (_e, request: EngineAnalysisRequest) => {
    return adapter.analyze(request)
  })
}
