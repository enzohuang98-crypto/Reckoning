/**
 * Electron 主行程進入點 (Main process entry)
 *
 * 負責建立視窗、載入 renderer、註冊 IPC 處理器。
 * 與 renderer 嚴格分離：renderer 只透過 preload 暴露的 window.api 溝通。
 */

import { app, BrowserWindow, shell } from 'electron'
import { join } from 'node:path'
import { PikafishAdapter } from './engine/PikafishAdapter'
import { SecretStore } from './storage/SecretStore'
import { registerEngineAnalysisHandlers } from './ipc/engineAnalysisHandlers'
import { registerAiExplanationHandlers } from './ipc/aiExplanationHandlers'

const isDev = !app.isPackaged

function createWindow(): void {
  const mainWindow = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 1024,
    minHeight: 700,
    show: false,
    title: '象棋 AI 分析講解',
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  mainWindow.on('ready-to-show', () => mainWindow.show())

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  // electron-vite 提供的開發伺服器 URL 環境變數
  const devServerUrl = process.env['ELECTRON_RENDERER_URL']
  if (isDev && devServerUrl) {
    mainWindow.loadURL(devServerUrl)
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

function registerIpc(): void {
  const adapter = new PikafishAdapter()
  const secretStore = new SecretStore()
  registerEngineAnalysisHandlers(adapter)
  registerAiExplanationHandlers(secretStore)
}

app.whenReady().then(() => {
  registerIpc()
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
