/**
 * Electron 主行程進入點 (Main process entry)
 *
 * 負責建立視窗、載入 renderer、註冊 IPC 處理器。
 * 與 renderer 嚴格分離：renderer 只透過 preload 暴露的 window.api 溝通。
 */

import { app, BrowserWindow, shell } from 'electron'
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

const isDev = !app.isPackaged

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

function createWindow(rendererUrl: string): void {
  const mainWindow = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 1024,
    minHeight: 700,
    show: false,
    title: '象棋 AI 分析講解 - 啟動中',
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

  mainWindow.on('ready-to-show', () => mainWindow.show())
  lockDownWindow(mainWindow, rendererUrl, (url) => shell.openExternal(url))

  // electron-vite 提供的開發伺服器 URL 環境變數
  void mainWindow.loadURL(rendererUrl)
}

function registerIpc(): void {
  const storage = new StorageService()
  const engineRegistry = new EngineRegistryService(storage)
  const secretStore = new SecretStore()
  // 短期分析快取（SDS §2.18）：in-memory + TTL，啟動 10 分鐘定時清理
  const sessionStore = new InMemoryAnalysisSessionStore()
  startAnalysisSessionCleanup(sessionStore)
  registerEngineAnalysisHandlers(engineRegistry, sessionStore)
  registerAiExplanationHandlers(secretStore, sessionStore, engineRegistry, storage)
  registerDataHandlers(storage)
  // 買斷授權（SDS Q5）：離線 Ed25519 簽章驗證
  registerLicenseHandlers(new LicenseService(storage))
}

app.whenReady().then(() => {
  const rendererUrl = getRendererUrl()
  if (rendererUrl === PRODUCTION_RENDERER_URL) {
    registerRendererProtocol(join(__dirname, '../renderer'))
  }
  hardenDefaultSession(isDev)
  configureTrustedRendererUrl(rendererUrl)
  registerIpc()
  createWindow(rendererUrl)

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow(rendererUrl)
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
