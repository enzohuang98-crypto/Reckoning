import assert from 'node:assert/strict'
import React from 'react'
import TestRenderer from 'react-test-renderer'
import { installPreparedUpdateSafely } from '../../../src/renderer/src/App'
import { flushLatestSnapshot } from '../../../src/renderer/src/features/app-data/useAppDataStore'
import { SystemSettingsSection } from '../../../src/renderer/src/features/settings/SystemSettingsSection'
import type { AppUpdateStatus } from '../../../src/shared/types/AppUpdate'

async function run(): Promise<void> {
  const first = { revision: 1 }
  const second = { revision: 2 }
  let current = first
  const persisted: number[] = []
  assert.equal(
    await flushLatestSnapshot(
      () => current,
      async (snapshot) => {
        persisted.push(snapshot.revision)
        if (snapshot.revision === 1) current = second
        return true
      },
      (snapshot) => ({ ...snapshot })
    ),
    true
  )
  assert.deepEqual(persisted, [1, 2], 'flush 中出現新狀態時必須再保存最新快照')

  let installs = 0
  assert.equal(
    await installPreparedUpdateSafely(async () => false, async () => {
      installs++
      throw new Error('must not install')
    }),
    null
  )
  assert.equal(installs, 0, '保存失敗不得退出安裝')

  const installed = { phase: 'installing' } as AppUpdateStatus
  assert.equal(
    await installPreparedUpdateSafely(async () => true, async () => {
      installs++
      return installed
    }),
    installed
  )
  assert.equal(installs, 1)

  let downloads = 0
  let readyInstalls = 0
  const status: AppUpdateStatus = {
    phase: 'downloaded',
    currentVersion: '0.4.13',
    availableVersion: '0.4.14',
    downloadPercent: 100,
    automaticChecksEnabled: true,
    preferences: {
      backgroundPreparationEnabled: true,
      skippedVersion: null,
      snoozedVersion: null,
      snoozeUntil: null
    },
    promptSuppressed: false,
    message: '已準備完成。'
  }
  const renderer = TestRenderer.create(
    <SystemSettingsSection
      updateStatus={status}
      updateBusy={false}
      license={null}
      licenseGateDisabled={true}
      onExportBackup={() => undefined}
      canExportBackup={true}
      onImportBackup={() => undefined}
      onCheckUpdate={() => undefined}
      onDownloadUpdate={() => downloads++}
      onInstallUpdate={() => readyInstalls++}
      onSetBackgroundPreparation={() => undefined}
      onDeactivateLicense={() => undefined}
    />
  )
  const testWindow = globalThis as typeof globalThis & {
    window?: { confirm: (message?: string) => boolean }
  }
  const originalWindow = testWindow.window
  testWindow.window = { confirm: () => true }
  try {
    TestRenderer.act(() => {
      renderer.root.findByProps({ 'data-update-action': 'install' }).props.onClick()
    })
  } finally {
    testWindow.window = originalWindow
  }
  assert.equal(readyInstalls, 1)
  assert.equal(downloads, 0, 'ready 按鈕只可 install，不得再 download')
  console.log('更新前保存與 ready-only-install 測試：通過')
}

void run().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
