import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { BoardEditor } from './components/BoardEditor'
import { FenInput } from './components/FenInput'
import { GameImportPanel } from './components/GameImportPanel'
import { AnalysisPanel } from './components/AnalysisPanel'
import { GuessModePanel } from './components/GuessModePanel'
import { SettingsPage } from './pages/SettingsPage'
import { SetupWizard } from './pages/SetupWizard'
import { LicensePage } from './pages/LicensePage'
import { MistakeBookPage } from './pages/MistakeBookPage'
import { MisunderstoodPage } from './pages/MisunderstoodPage'
import { parseFen } from '@shared/logic/fen'
import {
  commitBoard,
  createBoardTimeline,
  redoBoard,
  undoBoard
} from '@shared/logic/BoardTimeline'
import { START_FEN, type BoardState } from '@shared/types/BoardState'
import type { EngineAnalysisResultPayload } from '@shared/types/ipc'
import type { AIExplanationResponse } from '@shared/types/AIExplanationTypes'
import {
  clearLegacyMistakeBook,
  isSetupCompleted,
  loadLegacyMistakeBook,
  loadSettings,
  markSetupCompleted,
  saveSettings
} from './storage/localSettings'
import type { AppSettings } from '@shared/types/Settings'
import { PROVIDER_DEFAULT_MODELS } from '@shared/types/AIProviderTypes'
import {
  EMPTY_APP_DATA,
  type AIConversation,
  type AppDataSnapshot,
  type MisunderstoodPosition,
  type SavedPosition
} from '@shared/types/AppData'
import type { SubmittedGuess, UserGuess } from '@shared/types/UserGuess'
import type { MistakeBookEntry } from '@shared/types/MistakeBookEntry'

type Tab = 'analyze' | 'settings' | 'mistakes' | 'misunderstood'
type SetupState = 'checking' | 'wizard' | 'done'
type LicenseState = 'checking' | 'locked' | 'ok'

const LICENSE_GATE_DISABLED = true

function initialBoard(): BoardState {
  const parsed = parseFen(START_FEN)
  if (parsed.valid) return parsed.board
  throw new Error('內建開局 FEN 無效')
}

