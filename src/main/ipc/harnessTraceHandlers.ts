/** 本機解說診斷紀錄（Harness trace）的列出、清除、匯出與回饋通道。 */

import { dialog, ipcMain } from 'electron'
import { IPC } from '@shared/types/ipc'
import type { HarnessTraceExportV1 } from '@shared/types/Harness'
import type { HarnessTraceStore } from '../storage/HarnessTraceStore'
import type { StorageService } from '../storage/StorageService'
import { assertTrustedIpcSender } from '../security/IpcSecurity'
import { SecurityValidationError } from '../security/InputValidation'

export function registerHarnessTraceHandlers(
  traceStore: HarnessTraceStore,
  storage: StorageService
): void {
  ipcMain.handle(IPC.AI_HARNESS_TRACE_LIST, async (event) => {
    assertTrustedIpcSender(event)
    return await traceStore.list()
  })

  ipcMain.handle(IPC.AI_HARNESS_TRACE_CLEAR, async (event) => {
    assertTrustedIpcSender(event)
    await traceStore.clear()
    return { ok: true as const }
  })

  ipcMain.handle(IPC.AI_HARNESS_TRACE_EXPORT, async (event) => {
    assertTrustedIpcSender(event)
    const result = await dialog.showSaveDialog({
      title: '匯出 Harness 診斷紀錄',
      defaultPath: `xiangqi-harness-traces-${new Date()
        .toISOString()
        .slice(0, 10)}.json`,
      filters: [{ name: 'JSON', extensions: ['json'] }]
    })
    if (result.canceled || !result.filePath) {
      return { ok: false as const, cancelled: true }
    }
    await storage.writeAbsoluteAsync(result.filePath, {
      schemaVersion: 1,
      exportedAt: new Date().toISOString(),
      traces: await traceStore.listForExport(),
      // 使用者標記「不清楚／不正確／證據不足」的解說，轉為可重放的回歸案例
      regressionCases: await traceStore.listRegressionCases()
    } satisfies HarnessTraceExportV1)
    return { ok: true as const, filePath: result.filePath }
  })

  ipcMain.handle(IPC.AI_HARNESS_TRACE_FEEDBACK, async (event, raw: unknown) => {
    assertTrustedIpcSender(event)
    if (typeof raw !== 'object' || raw === null) {
      throw new SecurityValidationError('回饋格式無效。')
    }
    const value = raw as Record<string, unknown>
    const allowed = new Set([
      'helpful',
      'unclear',
      'incorrect',
      'missing_evidence'
    ])
    if (
      typeof value.traceId !== 'string' ||
      value.traceId.length > 128 ||
      typeof value.feedback !== 'string' ||
      !allowed.has(value.feedback)
    ) {
      throw new SecurityValidationError('回饋格式無效。')
    }
    await traceStore.setFeedback(
      value.traceId,
      value.feedback as 'helpful' | 'unclear' | 'incorrect' | 'missing_evidence'
    )
    return { ok: true as const }
  })
}
