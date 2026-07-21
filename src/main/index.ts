/**
 * Electron 主行程進入點 (Main process entry)
 *
 * 負責建立視窗、載入 renderer、註冊 IPC 處理器。
 * 與 renderer 嚴格分離：renderer 只透過 preload 暴露的 window.api 溝通。
 */

import { app, BrowserWindow, shell } from 'electron'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { EngineRegistryService } from './engine/EngineRegistryService'
import { SecretStore } from './storage/SecretStore'
import { StorageService } from './storage/StorageService'
import { registerEngineAnalysisHandlers } from './ipc/engineAnalysisHandlers'
import { registerAiExplanationHandlers } from './ipc/aiExplanationHandlers'
import { registerLicenseHandlers } from './ipc/licenseHandlers'
import { registerDataHandlers } from './ipc/dataHandlers'
import { LicenseService } from './license/LicenseService'
import {
  InMemoryAnalysisSessionStore,
  startAnalysisSessionCleanup
} from './storage/AnalysisSessionStore'
import {
  hardenDefaultSession,
  lockDownWindow,
  PRODUCTION_RENDERER_URL,
  registerRendererProtocol
} from './security/BrowserSecurity'
import { configureTrustedRendererUrl } from './security/IpcSecurity'
import { AppUpdaterService } from './update/AppUpdaterService'
import { startupFailurePageUrl } from './startup/StartupFailurePage'

const isDev = !app.isPackaged

// 單一實例鎖：多個實例同時使用同一個 userData 會互搶 Chromium Local State
// 與 localStorage 檔案鎖，最壞情況會讓 safeStorage 加密金鑰被重建、
// 導致已保存的 API 金鑰永遠無法解密。第二個實例直接退出並喚醒既有視窗。
if (!app.requestSingleInstanceLock()) {
  app.quit()
}

if (process.platform === 'win32') {
  app.setAppUserModelId('com.xiangqi.analyzer')
}

if (app.isPackaged) {
  app.commandLine.removeSwitch('remote-debugging-port')
  app.commandLine.removeSwitch('remote-debugging-pipe')
}

function getRendererUrl(): string {
  const devServerUrl = process.env['ELECTRON_RENDERER_URL']
  if (!isDev || !devServerUrl) return PRODUCTION_RENDERER_URL
  const url = new URL(devServerUrl)
  if (
    url.protocol !== 'http:' ||
    (url.hostname !== 'localhost' && url.hostname !== '127.0.0.1')
  ) {
    throw new Error('Development renderer URL must use localhost over HTTP.')
  }
  return url.toString()
}

let mainWindow: BrowserWindow | null = null

function createWindow(rendererUrl: string): void {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 1024,
    minHeight: 700,
    show: false,
    title: '象棋 AI 分析講解 - 啟動中',
    icon: app.isPackaged
      ? join(process.resourcesPath, 'icon.png')
      : join(process.cwd(), 'resources/packaging/icon.png'),
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: true,
      allowRunningInsecureContent: false,
      devTools: isDev,
      webviewTag: false,
      navigateOnDragDrop: false,
      spellcheck: false
    }
  })

  const window = mainWindow
  let rendererLoaded = false
  let startupFailureShown = false

  const showStartupFailure = async (): Promise<void> => {
    if (startupFailureShown || window.isDestroyed()) return
    startupFailureShown = true
    window.setTitle('象棋 AI 分析講解 - 啟動失敗')
    try {
      await window.loadURL(startupFailurePageUrl())
    } catch {
      // 即使錯誤頁本身無法載入，也要顯示視窗而不是留在背景無限等待。
    } finally {
      if (!window.isDestroyed()) window.show()
    }
  }

  window.on('ready-to-show', () => window.show())
  window.on('closed', () => {
    if (mainWindow === window) mainWindow = null
  })
  lockDownWindow(window, rendererUrl, (url) => shell.openExternal(url))
  window.webContents.on('did-finish-load', () => {
    if (window.webContents.getURL() === rendererUrl) rendererLoaded = true
  })
  window.webContents.on(
    'did-fail-load',
    (_event, _errorCode, _errorDescription, _validatedUrl, isMainFrame) => {
      if (isMainFrame && !rendererLoaded) void showStartupFailure()
    }
  )

  // electron-vite 提供的開發伺服器 URL 環境變數
  void window.loadURL(rendererUrl).catch(() => showStartupFailure())
}

function registerIpc(): AppUpdaterService {
  const storage = new StorageService()
  const packagedEnginePath = app.isPackaged
    ? join(process.resourcesPath, 'engine', 'pikafish.exe')
    : null
  const engineRegistry = new EngineRegistryService(
    storage,
    packagedEnginePath && existsSync(packagedEnginePath) ? packagedEnginePath : null
  )
  const secretStore = new SecretStore()
  // 短期分析快取（SDS §2.18）：in-memory + TTL，啟動 10 分鐘定時清理
  const sessionStore = new InMemoryAnalysisSessionStore()
  startAnalysisSessionCleanup(sessionStore)
  registerEngineAnalysisHandlers(engineRegistry, sessionStore)
  registerAiExplanationHandlers(secretStore, sessionStore, engineRegistry, storage)
  registerDataHandlers(storage)
  // 買斷授權（SDS Q5）：離線 Ed25519 簽章驗證
  registerLicenseHandlers(new LicenseService(storage))
  const appUpdater = new AppUpdaterService()
  appUpdater.registerIpc()
  return appUpdater
}

app.whenReady().then(() => {
  const rendererUrl = getRendererUrl()
  if (rendererUrl === PRODUCTION_RENDERER_URL) {
    registerRendererProtocol(join(__dirname, '../renderer'))
  }
  hardenDefaultSession(isDev)
  configureTrustedRendererUrl(rendererUrl)
  const appUpdater = registerIpc()
  createWindow(rendererUrl)
  appUpdater.startAutomaticCheck()

  app.on('second-instance', () => {
    if (!mainWindow) return
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.focus()
  })

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow(rendererUrl)
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
