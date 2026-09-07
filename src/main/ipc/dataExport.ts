import { parseAppDataSnapshot, type AppDataSnapshot } from '@shared/types/AppData'
import type { DataExportResult } from '@shared/types/ipc'
import type { StorageService } from '../storage/StorageService'
import {
  assertJsonSize,
  MAX_APP_DATA_BYTES
} from '../security/InputValidation'

type BackupStorage = Pick<StorageService, 'readAppDataWithMigration' | 'writeAbsoluteAsync'>

async function resolveSnapshot(
  storage: BackupStorage,
  rawSnapshot: unknown
): Promise<AppDataSnapshot> {
  if (rawSnapshot === undefined) return storage.readAppDataWithMigration()
  assertJsonSize(rawSnapshot, MAX_APP_DATA_BYTES, '應用程式資料快照')
  const snapshot = parseAppDataSnapshot(rawSnapshot)
  if (!snapshot) throw new Error('應用程式資料快照格式無效。')
  return snapshot
}

/** 將一次性的目前記憶體快照寫到使用者選擇的目的地；不改動來源資料。 */
export async function exportDataBackup(
  storage: BackupStorage,
  filePath: string | null,
  rawSnapshot: unknown
): Promise<DataExportResult> {
  if (!filePath) return { ok: false, cancelled: true }
  try {
    const snapshot = await resolveSnapshot(storage, rawSnapshot)
    await storage.writeAbsoluteAsync(filePath, snapshot)
    return { ok: true, filePath }
  } catch {
    return { ok: false, message: '匯出失敗，請確認目的地是否可寫入。' }
  }
}
