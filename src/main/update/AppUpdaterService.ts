import { app, BrowserWindow, ipcMain } from 'electron'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import electronUpdater, {
  type AppUpdater,
  type ProgressInfo,
  type UpdateInfo
} from 'electron-updater'
import { IPC } from '@shared/types/ipc'
import type { AppUpdateStatus, LegacyUpdatePreferences } from '@shared/types/AppUpdate'
import { logger } from '../logger'
import { assertTrustedIpcSender } from '../security/IpcSecurity'
import { configureUpdatePolicy } from './UpdatePolicy'
import { UpdatePreferencesStore } from './UpdatePreferencesStore'

const FIRST_CHECK_DELAY_MS = 5_000
const RECHECK_INTERVAL_MS = 4 * 60 * 60 * 1000
export const UPDATE_SNOOZE_DELAY_MS = 4 * 60 * 60 * 1000
const LEGACY_MIGRATION_WAIT_MS = 5_000

function parseLegacyPreferences(value: unknown): LegacyUpdatePreferences {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Invalid legacy update preferences.')
  }
  const input = value as Partial<LegacyUpdatePreferences>
  const validVersion = (version: unknown): version is string | null =>
    version === null ||
    (typeof version === 'string' && version.trim().length > 0 && version.length <= 64)
  if (
    !validVersion(input.skippedVersion) ||
    !validVersion(input.snoozedVersion) ||
    !(
      input.snoozeUntil === null ||
      (typeof input.snoozeUntil === 'number' &&
        Number.isFinite(input.snoozeUntil) &&
        input.snoozeUntil >= 0)
    )
  ) throw new Error('Invalid legacy update preferences.')
  return {
    skippedVersion: input.skippedVersion,
    snoozedVersion: input.snoozedVersion,
    snoozeUntil: input.snoozeUntil
  }
}

function getAutoUpdater(): AppUpdater {
  return electronUpdater.autoUpdater
}

function hasPackagedUpdateConfiguration(): boolean {
  return app.isPackaged && existsSync(join(process.resourcesPath, 'app-update.yml'))
}

interface AppUpdaterServiceOptions {
  updater?: AppUpdater
  supported?: boolean
  configured?: boolean
  preferences?: UpdatePreferencesStore
  now?: () => number
}

export class AppUpdaterService {
  private readonly updater: AppUpdater
  private readonly preferences: UpdatePreferencesStore
  private readonly now: () => number
  private configured = false
  private status: AppUpdateStatus
  private initialization: Promise<void> | null = null
  private initialized = false
  private resolveLegacyMigration!: () => void
  private readonly legacyMigrationBarrier = new Promise<void>((resolve) => {
    this.resolveLegacyMigration = resolve
  })
  private preparePromise: Promise<void> | null = null
  private installPromise: Promise<void> | null = null

