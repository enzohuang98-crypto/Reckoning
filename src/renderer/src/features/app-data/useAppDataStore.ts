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
  setDataError: (message: string | null) => void
  saveCurrentData: (snapshot?: AppDataSnapshot) => void
  updateAppData: (updater: (current: AppDataSnapshot) => AppDataSnapshot) => void
  importData: (snapshot: AppDataSnapshot) => void
}

export function useAppDataStore(): AppDataStore {
  const [appData, setAppData] = useState<AppDataSnapshot>(EMPTY_APP_DATA)
  const [dataReady, setDataReady] = useState(false)
  const [dataError, setDataError] = useState<string | null>(null)
  const appDataRef = useRef(appData)
  const saveQueue = useRef(Promise.resolve())

  useEffect(() => {
    appDataRef.current = appData
  }, [appData])

  const saveCurrentData = useCallback((snapshot = appDataRef.current): void => {
    saveQueue.current = saveQueue.current
      .then(async () => {
        const saved = await window.api.data.save(snapshot)
        if (!saved.ok) setDataError(saved.message)
        else setDataError(null)
      })
      .catch(() => {
        setDataError('儲存失敗，畫面內容仍保留；請稍後重試或匯出備份。')
      })
  }, [])

  const updateAppData = useCallback(
    (updater: (current: AppDataSnapshot) => AppDataSnapshot): void => {
      const next = updater(appDataRef.current)
      appDataRef.current = next
      setAppData(next)
      if (dataReady) saveCurrentData(next)
    },
    [dataReady, saveCurrentData]
  )

  const importData = useCallback((snapshot: AppDataSnapshot): void => {
    appDataRef.current = snapshot
    setAppData(snapshot)
  }, [])

  useEffect(() => {
    let cancelled = false
    void (async () => {
      const loaded = await withTimeout(
        window.api.data.load(),
        10_000,
        '讀取本機資料逾時'
      )
      if (cancelled) return
      let snapshot = loaded.ok ? loaded.snapshot : EMPTY_APP_DATA
      if (!loaded.ok) setDataError(loaded.message)

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
          else setDataError(migrated.message)
        }
      }

      if (!cancelled) {
        appDataRef.current = snapshot
        setAppData(snapshot)
        setDataReady(true)
      }
    })().catch(() => {
      if (!cancelled) {
        setDataError('無法讀取本機資料，已使用空白資料。')
        setDataReady(true)
      }
    })
    return () => {
      cancelled = true
    }
  }, [])

  return {
    appData,
    dataReady,
    dataError,
    setDataError,
    saveCurrentData,
    updateAppData,
    importData
  }
}
