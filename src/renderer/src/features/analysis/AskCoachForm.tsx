import { useEffect, useRef } from 'react'
import type { BoardState } from '@shared/types/BoardState'
import type { EngineAnalysisResultPayload } from '@shared/types/ipc'
import type { SubmittedGuess, UserGuess } from '@shared/types/UserGuess'
import { formatChineseMove } from '@shared/logic/board/ChineseNotation'
import type { ActualMoveSelection } from './types'

interface Props {
  board: BoardState
  /** 在匯入棋譜點選的實戰步；沒自己選著法時就用它。 */
  actualMove: ActualMoveSelection | null
  draftMove: string
  draftReason: string
  draftQuestion: string
  submittedGuess: SubmittedGuess | null
  onDraftMoveChange: (move: string) => void
  onDraftReasonChange: (reason: string) => void
  onDraftQuestionChange: (question: string) => void
  selectionActive: boolean
  onBeginMoveSelection: () => void
  onCancelMoveSelection: () => void
  onEditMove: () => void
  onAsk: () => void
  error: string | null
  result: EngineAnalysisResultPayload | null
  onRecordGuess: (guess: UserGuess) => void
  aiBusy: boolean
  aiError: string | null
  onRetryExplanation: () => void
}

/**
 * 「問 AI 教練」：著法、想法、問題都選填，只有一個送出按鈕。
 * 有著法 → 引擎比較這步與首選，AI 回應想法與問題；沒有著法 → 解說目前局面或回答問題。
 */
export function AskCoachForm({
  board,
  actualMove,
  draftMove,
  draftReason,
  draftQuestion,
  submittedGuess,
  onDraftMoveChange,
  onDraftReasonChange,
  onDraftQuestionChange,
  selectionActive,
  onBeginMoveSelection,
  onCancelMoveSelection,
  onEditMove,
  onAsk,
  error,
  result,
  onRecordGuess,
  aiBusy,
  aiError,
  onRetryExplanation
}: Props): JSX.Element {
  const recordedGuessKeys = useRef(new Set<string>())
  const comparison = result?.moveComparison ?? null
  const hasComparison = comparison !== null && comparison.userMove.length > 0

  const fromGame = !submittedGuess && !draftMove && actualMove !== null
  const shownMove = submittedGuess?.move ?? (draftMove || actualMove?.move || '')
  const shownMoveText = fromGame
    ? `${actualMove.displayMove}（棋譜第 ${actualMove.plyIndex + 1} 手）`
    : shownMove
      ? formatChineseMove(board, shownMove) ?? '無法辨識著法'
      : ''

  // 自己在棋盤選的著法才寫入猜著紀錄（備份會保留）；棋譜裡的實戰步不算。
  useEffect(() => {
    if (!result || !submittedGuess || submittedGuess.fromGame || !hasComparison) return
    const key = `${comparison.positionFen}|${comparison.userMove}|${submittedGuess.submittedAt}`
    if (recordedGuessKeys.current.has(key)) return
    recordedGuessKeys.current.add(key)
    onRecordGuess({
      id: crypto.randomUUID(),
      fen: comparison.positionFen,
      guessMoveUci: comparison.userMove,
      reason: submittedGuess.reason,
      bestMoveUci: comparison.engineBestMove,
      isCorrect: comparison.userMove === comparison.engineBestMove,
      scoreDifference: comparison.scoreDifference,
      mistakeLevel: comparison.mistakeLevel,
      createdAt: submittedGuess.submittedAt
    })
  }, [comparison, hasComparison, onRecordGuess, result, submittedGuess])

  return (
    <div className="guess-panel ask-coach-form">
      <p className="inspector-mode-hint muted small">
        三格都可以留空：選了著法，AI 會比較這步和引擎首選；沒選就解說目前局面。
      </p>

      <div className="field">
        <label className="field-label" htmlFor="guess-move-input">你的走法（選填）</label>
        <div className="row gap">
          <input
            id="guess-move-input"
            className={`text-input guess-move-picker ${selectionActive ? 'active' : ''}`}
            value={shownMoveText}
            placeholder="點此後到棋盤選一步"
            disabled={submittedGuess !== null}
            readOnly
            aria-label="你的走法"
            onClick={() => {
              if (submittedGuess !== null) return
              // 再點一次就退出選擇，回到可以正常在棋盤走棋。
              if (selectionActive) onCancelMoveSelection()
              else onBeginMoveSelection()
            }}
          />
          {submittedGuess === null && selectionActive && !draftMove && (
            <button className="btn ghost" onClick={onCancelMoveSelection}>
              取消選擇
            </button>
          )}
          {submittedGuess === null && draftMove && (
            <button
              className="btn ghost"
              onClick={() => {
                onDraftMoveChange('')
                onCancelMoveSelection()
              }}
            >
              清除
            </button>
          )}
          {submittedGuess !== null && (
            <button className="btn ghost" onClick={onEditMove}>
              換一步
            </button>
          )}
        </div>
      </div>
      {selectionActive && (
        <div className="guess-selection-note">
          請到棋盤先點選要走的棋子，再點目的地；選擇過程不會改變棋盤。不選了可按「取消選擇」或 Esc。
        </div>
      )}

      <div className="field guess-reason-field">
        <label className="field-label" htmlFor="guess-reason-input">你的想法（選填）</label>
        <input
          id="guess-reason-input"
          className="text-input"
          value={submittedGuess?.reason ?? draftReason}
          placeholder="例如：我想趕快出車"
          aria-label="你的想法"
          readOnly={submittedGuess !== null}
          onChange={(event) => onDraftReasonChange(event.target.value)}
        />
      </div>

      <div className="field">
        <label className="field-label" htmlFor="ask-question-input">你的問題（選填）</label>
        <input
          id="ask-question-input"
          className="text-input"
          value={draftQuestion}
          placeholder="例如：為什麼這步不好？"
          aria-label="你的問題"
          disabled={aiBusy}
          onChange={(event) => onDraftQuestionChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.nativeEvent.isComposing) onAsk()
          }}
        />
      </div>

      <div className="row gap">
        <button className="btn" onClick={onAsk} disabled={aiBusy}>
          {aiBusy ? 'AI 解說中…' : '請 AI 解說'}
        </button>
        {aiError && !aiBusy && submittedGuess && (
          <button className="btn ghost" onClick={onRetryExplanation}>
            重試 AI 解說
          </button>
        )}
      </div>
      {error && <div className="error-text">⚠ {error}</div>}
    </div>
  )
}