export function App(): JSX.Element {
  const [tab, setTab] = useState<Tab>('analyze')
  const [boardTimeline, setBoardTimeline] = useState(() =>
    createBoardTimeline(initialBoard())
  )
  const board = boardTimeline.entries[boardTimeline.index]
  const [settings, setSettings] = useState<AppSettings>(() => loadSettings())
  const [draftMove, setDraftMove] = useState('')
  const [draftReason, setDraftReason] = useState('')
  const [submittedGuess, setSubmittedGuess] = useState<SubmittedGuess | null>(null)
  const [guessSelectionActive, setGuessSelectionActive] = useState(false)
  const [result, setResult] = useState<EngineAnalysisResultPayload | null>(null)
  const [explanation, setExplanation] = useState<AIExplanationResponse | null>(null)
  const [activeConversation, setActiveConversation] = useState<AIConversation | null>(null)
  const [appData, setAppData] = useState<AppDataSnapshot>(EMPTY_APP_DATA)
  const [dataReady, setDataReady] = useState(false)
  const [dataError, setDataError] = useState<string | null>(null)
  const [setupState, setSetupState] = useState<SetupState>(() =>
    isSetupCompleted() ? 'done' : 'checking'
  )
  const [licenseState, setLicenseState] = useState<LicenseState>('checking')
  const saveQueue = useRef(Promise.resolve())
  const pendingConversationId = useRef<string | null>(null)
  const appDataRef = useRef(appData)

  const changeBoard = useCallback((next: BoardState): void => {
    setBoardTimeline((current) => commitBoard(current, next))
  }, [])

  const undoCurrentBoard = useCallback((): void => {
    setBoardTimeline((current) => undoBoard(current))
  }, [])

  const redoCurrentBoard = useCallback((): void => {
    setBoardTimeline((current) => redoBoard(current))
  }, [])

  const restoreOriginalBoard = useCallback((): void => {
    changeBoard(initialBoard())
  }, [changeBoard])

  useEffect(() => {
    appDataRef.current = appData
  }, [appData])

  useEffect(() => {
    let cancelled = false
    void window.api.secret
      .status()
      .then((status) => {
        if (cancelled || !status.provider || status.provider === settings.aiProvider) return
        const defaultModel =
          PROVIDER_DEFAULT_MODELS[status.provider].find((model) => model.isDefault) ??
          PROVIDER_DEFAULT_MODELS[status.provider][0]
        const next = {
          ...settings,
          aiProvider: status.provider,
          aiModel: defaultModel.id
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

  const saveCurrentData = useCallback((snapshot: AppDataSnapshot): void => {
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

  useEffect(() => {
    let cancelled = false
    void (async () => {
      const loaded = await window.api.data.load()
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

  useEffect(() => {
    let cancelled = false
    window.api.license
      .status()
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
    setResult(null)
    setExplanation(null)
    setDraftMove('')
    setDraftReason('')
    setSubmittedGuess(null)
    setGuessSelectionActive(false)
    const conversationId = pendingConversationId.current
    pendingConversationId.current = null
    setActiveConversation(
      conversationId
        ? appDataRef.current.conversations.find((item) => item.id === conversationId) ?? null
        : null
    )
  }, [board.fen])

  useEffect(() => {
    if (setupState !== 'checking') return
    let cancelled = false
    void (async () => {
      try {
        const [path, secretStatus] = await Promise.all([
          window.api.engine.getPath(),
          window.api.secret.status()
        ])
        if (cancelled) return
        if (path || secretStatus.configured) {
          const marked = markSetupCompleted()
          if (!marked.ok) setDataError(marked.message ?? '無法保存初始設定狀態。')
          setSetupState('done')
        } else {
          setSetupState('wizard')
        }
      } catch {
        if (!cancelled) setSetupState('wizard')
      }
    })()
    return () => {
      cancelled = true
    }
  }, [setupState])

  const tabs = useMemo(
    () => [
      { id: 'analyze' as const, label: '分析' },
      { id: 'mistakes' as const, label: '錯題本' },
      { id: 'misunderstood' as const, label: '待理解局面' },
      { id: 'settings' as const, label: '設定' }
    ],
    []
  )

  const openPosition = useCallback((fen: string): void => {
    const parsed = parseFen(fen)
    if (!parsed.valid) {
      setDataError(`無法開啟局面：${parsed.message}`)
      return
    }
    changeBoard(parsed.board)
    setTab('analyze')
  }, [changeBoard])

  const openMisunderstoodPosition = useCallback(
    (entry: MisunderstoodPosition): void => {
      pendingConversationId.current = entry.conversationId ?? null
      openPosition(entry.positionFen)
    },
    [openPosition]
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
        userGuesses: [
          guess,
          ...current.userGuesses.filter((item) => item.id !== guess.id)
        ]
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

  const importData = useCallback((snapshot: AppDataSnapshot): void => {
    appDataRef.current = snapshot
    setAppData(snapshot)
  }, [])

  if (licenseState === 'checking' || setupState === 'checking' || !dataReady) {
    return <div className="app" />
  }

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
    <div className="app">
      <header className="app-header">
        <div className="app-brand">
          <span className="brand-seal" aria-hidden="true">象</span>
          <div>
            <div className="app-title">象理</div>
            <div className="app-subtitle">本機象棋研究工具</div>
          </div>
        </div>
        <nav className="app-nav">
          {tabs.map((item) => (
            <button
              key={item.id}
              className={`nav-btn ${tab === item.id ? 'active' : ''}`}
              onClick={() => setTab(item.id)}
            >
              {item.label}
            </button>
          ))}
        </nav>
      </header>

      {dataError && (
        <div className="global-storage-error">
          <span>⚠ {dataError}</span>
          <button className="btn ghost small" onClick={() => saveCurrentData(appData)}>
            重試儲存
          </button>
        </div>
      )}

      <main className="app-main">
        {tab === 'analyze' && (
          <div className="analyze-page">
            <div className="page-heading">
              <div>
                <span className="eyebrow">棋盤 · 引擎 · AI 教練</span>
                <h1>局面分析工作台</h1>
                <p>每次走棋後自動更新分析，也可悔棋、前進並隨時還原標準開局。</p>
              </div>
              <div className="heading-status">
                <span className="status-dot" />
                本機分析模式
              </div>
            </div>
            <div className="analyze-layout">
              <div className="left-col">
                <BoardEditor
                  board={board}
                  onChange={changeBoard}
                  canUndo={boardTimeline.index > 0}
                  canRedo={boardTimeline.index < boardTimeline.entries.length - 1}
                  onUndo={undoCurrentBoard}
                  onRedo={redoCurrentBoard}
                  onRestoreOriginal={restoreOriginalBoard}
                  guessSelectionActive={guessSelectionActive}
                  onGuessMoveSelected={(move) => {
                    setDraftMove(move)
                    setGuessSelectionActive(false)
                  }}
                  onGuessSelectionCancel={() => setGuessSelectionActive(false)}
                  savedPositions={appData.savedPositions}
                  onSavePosition={savePosition}
                  onLoadSavedPosition={(position) => openPosition(position.fen)}
                  onDeleteSavedPosition={(id) =>
                    updateAppData((current) => ({
                      ...current,
                      savedPositions: current.savedPositions.filter((item) => item.id !== id)
                    }))
                  }
                />
                <FenInput initialFen={board.fen} onValidBoard={changeBoard} />
                <GameImportPanel board={board} onBoardChange={changeBoard} />
              </div>
              <div className="right-col">
                <GuessModePanel
                  board={board}
                  draftMove={draftMove}
                  draftReason={draftReason}
                  submittedGuess={submittedGuess}
                  onDraftMoveChange={setDraftMove}
                  onDraftReasonChange={setDraftReason}
                  onSubmitGuess={setSubmittedGuess}
                  onUnlockGuess={() => {
                    setSubmittedGuess(null)
                    setGuessSelectionActive(false)
                  }}
                  selectionActive={guessSelectionActive}
                  onBeginMoveSelection={() => setGuessSelectionActive(true)}
                  onCancelMoveSelection={() => setGuessSelectionActive(false)}
                  result={result}
                  explanation={explanation}
                  onAddMistake={addMistake}
                  onRecordGuess={recordGuess}
                />
                <AnalysisPanel
                  board={board}
                  settings={settings}
                  submittedGuess={submittedGuess}
                  conversation={activeConversation}
                  onConversationChange={changeConversation}
                  onResult={setResult}
                  onExplanation={setExplanation}
                  onSaveMisunderstood={saveMisunderstood}
                />
              </div>
            </div>
          </div>
        )}
        {tab === 'settings' && (
          <SettingsPage
            settings={settings}
            onSettingsChange={setSettings}
            onDataImported={importData}
          />
        )}
        {tab === 'mistakes' && (
          <MistakeBookPage
            entries={appData.mistakeBookEntries}
            onOpenPosition={openPosition}
            onChange={(entries) =>
              updateAppData((current) => ({ ...current, mistakeBookEntries: entries }))
            }
          />
        )}
        {tab === 'misunderstood' && (
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
      </main>
    </div>
  )
}
