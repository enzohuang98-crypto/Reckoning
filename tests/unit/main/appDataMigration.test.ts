import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  APP_DATA_FILE,
  RETIRED_STUDY_DATA_FILE,
  StorageService
} from '../../../src/main/storage/StorageService'

async function main(): Promise<void> {
  const directory = mkdtempSync(join(tmpdir(), 'xiangqi-app-data-migration-'))
  try {
    writeFileSync(
      join(directory, APP_DATA_FILE),
      JSON.stringify({
        schemaVersion: 1,
        mistakeBookEntries: [{ id: 'mistake', apiKey: 'must-not-survive' }],
        misunderstoodPositions: [{ id: 'misunderstood', reason: 'old' }],
        savedPositions: [],
        conversations: [],
        userGuesses: []
      })
    )
    const storage = new StorageService(directory)
    const migrated = await storage.readAppDataWithMigration()
    assert.equal(migrated.schemaVersion, 2)
    assert.equal('mistakeBookEntries' in migrated, false)
    assert.equal('misunderstoodPositions' in migrated, false)

    const backupPath = join(directory, RETIRED_STUDY_DATA_FILE)
    const backup = readFileSync(backupPath, 'utf8')
    assert.match(backup, /mistake/)
    assert.match(backup, /misunderstood/)
    assert.doesNotMatch(backup, /must-not-survive/)

    const firstBackup = backup
    await storage.readAppDataWithMigration()
    assert.equal(readFileSync(backupPath, 'utf8'), firstBackup)
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
  console.log('AppData v1 → v2 备份迁移测试：通过')
}

void main().catch((error) => {
  console.error(error)
  process.exit(1)
})
