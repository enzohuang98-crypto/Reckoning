import { dialog, ipcMain } from 'electron'
import {
  IPC,
  type DataExportResult,
  type DataImportResult,
  type DataLoadResult,
  type DataSaveResult
} from '@shared/types/ipc'
import { mergeAppData, sanitizeAppData, type AppDataSnapshot } from '@shared/types/AppData'
import type { StorageService } from '../storage/StorageService'
import { logger } from '../logger'
import { assertTrustedIpcSender } from '../security/IpcSecurity'
import {
  assertJsonSize,
  MAX_APP_DATA_BYTES,
  MAX_BACKUP_BYTES
} from '../security/InputValidation'

export function registerDataHandlers(storage: StorageService): void {
  ipcMain.handle(IPC.DATA_LOAD, (event): DataLoadResult => {
    assertTrustedIpcSender(event)
    try {
      return { ok: true, snapshot: storage.readAppData() }
    } catch (error) {
      logger.error('讀取永久資料失敗', error)
      return { ok: false, message: '無法讀取本機資料，已使用空白資料。' }
    }
  })

  ipcMain.handle(
    IPC.DATA_SAVE,
    (event, snapshot: unknown): DataSaveResult => {
      assertTrustedIpcSender(event)
      try {
        assertJsonSize(snapshot, MAX_APP_DATA_BYTES, '應用程式資料')
        storage.writeAppData(sanitizeAppData(snapshot) as AppDataSnapshot)
        return { ok: true }
      } catch (error) {
        logger.error('儲存永久資料失敗', error)
        return {
          ok: false,
          message: '儲存失敗，畫面內容仍保留；請稍後重試或先匯出備份。'
        }
      }
    }
  )

  ipcMain.handle(IPC.DATA_EXPORT, async (event): Promise<DataExportResult> => {
    assertTrustedIpcSender(event)
    const result = await dialog.showSaveDialog({
      title: '匯出象棋分析資料',
      defaultPath: `xiangqi-analyzer-backup-${new Date().toISOString().slice(0, 10)}.json`,
      filters: [{ name: 'JSON 備份', extensions: ['json'] }]
    })
    if (result.canceled || !result.filePath) return { ok: false, cancelled: true }
    try {
      storage.writeAbsolute(result.filePath, storage.readAppData())
      return { ok: true, filePath: result.filePath }
    } catch (error) {
      logger.error('匯出備份失敗', error)
      return { ok: false, message: '匯出失敗，請確認目的地是否可寫入。' }
    }
  })

  ipcMain.handle(IPC.DATA_IMPORT, async (event): Promise<DataImportResult> => {
    assertTrustedIpcSender(event)
    const result = await dialog.showOpenDialog({
      title: '匯入象棋分析資料',
      properties: ['openFile'],
      filters: [{ name: 'JSON 備份', extensions: ['json'] }]
    })
    if (result.canceled || result.filePaths.length === 0) {
      return { ok: false, cancelled: true }
    }
    try {
      const incoming = storage.readAbsolute<unknown>(result.filePaths[0])
      assertJsonSize(incoming, MAX_BACKUP_BYTES, '備份資料')
      const merged = mergeAppData(storage.readAppData(), incoming)
      storage.writeAppData(merged.snapshot)
      return { ok: true, snapshot: merged.snapshot, summary: merged.summary }
    } catch (error) {
      logger.error('匯入備份失敗', error)
      return { ok: false, message: '匯入失敗：檔案格式不正確或無法讀取。' }
    }
  })
}
