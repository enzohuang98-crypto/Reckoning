import { useCallback, useEffect, useRef, useState } from 'react'
import {
  cloneAppDataSnapshot,
  EMPTY_APP_DATA,
  type AppDataSnapshot
} from '@shared/types/AppData'
import { withTimeout } from '../../utils/withTimeout'

interface AppDataStore {
  appData: AppDataSnapshot
  dataReady: boolean
  dataError: string | null
  dataRecoveryRequired: boolean
  dataRecoveryBusy: boolean
  setDataError: (message: string | null) => void
  getCurrentDataSnapshot: () => AppDataSnapshot
  saveCurrentData: (snapshot?: AppDataSnapshot) => void
  flushCurrentData: () => Promise<boolean>
  retryLoadData: () => void
  updateAppData: (updater: (current: AppDataSnapshot) => AppDataSnapshot) => void
  importData: (snapshot: AppDataSnapshot) => void
}

interface LoadedAppData {
  snapshot: AppDataSnapshot
  warning: string | null
}

export async function flushLatestSnapshot<T extends object>(
  getCurrent: () => T,
  persist: (snapshot: T) => Promise<boolean>,
  clone: (snapshot: T) => T
): Promise<boolean> {
  while (true) {
    const source = getCurrent()
    if (!(await persist(clone(source)))) return false
    if (getCurrent() === source) return true
  }
}

const DATA_RECOVERY_FALLBACK =
  '無法讀取本機資料；原始資料檔已保留，程式不會以空白資料覆蓋它。'
const DATA_SAVE_TIMEOUT_MS = 15_000

function recoveryMessage(message?: string): string {
  return `${message?.trim() || DATA_RECOVERY_FALLBACK} 請按「重新讀取資料」再試一次；成功前新增、修改、刪除與儲存會保持暫停。`
}

export function useAppDataStore(): AppDataStore {
  const [appData, setAppData] = useState<AppDataSnapshot>(EMPTY_APP_DATA)
  const [dataReady, setDataReady] = useState(false)
  const [operationError, setOperationError] = useState<string | null>(null)
  const [dataRecoveryError, setDataRecoveryError] = useState<string | null>(null)
  const [dataRecoveryRequired, setDataRecoveryRequired] = useState(false)
  const [dataRecoveryBusy, setDataRecoveryBusy] = useState(false)
  const appDataRef = useRef(appData)
  const saveQueue = useRef(Promise.resolve())
  const dataReadBlockedRef = useRef(false)
  const reloadInFlightRef = useRef(false)

  const dataError = dataRecoveryError ?? operationError

  const setDataError = useCallback((message: string | null): void => {
    setOperationError(message)
  }, [])

  const getCurrentDataSnapshot = useCallback(
    (): AppDataSnapshot => cloneAppDataSnapshot(appDataRef.current),
    []
  )

  useEffect(() => {
    appDataRef.current = appData
  }, [appData])

  const saveCurrentData = useCallback((snapshot = appDataRef.current): void => {
    if (dataReadBlockedRef.current) {
      setDataRecoveryError((current) => current ?? recoveryMessage())
      return
    }
    saveQueue.current = saveQueue.current
      .then(async () => {
        const saved = await withTimeout(
          window.api.data.save(snapshot),
          DATA_SAVE_TIMEOUT_MS,
          '儲存本機資料逾時；畫面內容仍保留。'
        )
        if (!saved.ok) setOperationError(saved.message)
        else setOperationError(null)
      })
      .catch(() => {
        setOperationError('儲存失敗，畫面內容仍保留；請稍後重試或匯出備份。')
      })
  }, [])

  const flushCurrentData = useCallback(async (): Promise<boolean> => {
    if (dataReadBlockedRef.current) {
      setDataRecoveryError((current) => current ?? recoveryMessage())
      return false
    }
    return flushLatestSnapshot(
      () => appDataRef.current,
      async (snapshot) => {
        let succeeded = false
        const operation = saveQueue.current
          .then(async () => {
            const saved = await withTimeout(
              window.api.data.save(snapshot),
              DATA_SAVE_TIMEOUT_MS,
              '儲存本機資料逾時；畫面內容仍保留。'
            )
            succeeded = saved.ok
            if (!saved.ok) setOperationError(saved.message)
            else setOperationError(null)
          })
          .catch(() => {
            succeeded = false
            setOperationError('儲存失敗，畫面內容仍保留；請稍後重試或匯出備份。')
          })
        saveQueue.current = operation
        await operation
        return succeeded
      },
      cloneAppDataSnapshot
    )
  }, [])

  const updateAppData = useCallback(
    (updater: (current: AppDataSnapshot) => AppDataSnapshot): void => {
      if (dataReadBlockedRef.current) {
        setDataRecoveryError((current) => current ?? recoveryMessage())
        return
      }
      const next = updater(appDataRef.current)
      appDataRef.current = next
      setAppData(next)
      if (dataReady) saveCurrentData(next)
    },
    [dataReady, saveCurrentData]
  )

  const importData = useCallback((snapshot: AppDataSnapshot): void => {
    dataReadBlockedRef.current = false
    appDataRef.current = snapshot
    setAppData(snapshot)
    setDataRecoveryRequired(false)
    setDataRecoveryError(null)
    setOperationError(null)
  }, [])

  const readDataFromDisk = useCallback(async (): Promise<LoadedAppData> => {
    const loaded = await withTimeout(
      window.api.data.load(),
      10_000,
      '讀取本機資料逾時；原始資料檔仍保持不變。'
    )
    if (!loaded.ok) throw new Error(loaded.message)

    return { snapshot: loaded.snapshot, warning: null }
  }, [])

  const applyLoadedData = useCallback(({ snapshot, warning }: LoadedAppData): void => {
    dataReadBlockedRef.current = false
    appDataRef.current = snapshot
    setAppData(snapshot)
    setDataRecoveryRequired(false)
    setDataRecoveryError(null)
    setOperationError(warning)
    setDataReady(true)
  }, [])

  const blockDataWrites = useCallback((message?: string): void => {
    dataReadBlockedRef.current = true
    setDataRecoveryRequired(true)
    setDataRecoveryError(recoveryMessage(message))
    setDataReady(true)
  }, [])

  const retryLoadData = useCallback((): void => {
    if (reloadInFlightRef.current) return
    reloadInFlightRef.current = true
    setDataRecoveryBusy(true)
    void readDataFromDisk()
      .then(applyLoadedData)
      .catch((error: unknown) => {
        blockDataWrites(error instanceof Error ? error.message : undefined)
      })
      .finally(() => {
        reloadInFlightRef.current = false
        setDataRecoveryBusy(false)
      })
  }, [applyLoadedData, blockDataWrites, readDataFromDisk])

  useEffect(() => {
    let cancelled = false
    void readDataFromDisk()
      .then((loaded) => {
        if (!cancelled) applyLoadedData(loaded)
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          blockDataWrites(error instanceof Error ? error.message : undefined)
        }
      })
    return () => {
      cancelled = true
    }
  }, [applyLoadedData, blockDataWrites, readDataFromDisk])

  return {
    appData,
    dataReady,
    dataError,
    dataRecoveryRequired,
    dataRecoveryBusy,
    setDataError,
    getCurrentDataSnapshot,
    saveCurrentData,
    flushCurrentData,
    retryLoadData,
    updateAppData,
    importData
  }
}
