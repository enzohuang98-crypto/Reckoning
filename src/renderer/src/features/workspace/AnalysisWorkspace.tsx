import { useEffect, useRef, useState } from 'react'
import type { AIExplanationResponse } from '@shared/types/AIExplanationTypes'
import type {
  AIConversation,
  MisunderstoodPosition,
  SavedPosition
} from '@shared/types/AppData'
import type { BoardState } from '@shared/types/BoardState'
import type { MistakeBookEntry } from '@shared/types/MistakeBookEntry'
import type { AppSettings } from '@shared/types/Settings'
import type { EngineAnalysisResultPayload } from '@shared/types/ipc'
import type { SubmittedGuess, UserGuess } from '@shared/types/UserGuess'
import {
  AnalysisPanel,
  type AnalysisPanelHandle
} from '../analysis/AnalysisPanel'
import { AnalysisToolbar } from './AnalysisToolbar'
import { BoardEditor } from '../board/BoardEditor'
import { FenInput } from '../board/FenInput'
import { GameImportPanel } from '../board/GameImportPanel'
import { GuessModePanel } from '../guessing/GuessModePanel'
import { AnalysisInspectorTabs } from '../analysis/AnalysisInspectorTabs'
import {
  EMPTY_ANALYSIS_STATUS,
  type AnalysisPanelStatus,
  type AnalysisView
} from '../analysis/types'

interface Props {
  hidden: boolean
  board: BoardState
  settings: AppSettings
  canUndo: boolean
  canRedo: boolean
  onBoardChange: (board: BoardState) => void
  onUndo: () => void
  onRedo: () => void
  onRestoreOriginal: () => void
  savedPositions: SavedPosition[]
  onSavePosition: (name: string) => void
  onLoadSavedPosition: (position: SavedPosition) => void
  onDeleteSavedPosition: (id: string) => void
  conversation: AIConversation | null
  onConversationChange: (conversation: AIConversation | null) => void
  onAddMistake: (entry: MistakeBookEntry) => void
  onRecordGuess: (guess: UserGuess) => void
  onSaveMisunderstood: (entry: MisunderstoodPosition) => void
}

