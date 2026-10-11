import { app, dialog, ipcMain } from 'electron'
import { appendFileSync, existsSync, mkdirSync, unlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ISOLATED_PROBE_CHANNEL, ISOLATED_PROBE_STAGES } from '@shared/types/IsolatedUpdaterProbe'
import {
  IPC,
  type DataExportResult,
  type DataImportResult,
  type DataLoadResult,
  type DataSaveResult
} from '@shared/types/ipc'
import {
  mergeAppData,
  sanitizeAppData,
  type AppDataSnapshot
} from '@shared/types/AppData'
import { exportDataBackup } from './dataExport'
import type { StorageService } from '../storage/StorageService'
import { logger } from '../logger'
import { assertTrustedIpcSender } from '../security/IpcSecurity'
import {
  assertJsonSize,
  MAX_APP_DATA_BYTES,
  MAX_BACKUP_BYTES
} from '../security/InputValidation'

export function registerDataHandlers(storage: StorageService): void {
  let probeRoot: string | null = null
  let saveBarrierUsed = false
  if (typeof __ISOLATED_UPDATER_PROBE_ID__ !== 'undefined' && __ISOLATED_UPDATER_PROBE_ID__) {
    if (!app.isPackaged || process.platform !== 'win32' || process.env.GITHUB_ACTIONS !== 'true' ||
        process.env.RUNNER_ENVIRONMENT !== 'github-hosted' || process.env.GITHUB_RUN_ID !== __ISOLATED_UPDATER_PROBE_ID__) {
      throw new Error('Isolated updater package may only execute in its hosted VM run.')
    }
    probeRoot = join(tmpdir(), `reckoning-updater-probe-${__ISOLATED_UPDATER_PROBE_ID__}`)
    mkdirSync(probeRoot, { recursive: true })
    const eventPath = join(probeRoot, 'events.jsonl')
    let eventCount = 0
    ipcMain.handle(ISOLATED_PROBE_CHANNEL, (event, stage: unknown): void => {
      assertTrustedIpcSender(event)
      if (typeof stage !== 'string' || !ISOLATED_PROBE_STAGES.includes(stage as typeof ISOLATED_PROBE_STAGES[number]) || ++eventCount > 128) {
        throw new Error('Invalid isolated updater observation.')
      }
      appendFileSync(eventPath, JSON.stringify({ stage, at: new Date().toISOString(), pid: process.pid }) + '\n')
    })
  }
  ipcMain.handle(IPC.DATA_LOAD, async (event): Promise<DataLoadResult> => {
    assertTrustedIpcSender(event)
    try {
      return { ok: true, snapshot: await storage.readAppDataWithMigration() }
    } catch (error) {
      logger.error('讀取永久資料失敗', error)
      return {
        ok: false,
        message: '無法讀取本機資料；原始資料檔已保留，程式不會以空白資料覆蓋它。'
      }
    }
  })

  ipcMain.handle(
    IPC.DATA_SAVE,
    async (event, snapshot: unknown): Promise<DataSaveResult> => {
      assertTrustedIpcSender(event)
      try {
        assertJsonSize(snapshot, MAX_APP_DATA_BYTES, '應用程式資料')
        await storage.writeAppDataAsync(sanitizeAppData(snapshot) as AppDataSnapshot)
        if (typeof __ISOLATED_UPDATER_PROBE_ID__ !== 'undefined' && __ISOLATED_UPDATER_PROBE_ID__ &&
            probeRoot && !saveBarrierUsed && existsSync(join(probeRoot, 'save-arm'))) {
          saveBarrierUsed = true
          unlinkSync(join(probeRoot, 'save-arm'))
          const barrierStarted = Date.now()
          const deadline = barrierStarted + 12_000
          writeFileSync(join(probeRoot, 'save-entered'), JSON.stringify({ at: new Date(barrierStarted).toISOString(), pid: process.pid, actualWriteCompleted: true, timeoutMs: 12_000, deadlineAt: new Date(deadline).toISOString() }))
          while (true) {
            const now = Date.now()
            if (now >= deadline) {
              writeFileSync(join(probeRoot, 'save-timed-out'), JSON.stringify({ at: new Date(now).toISOString(), pid: process.pid, elapsedMs: now - barrierStarted }))
              throw new Error('Isolated save acknowledgement barrier timed out.')
            }
            if (existsSync(join(probeRoot, 'save-release'))) break
            await new Promise((resolve) => setTimeout(resolve, 50))
          }
          unlinkSync(join(probeRoot, 'save-release'))
          writeFileSync(join(probeRoot, 'save-completed'), JSON.stringify({ at: new Date().toISOString(), pid: process.pid, elapsedMs: Date.now() - barrierStarted }))
        }
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

  ipcMain.handle(
    IPC.DATA_EXPORT,
    async (event, rawSnapshot: unknown): Promise<DataExportResult> => {
      assertTrustedIpcSender(event)
      const result = await dialog.showSaveDialog({
        title: '匯出象棋分析資料',
        defaultPath: `xiangqi-analyzer-backup-${new Date().toISOString().slice(0, 10)}.json`,
        filters: [{ name: 'JSON 備份', extensions: ['json'] }]
      })
      if (result.canceled || !result.filePath) {
        return { ok: false, cancelled: true }
      }
      const exportResult = await exportDataBackup(
        storage,
        result.filePath,
        rawSnapshot
      )
      if (!exportResult.ok) logger.error('匯出備份失敗', exportResult.message)
      return exportResult
    }
  )

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
      const incoming = await storage.readAbsoluteAsync<unknown>(result.filePaths[0])
      assertJsonSize(incoming, MAX_BACKUP_BYTES, '備份資料')
      const merged = mergeAppData(await storage.readAppDataWithMigration(), incoming)
      await storage.writeAppDataAsync(merged.snapshot)
      return { ok: true, snapshot: merged.snapshot, summary: merged.summary }
    } catch (error) {
      logger.error('匯入備份失敗', error)
      return { ok: false, message: '匯入失敗：檔案格式不正確或無法讀取。' }
    }
  })
}
