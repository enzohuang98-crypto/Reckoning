import { useCallback, useEffect, useRef, useState } from 'react'
import { parseFen } from '@shared/logic/board/fen'
import type {
  AIConversation,
  MisunderstoodPosition,
  SavedPosition
} from '@shared/types/AppData'
import type { MistakeBookEntry } from '@shared/types/MistakeBookEntry'
import type { AppSettings } from '@shared/types/Settings'
import type { UserGuess } from '@shared/types/UserGuess'
import { AppShell, type AppTab } from './app/AppShell'
import { LICENSE_GATE_DISABLED } from './app/productFlags'
import { StartupScreen } from './app/StartupScreen'
import { AnalysisWorkspace } from './features/workspace/AnalysisWorkspace'
import { useAppDataStore } from './features/app-data/useAppDataStore'
import { useBoardWorkspace } from './features/board/useBoardWorkspace'
import { LicensePage } from './pages/LicensePage'
import { MistakeBookPage } from './pages/MistakeBookPage'
import { MisunderstoodPage } from './pages/MisunderstoodPage'
import { SettingsPage } from './pages/SettingsPage'
import { SetupWizard } from './pages/SetupWizard'
import {
  isSetupCompleted,
  loadSettings,
  markSetupCompleted,
  saveSettings
} from './storage/localSettings'
import { withTimeout } from './utils/withTimeout'

type SetupState = 'checking' | 'wizard' | 'done'
type LicenseState = 'checking' | 'locked' | 'ok'

