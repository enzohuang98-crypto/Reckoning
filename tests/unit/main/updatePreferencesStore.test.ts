import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { UpdatePreferencesStore } from '../../../src/main/update/UpdatePreferencesStore'

async function run(): Promise<void> {
  const directory = mkdtempSync(join(tmpdir(), 'reckoning-update-preferences-'))
  const path = join(directory, 'update-preferences.json')
  try {
    const store = new UpdatePreferencesStore(path)
    assert.deepEqual(store.get(), {
      backgroundPreparationEnabled: true,
      skippedVersion: null,
      snoozedVersion: null,
      snoozeUntil: null
    })

    await store.setBackgroundPreparation(false)
    await store.skipVersion('0.4.14')
    await store.snoozeVersion('0.4.15', 123456789)

    const reopened = new UpdatePreferencesStore(path)
    await reopened.initialize()
    assert.deepEqual(reopened.get(), {
      backgroundPreparationEnabled: false,
      skippedVersion: '0.4.14',
      snoozedVersion: '0.4.15',
      snoozeUntil: 123456789
    })

    await reopened.clearSkippedVersion('0.4.13')
    assert.equal(reopened.get().skippedVersion, '0.4.14')
    await reopened.clearSkippedVersion('0.4.14')
    assert.equal(reopened.get().skippedVersion, null)

    const concurrent = new UpdatePreferencesStore(join(directory, 'concurrent.json'))
    await Promise.all([
      concurrent.setBackgroundPreparation(false),
      concurrent.skipVersion('0.4.16')
    ])
    assert.deepEqual(concurrent.get(), {
      backgroundPreparationEnabled: false,
      skippedVersion: '0.4.16',
      snoozedVersion: null,
      snoozeUntil: null
    })

    const migrated = new UpdatePreferencesStore(join(directory, 'migrated.json'))
    await migrated.migrateLegacy({
      skippedVersion: '0.4.17',
      snoozedVersion: null,
      snoozeUntil: null
    })
    assert.equal(migrated.get().skippedVersion, '0.4.17')
    await migrated.migrateLegacy({
      skippedVersion: '0.4.18',
      snoozedVersion: null,
      snoozeUntil: null
    })
    assert.equal(
      migrated.get().skippedVersion,
      '0.4.17',
      '既有 main 偏好不得被 renderer 舊資料覆寫'
    )
    console.log('更新偏好安全持久化測試：通過')
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
}

void run().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
