import { useCallback, useEffect, useRef, useState } from 'react'
import {
  EMPTY_APP_DATA,
  type AppDataSnapshot
} from '@shared/types/AppData'
import {
  clearLegacyMistakeBook,
  loadLegacyMistakeBook
} from '../../storage/localSettings'
import { withTimeout } from '../../utils/withTimeout'

interface AppDataStore {
  appData: AppDataSnapshot
  dataReady: boolean
  dataError: string | null
  dataRecoveryRequired: boolean
  dataRecoveryBusy: boolean
  setDataError: (message: string | null) => void
  saveCurrentData: (snapshot?: AppDataSnapshot) => void
  retryLoadData: () => void
  updateAppData: (updater: (current: AppDataSnapshot) => AppDataSnapshot) => void
  importData: (snapshot: AppDataSnapshot) => void
}

interface LoadedAppData {
  snapshot: AppDataSnapshot
  warning: string | null
}

const DATA_RECOVERY_FALLBACK =
  '無法讀取本機資料；原始資料檔已保留，程式不會以空白資料覆蓋它。'

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
        const saved = await window.api.data.save(snapshot)
        if (!saved.ok) setOperationError(saved.message)
        else setOperationError(null)
      })
      .catch(() => {
        setOperationError('儲存失敗，畫面內容仍保留；請稍後重試或匯出備份。')
      })
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

    let snapshot = loaded.snapshot
    let warning: string | null = null
    const legacy = loadLegacyMistakeBook()
    if (legacy.entries.length > 0) {
      const existingIds = new Set(snapshot.mistakeBookEntries.map((entry) => entry.id))
      const additions = legacy.entries.filter((entry) => !existingIds.has(entry.id))
      if (additions.length > 0) {
        snapshot = {
          ...snapshot,
          mistakeBookEntries: [...snapshot.mistakeBookEntries, ...additions]
        }
        const migrated = await window.api.data.save(snapshot)
        if (migrated.ok) void clearLegacyMistakeBook()
        else warning = migrated.message
      }
    }
    return { snapshot, warning }
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
    saveCurrentData,
    retryLoadData,
    updateAppData,
    importData
  }
}
