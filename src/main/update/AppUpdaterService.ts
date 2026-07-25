import { app, BrowserWindow, ipcMain } from 'electron'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import electronUpdater, {
  type AppUpdater,
  type ProgressInfo,
  type UpdateInfo
} from 'electron-updater'
import { IPC } from '@shared/types/ipc'
import type { AppUpdateStatus } from '@shared/types/AppUpdate'
import { logger } from '../logger'
import { assertTrustedIpcSender } from '../security/IpcSecurity'

/** 啟動後第一次檢查的延遲；讓視窗先完成初始渲染。 */
const FIRST_CHECK_DELAY_MS = 5_000
/**
 * 之後每隔多久重新檢查一次。先前只在啟動後檢查一次，長時間開著不關的
 * App 永遠不會發現後來發布的版本。
 */
const RECHECK_INTERVAL_MS = 4 * 60 * 60 * 1000

function getAutoUpdater(): AppUpdater {
  const { autoUpdater } = electronUpdater
  return autoUpdater
}

function hasPackagedUpdateConfiguration(): boolean {
  return app.isPackaged && existsSync(join(process.resourcesPath, 'app-update.yml'))
}

export class AppUpdaterService {
  private readonly updater = getAutoUpdater()
  private configured = false
  private status: AppUpdateStatus

  constructor() {
    const supported = process.platform === 'win32' && app.isPackaged
    this.configured = supported && hasPackagedUpdateConfiguration()
    this.status = {
      phase: supported ? (this.configured ? 'idle' : 'unconfigured') : 'unsupported',
      currentVersion: app.getVersion(),
      automaticChecksEnabled: this.configured,
      message: supported
        ? this.configured
          ? '程式會在啟動後自動檢查更新。'
          : '尚未設定正式更新來源，請使用最新版安裝程式更新。'
        : '開發模式不執行自動更新。'
    }

    if (!this.configured) return

    this.updater.autoDownload = false
    this.updater.autoInstallOnAppQuit = true
    this.updater.on('checking-for-update', () => {
      this.setStatus({
        phase: 'checking',
        message: '正在檢查是否有新版本…'
      })
    })
    this.updater.on('update-available', (info: UpdateInfo) => {
      this.setStatus({
        phase: 'available',
        availableVersion: info.version,
        downloadPercent: undefined,
        message: `發現新版本 ${info.version}，可立即下載。`
      })
    })
    this.updater.on('update-not-available', () => {
      this.setStatus({
        phase: 'not-available',
        availableVersion: undefined,
        downloadPercent: undefined,
        message: '目前已是最新版本。'
      })
    })
    this.updater.on('download-progress', (progress: ProgressInfo) => {
      this.setStatus({
        phase: 'downloading',
        downloadPercent: Math.max(0, Math.min(100, progress.percent)),
        message: `正在下載更新：${progress.percent.toFixed(0)}%`
      })
    })
    this.updater.on('update-downloaded', (info: UpdateInfo) => {
      this.setStatus({
        phase: 'downloaded',
        availableVersion: info.version,
        downloadPercent: 100,
        message: `版本 ${info.version} 已下載，重新啟動後即可安裝。`
      })
    })
    this.updater.on('error', (error: Error) => {
      logger.error('自動更新失敗', error)
      this.setStatus({
        phase: 'error',
        downloadPercent: undefined,
        message: '更新失敗，請確認網路後再試，或改用最新版安裝程式。'
      })
    })
  }

  registerIpc(): void {
    ipcMain.handle(IPC.APP_UPDATE_STATUS, (event): AppUpdateStatus => {
      assertTrustedIpcSender(event)
      return this.status
    })
    ipcMain.handle(IPC.APP_UPDATE_CHECK, async (event): Promise<AppUpdateStatus> => {
      assertTrustedIpcSender(event)
      await this.check()
      return this.status
    })
    ipcMain.handle(IPC.APP_UPDATE_DOWNLOAD, async (event): Promise<AppUpdateStatus> => {
      assertTrustedIpcSender(event)
      await this.download()
      return this.status
    })
    ipcMain.handle(IPC.APP_UPDATE_INSTALL, (event): AppUpdateStatus => {
      assertTrustedIpcSender(event)
      if (this.status.phase === 'downloaded') {
        setImmediate(() => this.updater.quitAndInstall(false, true))
      }
      return this.status
    })
  }

  startAutomaticCheck(): void {
    if (!this.configured) return
    const firstCheck = setTimeout(() => void this.check(), FIRST_CHECK_DELAY_MS)
    firstCheck.unref()
    const recheck = setInterval(() => void this.check(), RECHECK_INTERVAL_MS)
    recheck.unref()
  }

  private async check(): Promise<void> {
    if (!this.configured) return
    // 已在檢查／下載中，或已下載待安裝時不得重跑：重跑會把 downloaded
    // 狀態蓋回 available，使用者剛下載好的更新按鈕會憑空消失。
    if (
      this.status.phase === 'checking' ||
      this.status.phase === 'downloading' ||
      this.status.phase === 'downloaded'
    ) {
      return
    }
    try {
      await this.updater.checkForUpdates()
    } catch (error) {
      logger.error('檢查更新失敗', error)
      this.setStatus({
        phase: 'error',
        message: '無法連線更新服務，請稍後再試。'
      })
    }
  }

  private async download(): Promise<void> {
    if (!this.configured || this.status.phase !== 'available') return
    try {
      await this.updater.downloadUpdate()
    } catch (error) {
      logger.error('下載更新失敗', error)
      this.setStatus({
        phase: 'error',
        message: '更新下載失敗，請確認網路後再試。'
      })
    }
  }

  private setStatus(patch: Partial<AppUpdateStatus>): void {
    this.status = { ...this.status, ...patch }
    for (const window of BrowserWindow.getAllWindows()) {
      if (!window.isDestroyed()) window.webContents.send(IPC.APP_UPDATE_CHANGED, this.status)
    }
  }
}
