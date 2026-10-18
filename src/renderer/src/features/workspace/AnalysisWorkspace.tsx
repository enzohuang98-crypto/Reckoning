import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { AIConversation, SavedPosition } from '@shared/types/AppData'
import type { BoardState } from '@shared/types/BoardState'
import type { AppSettings } from '@shared/types/Settings'
import type { EngineAnalysisResultPayload } from '@shared/types/ipc'
import type { EngineCandidateMove } from '@shared/types/EngineAnalysis'
import type { SubmittedGuess, UserGuess } from '@shared/types/UserGuess'
import {
  AnalysisPanel,
  type AnalysisPanelHandle
} from '../analysis/AnalysisPanel'
import { AnalysisToolbar } from './AnalysisToolbar'
import { BoardEditor } from '../board/BoardEditor'
import { FenInput } from '../board/FenInput'
import {
  EMPTY_GAME_IMPORT_STATE,
  GameImportPanel,
  type GameImportState,
  type ImportedMoveSelection
} from '../board/GameImportPanel'
import { AskCoachForm } from '../analysis/AskCoachForm'
import { buildCoachRequest } from '../analysis/coachRequest'
import {
  EMPTY_ANALYSIS_STATUS,
  type ActualMoveSelection,
  type AnalysisPanelStatus
} from '../analysis/types'

interface Props {
  hidden: boolean
  headerCommandMount: HTMLElement | null
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
  onRecordGuess: (guess: UserGuess) => void
  onOpenAiSettings: () => void
  onUnsavedDraftChange: (hasUnsavedDraft: boolean) => void
}

export function isUnsavedAnalysisDraft(
  draftMove: string,
  draftReason: string,
  submittedGuess: SubmittedGuess | null
): boolean {
  return submittedGuess === null && Boolean(draftMove.trim() || draftReason.trim())
}

