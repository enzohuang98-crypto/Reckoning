import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { app } from 'electron'
import type { AppUpdater, UpdateInfo } from 'electron-updater'
import { AppUpdaterService } from '../../../src/main/update/AppUpdaterService'
import { UpdatePreferencesStore } from '../../../src/main/update/UpdatePreferencesStore'

class Deferred<T> {
  readonly promise: Promise<T>
  resolve!: (value: T) => void
  reject!: (error: Error) => void

  constructor() {
    this.promise = new Promise<T>((resolve, reject) => {
      this.resolve = resolve
      this.reject = reject
    })
  }
}

class FakeUpdater extends EventEmitter {
  autoDownload = true
  autoInstallOnAppQuit = true
  checkCalls = 0
  downloadCalls = 0
  installCalls: Array<[boolean, boolean]> = []
  nextDownload = new Deferred<string[]>()

  async checkForUpdates(): Promise<null> {
    this.checkCalls++
    return null
  }

  downloadUpdate(): Promise<string[]> {
    this.downloadCalls++
    return this.nextDownload.promise
  }

  quitAndInstall(isSilent = false, isForceRunAfter = false): void {
    this.installCalls.push([isSilent, isForceRunAfter])
  }
}

function fixture(): { updater: FakeUpdater; service: AppUpdaterService; directory: string } {
  const directory = mkdtempSync(join(tmpdir(), 'reckoning-updater-'))
  const updater = new FakeUpdater()
  const preferences = new UpdatePreferencesStore(join(directory, 'preferences.json'))
  const service = new AppUpdaterService({
    updater: updater as unknown as AppUpdater,
    supported: true,
    configured: true,
    preferences
  })
  return { updater, service, directory }
}

async function flushImmediate(): Promise<void> {
  await new Promise<void>((resolve) => setImmediate(resolve))
}

async function waitFor(predicate: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 200; attempt++) {
    if (predicate()) return
    await new Promise<void>((resolve) => setTimeout(resolve, 10))
  }
  throw new Error('Timed out waiting for updater fixture state.')
}

function cleanup(directory: string): void {
  try {
    rmSync(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 })
  } catch {
    // Windows 上防毒軟體可能短暫持有剛 fsync 的測試檔；不影響隔離的 temp fixture。
  }
}

async function run(): Promise<void> {
  {
    const { updater, service, directory } = fixture()
    try {
      await service.migrateLegacyPreferences({
        skippedVersion: '0.4.14',
        snoozedVersion: null,
        snoozeUntil: null
      })
      updater.emit('update-available', { version: '0.4.14' } as UpdateInfo)
      await flushImmediate()
      assert.equal(
        updater.downloadCalls,
        0,
        'renderer 舊跳過偏好必須在首次 available 前阻止背景準備'
      )
      assert.equal(service.getStatus().promptSuppressed, true)
    } finally {
      cleanup(directory)
    }
  }

  {
    const { updater, service, directory } = fixture()
    try {
      await service.initialize()
      updater.emit('update-available', { version: '0.4.14' } as UpdateInfo)
      assert.equal(service.getStatus().phase, 'downloading')
      assert.equal(updater.downloadCalls, 1, '預設應在背景準備更新')

      const duplicate = service.prepareUpdate()
      assert.equal(updater.downloadCalls, 1, '背景準備必須 single-flight')
      updater.emit('update-downloaded', { version: '0.4.14' } as UpdateInfo)
      updater.nextDownload.resolve([])
      await duplicate
      assert.equal(service.getStatus().phase, 'downloaded')
      assert.deepEqual(updater.installCalls, [], '下載完成不得自動安裝')

      const firstInstall = service.installPreparedUpdate()
      const secondInstall = service.installPreparedUpdate()
      assert.equal(service.getStatus().phase, 'installing')
      await Promise.all([firstInstall, secondInstall])
      await flushImmediate()
      assert.deepEqual(updater.installCalls, [[true, true]], '連點只能觸發一次安裝')
    } finally {
      cleanup(directory)
    }
  }

  {
    const { updater, service, directory } = fixture()
    try {
      await service.setBackgroundPreparation(false)
      updater.emit('update-available', { version: '0.4.15' } as UpdateInfo)
      await flushImmediate()
      assert.equal(updater.downloadCalls, 0)
      assert.equal(service.getStatus().phase, 'available')

      await service.skipAvailableVersion()
      assert.equal(service.getStatus().preferences.skippedVersion, '0.4.15')
      assert.equal(service.getStatus().promptSuppressed, true)
      updater.emit('update-available', { version: '0.4.15' } as UpdateInfo)
      await flushImmediate()
      assert.equal(updater.downloadCalls, 0, '跳過版本不得開始尚未開始的準備')

      const manual = service.prepareUpdate({ userInitiated: true })
      await waitFor(() => updater.downloadCalls === 1)
      assert.equal(updater.downloadCalls, 1)
      assert.equal(service.getStatus().preferences.skippedVersion, null)
      updater.nextDownload.reject(new Error('fixture network unavailable'))
      await manual
      assert.equal(service.getStatus().phase, 'error')

      updater.nextDownload = new Deferred<string[]>()
      updater.emit('update-available', { version: '0.4.15' } as UpdateInfo)
      const retry = service.prepareUpdate({ userInitiated: true })
      await waitFor(() => updater.downloadCalls === 2)
      assert.equal(updater.downloadCalls, 2, '網路失敗後應可重試')
      updater.nextDownload.resolve([])
      await retry
    } finally {
      cleanup(directory)
    }
  }

  {
    const { updater, service, directory } = fixture()
    try {
      await service.setBackgroundPreparation(false)
      updater.emit('update-available', { version: '0.4.16' } as UpdateInfo)
      await service.snoozeAvailableVersion()
      assert.equal(service.getStatus().promptSuppressed, true)
      assert.equal(service.getStatus().preferences.snoozedVersion, '0.4.16')
      assert.ok((service.getStatus().preferences.snoozeUntil ?? 0) > Date.now())
    } finally {
      cleanup(directory)
    }
  }

  console.log('背景更新準備、偏好與明確重新啟動安裝測試：通過')
  app.quit()
}

void run().catch((error) => {
  console.error(error)
  process.exitCode = 1
  app.quit()
})