  constructor(options: AppUpdaterServiceOptions = {}) {
    this.updater = options.updater ?? getAutoUpdater()
    this.preferences =
      options.preferences ??
      new UpdatePreferencesStore(join(app.getPath('userData'), 'update-preferences.json'))
    this.now = options.now ?? Date.now
    const supported = options.supported ?? (process.platform === 'win32' && app.isPackaged)
    this.configured = supported && (options.configured ?? hasPackagedUpdateConfiguration())
    this.status = {
      phase: supported ? (this.configured ? 'idle' : 'unconfigured') : 'unsupported',
      currentVersion: app.getVersion(),
      automaticChecksEnabled: this.configured,
      preferences: this.preferences.get(),
      promptSuppressed: false,
      message: supported
        ? this.configured
          ? '程式會在啟動後自動檢查並於背景準備更新。'
          : '尚未設定正式更新來源，請使用最新版安裝程式更新。'
        : '開發模式不執行自動更新。'
    }

    if (!this.configured) return

    configureUpdatePolicy(this.updater)
    this.updater.on('checking-for-update', () => {
      this.setStatus({ phase: 'checking', message: '正在檢查是否有新版本…' })
    })
    this.updater.on('update-available', (info: UpdateInfo) => {
      const skipped = this.preferences.get().skippedVersion === info.version
      this.setStatus({
        phase: 'available',
        availableVersion: info.version,
        downloadPercent: undefined,
        message: skipped
          ? `已跳過版本 ${info.version}；手動準備更新可解除跳過。`
          : `發現新版本 ${info.version}。`
      })
      if (this.preferences.get().backgroundPreparationEnabled && !skipped) {
        void this.prepareUpdate()
      }
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
        message: `正在背景準備更新：${progress.percent.toFixed(0)}%；可繼續使用。`
      })
    })
    this.updater.on('update-downloaded', (info: UpdateInfo) => {
      this.setStatus({
        phase: 'downloaded',
        availableVersion: info.version,
        downloadPercent: 100,
        message: `版本 ${info.version} 已準備完成；重新啟動即可完成更新。`
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

  getStatus(): AppUpdateStatus {
    return { ...this.status, preferences: { ...this.status.preferences } }
  }

  initialize(): Promise<void> {
    if (this.initialization) return this.initialization
    this.initialization = this.preferences.initialize().then(() => {
      this.refreshPreferences()
      this.initialized = true
    })
    return this.initialization
  }

  registerIpc(): void {
    ipcMain.handle(IPC.APP_UPDATE_STATUS, async (event): Promise<AppUpdateStatus> => {
      assertTrustedIpcSender(event)
      await this.initialize()
      return this.getStatus()
    })
    ipcMain.handle(IPC.APP_UPDATE_CHECK, async (event): Promise<AppUpdateStatus> => {
      assertTrustedIpcSender(event)
      await this.check({ userInitiated: true })
      return this.getStatus()
    })
    ipcMain.handle(IPC.APP_UPDATE_DOWNLOAD, async (event): Promise<AppUpdateStatus> => {
      assertTrustedIpcSender(event)
      await this.prepareUpdate({ userInitiated: true })
      return this.getStatus()
    })
    ipcMain.handle(IPC.APP_UPDATE_INSTALL, async (event): Promise<AppUpdateStatus> => {
      assertTrustedIpcSender(event)
      await this.installPreparedUpdate()
      return this.getStatus()
    })
    ipcMain.handle(
      IPC.APP_UPDATE_SET_BACKGROUND_PREPARATION,
      async (event, enabled: unknown): Promise<AppUpdateStatus> => {
        assertTrustedIpcSender(event)
        if (typeof enabled !== 'boolean') throw new Error('Invalid update preference.')
        await this.setBackgroundPreparation(enabled)
        return this.getStatus()
      }
    )
    ipcMain.handle(
      IPC.APP_UPDATE_MIGRATE_LEGACY_PREFERENCES,
      async (event, input: unknown): Promise<AppUpdateStatus> => {
        assertTrustedIpcSender(event)
        await this.migrateLegacyPreferences(parseLegacyPreferences(input))
        return this.getStatus()
      }
    )
    ipcMain.handle(IPC.APP_UPDATE_SKIP, async (event): Promise<AppUpdateStatus> => {
      assertTrustedIpcSender(event)
      await this.skipAvailableVersion()
      return this.getStatus()
    })
    ipcMain.handle(IPC.APP_UPDATE_SNOOZE, async (event): Promise<AppUpdateStatus> => {
      assertTrustedIpcSender(event)
      await this.snoozeAvailableVersion()
      return this.getStatus()
    })
  }

  startAutomaticCheck(): void {
    if (!this.configured) return
    void this.initialize().then(() => {
      const firstCheck = setTimeout(
        () => void this.waitForLegacyMigration().then(() => this.check()),
        FIRST_CHECK_DELAY_MS
      )
      firstCheck.unref()
      const recheck = setInterval(() => void this.check(), RECHECK_INTERVAL_MS)
      recheck.unref()
    }).catch((error: unknown) => {
      logger.error('初始化更新偏好失敗', error)
    })
  }

  async check(options: { userInitiated?: boolean } = {}): Promise<void> {
    if (!this.configured) return
    await this.initialize()
    if (
      this.status.phase === 'checking' ||
      this.status.phase === 'downloading' ||
      this.status.phase === 'downloaded' ||
      this.status.phase === 'installing'
    ) return

    if (options.userInitiated && this.status.phase === 'available' && this.status.availableVersion) {
      await this.preferences.clearSkippedVersion(this.status.availableVersion)
      this.refreshPreferences()
    }
    try {
      await this.updater.checkForUpdates()
    } catch (error) {
      logger.error('檢查更新失敗', error)
      this.setStatus({ phase: 'error', message: '無法連線更新服務，請稍後再試。' })
    }
  }

  prepareUpdate(options: { userInitiated?: boolean } = {}): Promise<void> {
    if (this.preparePromise) return this.preparePromise
    if (!this.initialized) {
      const initialization = this.initialize().then(() => {
        this.preparePromise = null
        return this.prepareUpdate(options)
      })
      this.preparePromise = initialization
      return initialization
    }
    const operation = (async (): Promise<void> => {
      if (!this.configured || !this.status.availableVersion) return
      if (this.status.phase !== 'available' && this.status.phase !== 'error') return

      const version = this.status.availableVersion
      if (!options.userInitiated && this.preferences.get().skippedVersion === version) return

      this.setStatus({
        phase: 'downloading',
        downloadPercent: 0,
        message: `正在背景準備版本 ${version}；可繼續使用。`
      })
      try {
        if (options.userInitiated) {
          await this.preferences.clearSkippedVersion(version)
          await this.preferences.clearSnooze(version)
          this.refreshPreferences()
        }
        await this.updater.downloadUpdate()
      } catch (error) {
        logger.error('下載更新失敗', error)
        this.setStatus({
          phase: 'error',
          downloadPercent: undefined,
          message: '更新下載失敗，請確認網路後再試。'
        })
      } finally {
        this.preparePromise = null
      }
    })()
    this.preparePromise = operation
    return operation
  }

  installPreparedUpdate(): Promise<void> {
    if (this.installPromise) return this.installPromise
    if (!this.configured || this.status.phase !== 'downloaded') return Promise.resolve()

    this.setStatus({
      phase: 'installing',
      message: '正在關閉程式並完成更新…'
    })
    const operation = new Promise<void>((resolve) => {
      setImmediate(() => {
        this.updater.quitAndInstall(true, true)
        resolve()
      })
    })
    this.installPromise = operation
    return operation
  }

  async setBackgroundPreparation(enabled: boolean): Promise<void> {
    await this.initialize()
    await this.preferences.setBackgroundPreparation(enabled)
    this.refreshPreferences()
    if (
      enabled &&
      this.status.phase === 'available' &&
      this.status.availableVersion &&
      this.preferences.get().skippedVersion !== this.status.availableVersion
    ) {
      void this.prepareUpdate()
    }
  }

  async migrateLegacyPreferences(input: LegacyUpdatePreferences): Promise<void> {
    await this.initialize()
    await this.preferences.migrateLegacy(input)
    this.refreshPreferences()
    this.resolveLegacyMigration()
  }

  async skipAvailableVersion(): Promise<void> {
    await this.initialize()
    const version = this.status.availableVersion
    if (!version) return
    await this.preferences.skipVersion(version)
    this.refreshPreferences()
    this.setStatus({
      message:
        this.status.phase === 'downloading'
          ? `版本 ${version} 仍會完成背景準備，但不再提示。`
          : `已跳過版本 ${version}；手動準備更新可解除跳過。`
    })
  }

  async snoozeAvailableVersion(): Promise<void> {
    await this.initialize()
    const version = this.status.availableVersion
    if (!version) return
    await this.preferences.snoozeVersion(version, this.now() + UPDATE_SNOOZE_DELAY_MS)
    this.refreshPreferences()
  }

  private refreshPreferences(): void {
    this.status = {
      ...this.status,
      preferences: this.preferences.get(),
      promptSuppressed: this.isPromptSuppressed(this.status.availableVersion)
    }
  }

  private waitForLegacyMigration(): Promise<void> {
    const fallback = new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, LEGACY_MIGRATION_WAIT_MS)
      timer.unref()
    })
    return Promise.race([this.legacyMigrationBarrier, fallback])
  }

  private isPromptSuppressed(version: string | undefined): boolean {
    if (!version) return false
    const preferences = this.preferences.get()
    if (preferences.skippedVersion === version) return true
    return (
      preferences.snoozedVersion === version &&
      preferences.snoozeUntil !== null &&
      preferences.snoozeUntil > this.now()
    )
  }

  private setStatus(patch: Partial<AppUpdateStatus>): void {
    const version = patch.availableVersion ?? this.status.availableVersion
    this.status = {
      ...this.status,
      ...patch,
      preferences: this.preferences.get(),
      promptSuppressed: this.isPromptSuppressed(version)
    }
    for (const window of BrowserWindow.getAllWindows()) {
      if (!window.isDestroyed()) window.webContents.send(IPC.APP_UPDATE_CHANGED, this.getStatus())
    }
  }
}
