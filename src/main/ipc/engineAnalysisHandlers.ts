/**
 * 引擎分析 IPC 處理器 (engineAnalysisHandlers)
 *
 * 註冊 main 端對 renderer 的引擎分析請求處理，並管理使用者自訂引擎路徑。
 * 引擎路徑屬「一般設定」（非機密），以 StorageService 持久化於 userData，
 * 啟動時讀取後注入 PikafishAdapter。
 */

import { dialog, ipcMain } from 'electron'
import { IPC, type EngineStatus, type EngineTestResult } from '@shared/types/ipc'
import type {
  EngineAnalysisRequest,
  EngineProtocol
} from '@shared/types/EngineAnalysis'
import { PikafishAdapter } from '../engine/PikafishAdapter'
import type { StorageService } from '../storage/StorageService'

/** 引擎設定持久化檔名（userData 下） */
export const ENGINE_CONFIG_FILE = 'engine-config.json'

export interface EngineConfig {
  /** 使用者於設定頁指定的引擎路徑（null 表示未設定，沿用環境變數 / 資源） */
  enginePath: string | null
  /** 先前偵測到的引擎協定（null 表示未偵測，下次連線自動偵測） */
  engineProtocol: EngineProtocol | null
}

const DEFAULT_ENGINE_CONFIG: EngineConfig = { enginePath: null, engineProtocol: null }

/** 由 StorageService 讀取已存的引擎設定（供啟動時注入 adapter）。 */
export function loadEngineConfig(storage: StorageService): EngineConfig {
  return { ...DEFAULT_ENGINE_CONFIG, ...storage.read<EngineConfig>(ENGINE_CONFIG_FILE, DEFAULT_ENGINE_CONFIG) }
}

function buildStatus(adapter: PikafishAdapter): EngineStatus {
  const available = adapter.isAvailable()
  return {
    available,
    engineName: adapter.engineName,
    pathSource: adapter.pathSource(),
    resolvedPath: adapter.resolveEnginePath(),
    protocol: adapter.getKnownProtocol(),
    message: available
      ? undefined
      : '未偵測到引擎。請於下方指定引擎路徑，或設定 PIKAFISH_PATH / 放置 resources/engine/pikafish.exe。'
  }
}

export function registerEngineAnalysisHandlers(
  adapter: PikafishAdapter,
  storage: StorageService
): void {
  const persistConfig = (): void => {
    storage.write<EngineConfig>(ENGINE_CONFIG_FILE, {
      enginePath: adapter.getUserPath(),
      engineProtocol: adapter.getKnownProtocol()
    })
  }

  // 自動偵測到協定（UCI/UCCI）時持久化，下次啟動直接以已知協定握手
  adapter.onProtocolDetected(() => persistConfig())

  ipcMain.handle(IPC.ENGINE_STATUS, (): EngineStatus => buildStatus(adapter))

  ipcMain.handle(IPC.ENGINE_ANALYZE, async (_e, request: EngineAnalysisRequest) => {
    return adapter.analyze(request)
  })

  ipcMain.handle(IPC.ENGINE_GET_PATH, (): string | null => adapter.getUserPath())

  ipcMain.handle(
    IPC.ENGINE_SET_PATH,
    (_e, path: string | null): EngineStatus => {
      const normalized = path && path.trim() ? path.trim() : null
      const pathChanged = normalized !== adapter.getUserPath()
      adapter.setUserPath(normalized)
      // 換了引擎檔就重置已知協定，下次連線重新偵測
      if (pathChanged) adapter.setKnownProtocol(null)
      persistConfig()
      return buildStatus(adapter)
    }
  )

  ipcMain.handle(IPC.ENGINE_TEST, (): Promise<EngineTestResult> => adapter.test())

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
