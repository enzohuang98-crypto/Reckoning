/**
 * 引擎分析 IPC 處理器 (engineAnalysisHandlers)
 *
 * 註冊 main 端對 renderer 的引擎分析請求處理，並管理使用者自訂引擎路徑。
 * 引擎路徑屬「一般設定」（非機密），以 StorageService 持久化於 userData，
 * 啟動時讀取後注入 PikafishAdapter。
 */

import { dialog, ipcMain } from 'electron'
import { IPC, type EngineStatus } from '@shared/types/ipc'
import type { EngineAnalysisRequest } from '@shared/types/EngineAnalysis'
import { PikafishAdapter } from '../engine/PikafishAdapter'
import type { StorageService } from '../storage/StorageService'

/** 引擎設定持久化檔名（userData 下） */
export const ENGINE_CONFIG_FILE = 'engine-config.json'

interface EngineConfig {
  /** 使用者於設定頁指定的引擎路徑（null 表示未設定，沿用環境變數 / 資源） */
  enginePath: string | null
}

/** 由 StorageService 讀取已存的使用者引擎路徑（供啟動時注入 adapter）。 */
export function loadEnginePath(storage: StorageService): string | null {
  return storage.read<EngineConfig>(ENGINE_CONFIG_FILE, { enginePath: null }).enginePath
}

function buildStatus(adapter: PikafishAdapter): EngineStatus {
  const available = adapter.isAvailable()
  return {
    available,
    engineName: adapter.engineName,
    pathSource: adapter.pathSource(),
    resolvedPath: adapter.resolveEnginePath(),
    message: available
      ? undefined
      : '未偵測到 Pikafish 引擎。請於下方指定引擎路徑，或設定 PIKAFISH_PATH / 放置 resources/engine/pikafish.exe。'
  }
}

export function registerEngineAnalysisHandlers(
  adapter: PikafishAdapter,
  storage: StorageService
): void {
  ipcMain.handle(IPC.ENGINE_STATUS, (): EngineStatus => buildStatus(adapter))

  ipcMain.handle(IPC.ENGINE_ANALYZE, async (_e, request: EngineAnalysisRequest) => {
    return adapter.analyze(request)
  })

  ipcMain.handle(IPC.ENGINE_GET_PATH, (): string | null => adapter.getUserPath())

  ipcMain.handle(
    IPC.ENGINE_SET_PATH,
    (_e, path: string | null): EngineStatus => {
      const normalized = path && path.trim() ? path.trim() : null
      adapter.setUserPath(normalized)
      storage.write<EngineConfig>(ENGINE_CONFIG_FILE, { enginePath: normalized })
      return buildStatus(adapter)
    }
  )

  ipcMain.handle(IPC.ENGINE_BROWSE_PATH, async (): Promise<string | null> => {
    const result = await dialog.showOpenDialog({
      title: '選擇 Pikafish 引擎可執行檔',
      properties: ['openFile'],
      filters:
        process.platform === 'win32'
          ? [{ name: '可執行檔', extensions: ['exe'] }, { name: '所有檔案', extensions: ['*'] }]
          : [{ name: '所有檔案', extensions: ['*'] }]
    })
    if (result.canceled || result.filePaths.length === 0) return null
    return result.filePaths[0]
  })
}