export function AnalysisWorkspace({
  hidden,
  headerCommandMount,
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
  onRecordGuess,
  onOpenAiSettings,
  onUnsavedDraftChange
}: Props): JSX.Element {
  const [draftMove, setDraftMove] = useState('')
  const [draftReason, setDraftReason] = useState('')
  const [draftQuestion, setDraftQuestion] = useState('')
  const [askError, setAskError] = useState<string | null>(null)
  const [submittedGuess, setSubmittedGuess] = useState<SubmittedGuess | null>(null)
  const [actualMove, setActualMove] = useState<ActualMoveSelection | null>(null)
  const [gameImportState, setGameImportState] = useState<GameImportState>(
    EMPTY_GAME_IMPORT_STATE
  )
  const [guessSelectionActive, setGuessSelectionActive] = useState(false)
  const [result, setResult] = useState<EngineAnalysisResultPayload | null>(null)
  const [replayCandidates, setReplayCandidates] = useState<EngineCandidateMove[]>([])
  const [importOpen, setImportOpen] = useState(false)
  const [boardToolsOpen, setBoardToolsOpen] = useState(false)
  const [boardExpanded, setBoardExpanded] = useState(false)
  const [detailsOpen, setDetailsOpen] = useState(false)
  const [liveDockElement, setLiveDockElement] = useState<HTMLElement | null>(null)
  const [detailsDockElement, setDetailsDockElement] = useState<HTMLElement | null>(null)
  const [analysisStatus, setAnalysisStatus] =
    useState<AnalysisPanelStatus>(EMPTY_ANALYSIS_STATUS)
  const analysisPanelRef = useRef<AnalysisPanelHandle>(null)
  const analysisLayoutRef = useRef<HTMLDivElement>(null)
  const detailsCloseButtonRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    onUnsavedDraftChange(
      isUnsavedAnalysisDraft(draftMove, draftReason, submittedGuess)
    )
  }, [draftMove, draftReason, onUnsavedDraftChange, submittedGuess])

  useEffect(() => {
    setResult(null)
    setReplayCandidates([])
    setDraftMove('')
    setDraftReason('')
    setDraftQuestion('')
    setAskError(null)
    setSubmittedGuess(null)
    setGuessSelectionActive(false)
  }, [board.fen])

  const changeBoard = (next: BoardState): void => {
    setActualMove(null)
    onBoardChange(next)
  }

  const selectImportedMove = (selection: ImportedMoveSelection): void => {
    setResult(null)
    onConversationChange(null)
    setActualMove({
      selectionId: crypto.randomUUID(),
      positionFen: selection.position.fen,
      move: selection.move,
      displayMove: selection.displayMove,
      plyIndex: selection.plyIndex,
      selectedAt: Date.now()
    })
    setSubmittedGuess(null)
    setGuessSelectionActive(false)
    onBoardChange(selection.position)
  }

  /**
   * 「請 AI 解說」（表單與頂部工具列共用）：
   * 有著法（自己選的、已送出的或棋譜點的）→ 以這步建立一次請求，引擎比較後 AI 回應想法與問題；
   * 沒有著法 → 有問題就直接問目前局面，否則解說目前局面。
   */
  const askCoach = (): void => {
    if (analysisStatus.aiBusy) return
    const request = buildCoachRequest({
      board,
      draftMove,
      draftReason,
      draftQuestion,
      submittedGuess,
      actualMove,
      submissionId: crypto.randomUUID(),
      now: Date.now()
    })
    setAskError(null)
    if (request.kind === 'invalid') {
      setAskError(request.message)
      return
    }
    setGuessSelectionActive(false)
    if (request.kind === 'submit') {
      setSubmittedGuess(request.guess)
      setDraftQuestion('')
    } else if (request.kind === 'question') {
      analysisPanelRef.current?.askQuestion(request.question)
      setDraftQuestion('')
    } else {
      analysisPanelRef.current?.requestExplanation()
    }
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

  const headerCommands =
    !hidden && headerCommandMount
      ? createPortal(
          <AnalysisToolbar
            importOpen={importOpen}
            onToggleImport={() => setImportOpen((current) => !current)}
            boardToolsOpen={boardToolsOpen}
            onToggleBoardTools={() => setBoardToolsOpen((current) => !current)}
            canUndo={canUndo}
            canRedo={canRedo}
            onUndo={() => {
              setActualMove(null)
              onUndo()
            }}
            onRedo={() => {
              setActualMove(null)
              onRedo()
            }}
            onRestoreOriginal={() => {
              setActualMove(null)
              onRestoreOriginal()
            }}
            boardCompact={!boardExpanded}
            onToggleBoardSize={() => setBoardExpanded((current) => !current)}
            detailsOpen={detailsOpen}
            onToggleDetails={() => {
              if (detailsOpen) closeDetails()
              else setDetailsOpen(true)
            }}
            status={analysisStatus}
            onStartAnalysis={() => analysisPanelRef.current?.startAnalysis()}
            onStopAnalysis={() => analysisPanelRef.current?.stopAll()}
            onRequestExplanation={askCoach}
          />,
          headerCommandMount
        )
      : null

  return (
    <section
      className="analyze-page"
      hidden={hidden}
      aria-hidden={hidden}
      aria-label="象棋分析工作區"
    >
      {headerCommands}

      <section
        id="analysis-data-drawer"
        className="analysis-data-drawer"
        hidden={!detailsOpen}
        aria-labelledby="analysis-data-drawer-title"
      >
        <div className="analysis-data-drawer-heading">
          <h2 id="analysis-data-drawer-title">分析資料</h2>
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
        className={'analyze-layout' + (boardExpanded ? ' board-expanded' : '')}
        aria-hidden={detailsOpen}
      >
        <div className="left-col">
          <BoardEditor
            board={board}
            onChange={changeBoard}
            highlightedMove={actualMove?.move}
            toolsOpen={boardToolsOpen}
            guessSelectionActive={guessSelectionActive}
            onGuessMoveSelected={(move) => {
              setDraftMove(move)
              setGuessSelectionActive(false)
            }}
            onGuessSelectionCancel={() => setGuessSelectionActive(false)}
            savedPositions={savedPositions}
            onSavePosition={onSavePosition}
            onLoadSavedPosition={(position) => {
              setActualMove(null)
              onLoadSavedPosition(position)
            }}
        onDeleteSavedPosition={onDeleteSavedPosition}
        replayCandidates={replayCandidates}
          />

          <div
            className="utility-drawer-body"
            hidden={!importOpen}
            aria-hidden={!importOpen}
            aria-label="匯入棋局工具"
          >
            <FenInput initialFen={board.fen} onValidBoard={changeBoard} />
            <GameImportPanel
              board={board}
              state={gameImportState}
              onStateChange={setGameImportState}
              onBoardChange={changeBoard}
              onMoveSelect={selectImportedMove}
            />
          </div>
        </div>

        <aside className="right-col" aria-label="分析檢視">
          <div className="inspector-shell">
            <div className="inspector-tabs inspector-title" aria-label="分析模式">
              <span className="inspector-tab active">問 AI 教練</span>
            </div>

            <div className="inspector-content">
              <div>
                <AskCoachForm
                  board={board}
                  actualMove={actualMove}
                  draftMove={draftMove}
                  draftReason={draftReason}
                  draftQuestion={draftQuestion}
                  submittedGuess={submittedGuess}
                  onDraftMoveChange={setDraftMove}
                  onDraftReasonChange={setDraftReason}
                  onDraftQuestionChange={setDraftQuestion}
                  selectionActive={guessSelectionActive}
                  onBeginMoveSelection={() => {
                    setActualMove(null)
                    setGuessSelectionActive(true)
                  }}
                  onCancelMoveSelection={() => setGuessSelectionActive(false)}
                  onEditMove={() => {
                    setSubmittedGuess(null)
                    setGuessSelectionActive(false)
                    setResult(null)
                  }}
                  onAsk={askCoach}
                  error={askError}
                  result={result}
                  onRecordGuess={onRecordGuess}
                  aiBusy={analysisStatus.aiBusy}
                  aiError={analysisStatus.aiError}
                  onRetryExplanation={() => analysisPanelRef.current?.requestExplanation()}
                />
                <AnalysisPanel
                  ref={analysisPanelRef}
                  visible
                  activeView="coach"
                  liveDockElement={liveDockElement}
                  detailsDockElement={detailsDockElement}
                  board={board}
                  settings={settings}
                  submittedGuess={submittedGuess}
                  actualMove={actualMove}
                  conversation={conversation}
                  onConversationChange={onConversationChange}
                  onResult={setResult}
                  onReplayCandidates={setReplayCandidates}
                  onExplanation={() => undefined}
                  onStatusChange={setAnalysisStatus}
                  onOpenAiSettings={onOpenAiSettings}
                />
              </div>

            </div>
          </div>
        </aside>
      </div>

      <section
        className="live-analysis-dock"
        ref={setLiveDockElement}
        aria-label="局面分析"
      />
    </section>
  )
}