export function App(): JSX.Element {
  const [activeTab, setActiveTab] = useState<AppTab>('analyze')
  const [analysisCommandMount, setAnalysisCommandMount] = useState<HTMLDivElement | null>(null)
  const [settings, setSettings] = useState<AppSettings>(() => loadSettings())
  const [activeConversation, setActiveConversation] = useState<AIConversation | null>(null)
  const [setupState, setSetupState] = useState<SetupState>(() =>
    isSetupCompleted() ? 'done' : 'checking'
  )
  const [licenseState, setLicenseState] = useState<LicenseState>('checking')
  const pendingConversationId = useRef<string | null>(null)

  const {
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
  } = useAppDataStore()
  const {
    board,
    canUndo,
    canRedo,
    changeBoard,
    undo,
    redo,
    restoreOriginal
  } = useBoardWorkspace()

  useEffect(() => {
    let cancelled = false
    void withTimeout(window.api.secret.status(), 10_000, 'API Key 狀態查詢逾時')
      .then((status) => {
        const active = status.activeCredential
        const currentIsLoopback =
          settings.aiProvider === 'openai-compatible' &&
          /^http:\/\/(?:localhost|127\.0\.0\.1|\[::1\])(?::\d+)?(?:\/|$)/i.test(
            settings.aiBaseUrl
          )
        if (
          cancelled ||
          currentIsLoopback ||
          !status.configured ||
          !active ||
          (
            active.provider === settings.aiProvider &&
            active.model === settings.aiModel &&
            (active.baseUrl ?? '') ===
              (settings.aiProvider === 'openai-compatible'
                ? settings.aiBaseUrl
                : '')
          )
        ) return
        const next = {
          ...settings,
          aiProvider: active.provider,
          aiModel: active.model,
          aiBaseUrl:
            active.provider === 'openai-compatible'
              ? active.baseUrl ?? ''
              : ''
        }
        const saved = saveSettings(next)
        if (!saved.ok) {
          setDataError(saved.message ?? '無法同步 API Key 的 Provider 設定。')
          return
        }
        setSettings(next)
      })
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (setupState !== 'checking') return
    let cancelled = false
    void withTimeout(
      Promise.all([window.api.engine.status(), window.api.secret.status()]),
      10_000,
      '初始設定檢查逾時'
    )
      .then(([engineStatus, secretStatus]) => {
        if (cancelled) return
        if (
          secretStatus.configured ||
          (engineStatus.available && engineStatus.pathSource !== 'resource')
        ) {
          const marked = markSetupCompleted()
          if (!marked.ok) setDataError(marked.message ?? '無法保存初始設定狀態。')
          setSetupState('done')
        } else {
          setSetupState('wizard')
        }
      })
      .catch(() => {
        if (!cancelled) setSetupState('wizard')
      })
    return () => {
      cancelled = true
    }
  }, [setupState, setDataError])

  useEffect(() => {
    let cancelled = false
    void withTimeout(window.api.license.status(), 10_000, '授權狀態查詢逾時')
      .then((status) => {
        if (!cancelled) setLicenseState(status.activated ? 'ok' : 'locked')
      })
      .catch(() => {
        if (!cancelled) setLicenseState('locked')
      })
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    const conversationId = pendingConversationId.current
    pendingConversationId.current = null
    setActiveConversation(
      conversationId
        ? appData.conversations.find((item) => item.id === conversationId) ?? null
        : null
    )
  }, [board.fen])

  const openPosition = useCallback(
    (fen: string): void => {
      const parsed = parseFen(fen)
      if (!parsed.valid) {
        setDataError(`無法開啟局面：${parsed.message}`)
        return
      }
      changeBoard(parsed.board)
      setActiveTab('analyze')
    },
    [changeBoard, setDataError]
  )

  const openMisunderstoodPosition = useCallback(
    (entry: MisunderstoodPosition): void => {
      pendingConversationId.current = entry.conversationId ?? null
      if (entry.positionFen === board.fen) {
        setActiveConversation(
          entry.conversationId
            ? appData.conversations.find((item) => item.id === entry.conversationId) ?? null
            : null
        )
        setActiveTab('analyze')
        return
      }
      openPosition(entry.positionFen)
    },
    [appData.conversations, board.fen, openPosition]
  )

  const addMistake = useCallback(
    (entry: MistakeBookEntry): void => {
      updateAppData((current) => ({
        ...current,
        mistakeBookEntries: [
          entry,
          ...current.mistakeBookEntries.filter((item) => item.id !== entry.id)
        ]
      }))
    },
    [updateAppData]
  )

  const recordGuess = useCallback(
    (guess: UserGuess): void => {
      updateAppData((current) => ({
        ...current,
        userGuesses: [guess, ...current.userGuesses.filter((item) => item.id !== guess.id)]
      }))
    },
    [updateAppData]
  )

  const changeConversation = useCallback(
    (conversation: AIConversation | null): void => {
      setActiveConversation(conversation)
      if (!conversation) return
      updateAppData((current) => ({
        ...current,
        conversations: [
          conversation,
          ...current.conversations.filter((item) => item.id !== conversation.id)
        ]
      }))
    },
    [updateAppData]
  )

  const saveMisunderstood = useCallback(
    (entry: MisunderstoodPosition): void => {
      updateAppData((current) => ({
        ...current,
        misunderstoodPositions: [entry, ...current.misunderstoodPositions]
      }))
    },
    [updateAppData]
  )

  const savePosition = useCallback(
    (name: string): void => {
      const now = new Date().toISOString()
      const position: SavedPosition = {
        id: crypto.randomUUID(),
        name,
        fen: board.fen,
        createdAt: now,
        updatedAt: now
      }
      updateAppData((current) => ({
        ...current,
        savedPositions: [position, ...current.savedPositions]
      }))
    },
    [board.fen, updateAppData]
  )

  if (licenseState === 'checking') return <StartupScreen phase="license" />
  if (setupState === 'checking') return <StartupScreen phase="setup" />
  if (!dataReady) return <StartupScreen phase="data" />

  if (licenseState === 'locked' && !LICENSE_GATE_DISABLED) {
    return <LicensePage onActivated={() => setLicenseState('ok')} />
  }

  if (setupState === 'wizard') {
    return (
      <SetupWizard
        settings={settings}
        onSettingsChange={setSettings}
        onComplete={() => setSetupState('done')}
      />
    )
  }

  return (
    <AppShell
      activeTab={activeTab}
      onTabChange={setActiveTab}
      dataError={dataError}
      dataRecoveryRequired={dataRecoveryRequired}
      dataRecoveryBusy={dataRecoveryBusy}
      onRetryLoad={retryLoadData}
      onRetrySave={() => saveCurrentData(appData)}
      onAnalysisCommandMountChange={setAnalysisCommandMount}
    >
      <AnalysisWorkspace
        hidden={activeTab !== 'analyze'}
        headerCommandMount={analysisCommandMount}
        board={board}
        settings={settings}
        canUndo={canUndo}
        canRedo={canRedo}
        onBoardChange={changeBoard}
        onUndo={undo}
        onRedo={redo}
        onRestoreOriginal={restoreOriginal}
        savedPositions={appData.savedPositions}
        onSavePosition={savePosition}
        onLoadSavedPosition={(position) => openPosition(position.fen)}
        onDeleteSavedPosition={(id) =>
          updateAppData((current) => ({
            ...current,
            savedPositions: current.savedPositions.filter((item) => item.id !== id)
          }))
        }
        conversation={activeConversation}
        onConversationChange={changeConversation}
        onAddMistake={addMistake}
        onRecordGuess={recordGuess}
        onSaveMisunderstood={saveMisunderstood}
      />

      {activeTab === 'settings' && (
        <SettingsPage
          settings={settings}
          onSettingsChange={setSettings}
          onDataImported={importData}
        />
      )}

      {activeTab === 'mistakes' && (
        <MistakeBookPage
          entries={appData.mistakeBookEntries}
          onOpenPosition={openPosition}
          onChange={(entries) =>
            updateAppData((current) => ({ ...current, mistakeBookEntries: entries }))
          }
        />
      )}

      {activeTab === 'misunderstood' && (
        <MisunderstoodPage
          entries={appData.misunderstoodPositions}
          conversations={appData.conversations}
          onOpenPosition={openMisunderstoodPosition}
          onChange={(entries) =>
            updateAppData((current) => ({ ...current, misunderstoodPositions: entries }))
          }
          onMoveToMistakeBook={addMistake}
        />
      )}
    </AppShell>
  )
}
