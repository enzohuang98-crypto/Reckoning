import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { app } from 'electron'
import type { AppUpdater, UpdateInfo } from 'electron-updater'
import { AppUpdaterService } from '../../../src/main/update/AppUpdaterService'

class FakeUpdater extends EventEmitter {
  autoDownload = true
  autoInstallOnAppQuit = true
  downloadCalls = 0
  installCalls: Array<[boolean, boolean]> = []

  async checkForUpdates(): Promise<null> {
    return null
  }

  async downloadUpdate(): Promise<string[]> {
    this.downloadCalls++
    this.emit('update-downloaded', { version: '0.4.7' } as UpdateInfo)
    return []
  }

  quitAndInstall(isSilent = false, isForceRunAfter = false): void {
    this.installCalls.push([isSilent, isForceRunAfter])
  }
}

function createService(updater: FakeUpdater): AppUpdaterService {
  return new AppUpdaterService({
    updater: updater as unknown as AppUpdater,
    supported: true,
    configured: true
  })
}

async function flushImmediate(): Promise<void> {
  await new Promise<void>((resolve) => setImmediate(resolve))
}

async function run(): Promise<void> {
  const approvedUpdater = new FakeUpdater()
  const approvedService = createService(approvedUpdater)
  approvedUpdater.emit('update-available', { version: '0.4.7' } as UpdateInfo)

  await approvedService.downloadApprovedUpdate()
  await flushImmediate()

  assert.equal(approvedUpdater.downloadCalls, 1)
  assert.deepEqual(
    approvedUpdater.installCalls,
    [[true, true]],
    '使用者同意下載後，下載完成必須靜默安裝並重新啟動'
  )

  const unapprovedUpdater = new FakeUpdater()
  createService(unapprovedUpdater)
  unapprovedUpdater.emit('update-downloaded', { version: '0.4.7' } as UpdateInfo)
  await flushImmediate()

  assert.deepEqual(
    unapprovedUpdater.installCalls,
    [],
    '沒有使用者同意時，不得因下載完成事件擅自重新啟動'
  )

  console.log('使用者同意後自動安裝並重新啟動測試：通過')
  app.quit()
}

void run().catch((error) => {
  console.error(error)
  process.exitCode = 1
  app.quit()
})
