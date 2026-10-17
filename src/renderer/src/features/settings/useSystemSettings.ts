/**
 * 設定頁「資料與系統」分類的狀態與 IPC：備份匯出／匯入、診斷紀錄與應用程式更新。
 */

import { useEffect, useRef, useState } from 'react'
import type { AppDataSnapshot } from '@shared/types/AppData'
import type { AppUpdateStatus } from '@shared/types/AppUpdate'
import { withTimeout } from '../../utils/withTimeout'

const UPDATE_OPERATION_TIMEOUT_MS = 15_000
const UPDATE_PREPARATION_TIMEOUT_MS = 20 * 60 * 1000

interface Options {
  onDataImported: (snapshot: AppDataSnapshot) => void
  getCurrentDataSnapshot: () => AppDataSnapshot
  dataRecoveryRequired: boolean
  onInstallUpdate: () => Promise<AppUpdateStatus>
  setOperationError: (message: string | null) => void
  setSavedMessage: (message: string | null) => void
}

export interface SystemSettings {
  traceCount: number | null
  updateStatus: AppUpdateStatus | null
  updateBusy: boolean
  /** 訂閱 main 推送的更新狀態；回傳取消訂閱函式。 */
  subscribeUpdateStatus: () => () => void
  /** 開啟設定頁時讀取診斷紀錄筆數。 */
  loadTraceCount: () => void
  /** 開啟設定頁時查詢目前更新狀態。 */
  loadUpdateStatus: () => void
  exportBackup: () => Promise<void>
  importBackup: () => Promise<void>
  exportTraces: () => Promise<void>
  clearTraces: () => Promise<void>
  checkUpdate: () => Promise<void>
  downloadUpdate: () => Promise<void>
  installUpdate: () => Promise<void>
  setBackgroundPreparation: (enabled: boolean) => Promise<void>
}

export function useSystemSettings({
  onDataImported,
  getCurrentDataSnapshot,
  dataRecoveryRequired,
  onInstallUpdate,
  setOperationError,
  setSavedMessage
}: Options): SystemSettings {
  const [traceCount, setTraceCount] = useState<number | null>(null)
  const [updateStatus, setUpdateStatus] = useState<AppUpdateStatus | null>(null)
  const [updateBusy, setUpdateBusy] = useState(false)
  const mountedRef = useRef(true)

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
    }
  }, [])

  const subscribeUpdateStatus = (): (() => void) =>
    window.api.update.onChanged(setUpdateStatus)

  const loadTraceCount = (): void => {
    // 舊版 preload 或測試替身可能沒有診斷通道；讀不到就不顯示筆數。
    window.api.ai?.listHarnessTraces?.()
      ?.then((traces) => {
        if (mountedRef.current) setTraceCount(traces.length)
      })
      .catch(() => undefined)
  }

  const loadUpdateStatus = (): void => {
    withTimeout(
      window.api.update.status(),
      UPDATE_OPERATION_TIMEOUT_MS,
      '更新狀態查詢逾時。'
    ).then(setUpdateStatus).catch(() => setUpdateStatus(null))
  }

  const exportBackup = async (): Promise<void> => {
    if (dataRecoveryRequired) {
      setOperationError(
        '目前資料尚未成功讀取，不能把空白保護資料當作完整備份；請先重新讀取資料。'
      )
      return
    }
    try {
      const result = await window.api.data.exportBackup(getCurrentDataSnapshot())
      if (result.ok) {
        setSavedMessage(`資料已匯出：${result.filePath}`)
      } else if (!result.cancelled) {
        setOperationError(result.message ?? '資料匯出失敗。')
      }
    } catch {
      setOperationError('資料匯出失敗，請確認儲存位置後重試。')
    }
  }

  const exportTraces = async (): Promise<void> => {
    try {
      const result = await window.api.ai.exportHarnessTraces()
      if (result.ok) {
        setSavedMessage(`診斷紀錄已匯出：${result.filePath}`)
      } else if (!result.cancelled) {
        setOperationError(result.message ?? '診斷紀錄匯出失敗。')
      }
    } catch {
      setOperationError('診斷紀錄匯出失敗，請確認儲存位置後重試。')
    }
  }

  const clearTraces = async (): Promise<void> => {
    try {
      await window.api.ai.clearHarnessTraces()
      setTraceCount(0)
      setSavedMessage('診斷紀錄已清除。')
    } catch {
      setOperationError('診斷紀錄清除失敗，請稍後再試。')
    }
  }

  const importBackup = async (): Promise<void> => {
    try {
      const result = await window.api.data.importBackup()
      if (result.ok) {
        onDataImported(result.snapshot)
        const total = Object.values(result.summary).reduce((sum, count) => sum + count, 0)
        setSavedMessage(`匯入完成，共新增 ${total} 筆資料；重複資料已略過。`)
        setOperationError(null)
      } else if (!result.cancelled) {
        setOperationError(result.message ?? '資料匯入失敗。')
      }
    } catch {
      setOperationError('資料匯入失敗；原有資料未被覆寫，請確認備份檔後重試。')
    }
  }

  const runUpdateAction = async (
    action: () => Promise<AppUpdateStatus>,
    timeoutMs = UPDATE_OPERATION_TIMEOUT_MS
  ): Promise<void> => {
    setUpdateBusy(true)
    setOperationError(null)
    try {
      setUpdateStatus(await withTimeout(action(), timeoutMs, '更新操作逾時，請稍後再試。'))
    } catch (error) {
      setOperationError(
        error instanceof Error && error.message
          ? error.message
          : '更新操作失敗，請稍後再試。'
      )
    } finally {
      setUpdateBusy(false)
    }
  }

  const checkUpdate = (): Promise<void> =>
    runUpdateAction(() => window.api.update.check())

  const downloadUpdate = (): Promise<void> =>
    runUpdateAction(
      () => window.api.update.download(),
      UPDATE_PREPARATION_TIMEOUT_MS
    )

  const installUpdate = (): Promise<void> =>
    runUpdateAction(onInstallUpdate)

  const setBackgroundPreparation = (enabled: boolean): Promise<void> =>
    runUpdateAction(() =>
      window.api.update.setBackgroundPreparation(enabled)
    )

  return {
    traceCount,
    updateStatus,
    updateBusy,
    subscribeUpdateStatus,
    loadTraceCount,
    loadUpdateStatus,
    exportBackup,
    importBackup,
    exportTraces,
    clearTraces,
    checkUpdate,
    downloadUpdate,
    installUpdate,
    setBackgroundPreparation
  }
}