export function AnalysisWorkspace({
  hidden,
  board,
  settings,
  canUndo,
  canRedo,
  onBoardChange,
  onUndo,
  onRedo,
  onRestoreOriginal,
  savedPositions,
  onSavePosition,
  onLoadSavedPosition,
  onDeleteSavedPosition,
  conversation,
  onConversationChange,
  onAddMistake,
  onRecordGuess,
  onSaveMisunderstood
}: Props): JSX.Element {
  const [activeView, setActiveView] = useState<AnalysisView>('coach')
  const [draftMove, setDraftMove] = useState('')
  const [draftReason, setDraftReason] = useState('')
  const [submittedGuess, setSubmittedGuess] = useState<SubmittedGuess | null>(null)
  const [guessSelectionActive, setGuessSelectionActive] = useState(false)
  const [result, setResult] = useState<EngineAnalysisResultPayload | null>(null)
  const [explanation, setExplanation] = useState<AIExplanationResponse | null>(null)
  const [importOpen, setImportOpen] = useState(false)
  const [boardToolsOpen, setBoardToolsOpen] = useState(false)
  const [boardCompact, setBoardCompact] = useState(true)
  const [detailsOpen, setDetailsOpen] = useState(false)
  const [liveDockElement, setLiveDockElement] = useState<HTMLElement | null>(null)
  const [detailsDockElement, setDetailsDockElement] = useState<HTMLElement | null>(null)
  const [analysisStatus, setAnalysisStatus] =
    useState<AnalysisPanelStatus>(EMPTY_ANALYSIS_STATUS)
  const analysisPanelRef = useRef<AnalysisPanelHandle>(null)
  const analysisLayoutRef = useRef<HTMLDivElement>(null)
  const detailsCloseButtonRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    setResult(null)
    setExplanation(null)
    setDraftMove('')
    setDraftReason('')
    setSubmittedGuess(null)
    setGuessSelectionActive(false)
  }, [board.fen])

  const requestExplanation = (): void => {
    setActiveView('coach')
    analysisPanelRef.current?.requestExplanation()
  }

  const closeDetails = (): void => {
    setDetailsOpen(false)
    window.requestAnimationFrame(() => {
      document.getElementById('analysis-details-toggle')?.focus()
    })
  }

  useEffect(() => {
    const layout = analysisLayoutRef.current
    if (detailsOpen) {
      layout?.setAttribute('inert', '')
      window.requestAnimationFrame(() => detailsCloseButtonRef.current?.focus())
    } else {
      layout?.removeAttribute('inert')
    }

    return () => layout?.removeAttribute('inert')
  }, [detailsOpen])

  useEffect(() => {
    if (!detailsOpen) return
    const closeOnEscape = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      closeDetails()
    }
    window.addEventListener('keydown', closeOnEscape)
    return () => window.removeEventListener('keydown', closeOnEscape)
  }, [detailsOpen])

  return (
    <section
      className="analyze-page"
      hidden={hidden}
      aria-hidden={hidden}
      aria-label="象棋分析工作區"
    >
      <AnalysisToolbar
        importOpen={importOpen}
        onToggleImport={() => setImportOpen((current) => !current)}
        boardToolsOpen={boardToolsOpen}
        onToggleBoardTools={() => setBoardToolsOpen((current) => !current)}
        canUndo={canUndo}
        canRedo={canRedo}
        onUndo={onUndo}
        onRedo={onRedo}
        onRestoreOriginal={onRestoreOriginal}
        boardCompact={boardCompact}
        onToggleBoardSize={() => setBoardCompact((current) => !current)}
        detailsOpen={detailsOpen}
        onToggleDetails={() => {
          if (detailsOpen) closeDetails()
          else setDetailsOpen(true)
        }}
        activeView={activeView}
        onViewChange={setActiveView}
        status={analysisStatus}
        onStartAnalysis={() => analysisPanelRef.current?.startAnalysis()}
        onStopAnalysis={() => analysisPanelRef.current?.stopAll()}
        onRequestExplanation={requestExplanation}
      />

      <section
        id="analysis-data-drawer"
        className="analysis-data-drawer"
        hidden={!detailsOpen}
        aria-labelledby="analysis-data-drawer-title"
      >
        <div className="analysis-data-drawer-heading">
          <div>
            <span className="eyebrow">POSITION DATA</span>
            <h2 id="analysis-data-drawer-title">當前局面資料</h2>
          </div>
          <button
            ref={detailsCloseButtonRef}
            type="button"
            className="secondary-btn"
            onClick={closeDetails}
          >
            收起資料
          </button>
        </div>
        <div ref={setDetailsDockElement} />
      </section>

      <div
        ref={analysisLayoutRef}
        className={`analyze-layout${boardCompact ? ' board-compact' : ''}`}
        aria-hidden={detailsOpen}
      >
        <div className="left-col">
          <BoardEditor
            board={board}
            onChange={onBoardChange}
            toolsOpen={boardToolsOpen}
            guessSelectionActive={guessSelectionActive}
            onGuessMoveSelected={(move) => {
              setDraftMove(move)
              setGuessSelectionActive(false)
              setActiveView('guess')
            }}
            onGuessSelectionCancel={() => setGuessSelectionActive(false)}
            savedPositions={savedPositions}
            onSavePosition={onSavePosition}
            onLoadSavedPosition={onLoadSavedPosition}
            onDeleteSavedPosition={onDeleteSavedPosition}
          />

          {importOpen && (
            <div className="utility-drawer-body" aria-label="匯入棋局工具">
              <FenInput initialFen={board.fen} onValidBoard={onBoardChange} />
              <GameImportPanel board={board} onBoardChange={onBoardChange} />
            </div>
          )}
        </div>

        <aside className="right-col" aria-label="分析檢視">
          <div className="inspector-shell">
            <AnalysisInspectorTabs
              activeView={activeView}
              onChange={setActiveView}
              aiBusy={analysisStatus.aiBusy}
              hasExplanation={analysisStatus.hasExplanation}
            />

            <div className="inspector-content">
              <div hidden={activeView === 'guess'}>
                <AnalysisPanel
                  ref={analysisPanelRef}
                  visible
                  activeView="coach"
                  liveDockElement={liveDockElement}
                  detailsDockElement={detailsDockElement}
                  onActiveViewChange={setActiveView}
                  board={board}
                  settings={settings}
                  submittedGuess={submittedGuess}
                  conversation={conversation}
                  onConversationChange={onConversationChange}
                  onResult={setResult}
                  onExplanation={setExplanation}
                  onSaveMisunderstood={onSaveMisunderstood}
                  onStatusChange={setAnalysisStatus}
                />
              </div>

              <div
                hidden={activeView !== 'guess'}
                role="tabpanel"
                id="analysis-panel-guess"
                aria-labelledby="analysis-tab-guess"
              >
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
                    setResult(null)
                    setExplanation(null)
                  }}
                  selectionActive={guessSelectionActive}
                  onBeginMoveSelection={() => setGuessSelectionActive(true)}
                  onCancelMoveSelection={() => setGuessSelectionActive(false)}
                  result={result}
                  explanation={explanation}
                  onAddMistake={onAddMistake}
                  onRecordGuess={onRecordGuess}
                  onRequestExplanation={requestExplanation}
                />
              </div>
            </div>
          </div>
        </aside>
      </div>

      <section
        className="live-analysis-dock"
        ref={setLiveDockElement}
        aria-label="持續即時分析"
      />
    </section>
  )
}
