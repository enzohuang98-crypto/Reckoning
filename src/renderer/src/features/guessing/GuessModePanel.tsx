import { useEffect, useRef, useState } from 'react'
import type { BoardState } from '@shared/types/BoardState'
import type { EngineAnalysisResultPayload } from '@shared/types/ipc'
import type { SubmittedGuess, UserGuess } from '@shared/types/UserGuess'
import { validateMoveInput } from '@shared/logic/validation/ValidationUtils'
import { formatChineseMove } from '@shared/logic/board/ChineseNotation'

interface Props {
  board: BoardState
  draftMove: string
  draftReason: string
  submittedGuess: SubmittedGuess | null
  onDraftMoveChange: (move: string) => void
  onDraftReasonChange: (reason: string) => void
  onSubmitGuess: (guess: SubmittedGuess) => void
  onUnlockGuess: () => void
  selectionActive: boolean
  onBeginMoveSelection: () => void
  onCancelMoveSelection: () => void
  result: EngineAnalysisResultPayload | null
  onRecordGuess: (guess: UserGuess) => void
}

export function GuessModePanel({
  board,
  draftMove,
  draftReason,
  submittedGuess,
  onDraftMoveChange,
  onDraftReasonChange,
  onSubmitGuess,
  onUnlockGuess,
  selectionActive,
  onBeginMoveSelection,
  onCancelMoveSelection,
  result,
  onRecordGuess
}: Props): JSX.Element {
  const [submitError, setSubmitError] = useState<string | null>(null)
  const recordedGuessKeys = useRef(new Set<string>())

  const comparison = result?.moveComparison ?? null
  const hasGuessResult = comparison !== null && comparison.userMove.length > 0
  const isCorrect = hasGuessResult && comparison.userMove === comparison.engineBestMove
  const selectedMove = submittedGuess?.move ?? draftMove
  const selectedMoveText = selectedMove
    ? formatChineseMove(board, selectedMove) ?? '無法辨識著法'
    : ''

  useEffect(() => {
    if (!result || !submittedGuess || !hasGuessResult) return
    const guessKey = `${comparison.positionFen}|${comparison.userMove}|${submittedGuess.submittedAt}`
    if (recordedGuessKeys.current.has(guessKey)) return
    recordedGuessKeys.current.add(guessKey)
    onRecordGuess({
      id: crypto.randomUUID(),
      fen: comparison.positionFen,
      guessMoveUci: comparison.userMove,
      reason: submittedGuess.reason,
      bestMoveUci: comparison.engineBestMove,
      isCorrect,
      scoreDifference: comparison.scoreDifference,
      mistakeLevel: comparison.mistakeLevel,
      createdAt: submittedGuess.submittedAt
    })
  }, [
    comparison,
    hasGuessResult,
    isCorrect,
    onRecordGuess,
    result,
    submittedGuess
  ])

  const submit = (): void => {
    const move = draftMove.trim().toLowerCase()
    if (!move) {
      setSubmitError('請先輸入猜測著法；若只想看局面分析，系統會自動顯示。')
      return
    }
    const check = validateMoveInput(board, move)
    if (!check.ok) {
      setSubmitError(`猜測著法不合法：${check.message}`)
      return
    }
    setSubmitError(null)
    onSubmitGuess({
      move,
      reason: draftReason.trim() || undefined,
      submittedAt: Date.now()
    })
  }

  return (
    <div className="guess-panel">
      <div className="panel-heading compact">
        <div>
          <span className="eyebrow">先想再看答案</span>
          <h3>你的著法</h3>
        </div>
      </div>
      <p className="muted small">
        點「你的著法」後，直接在棋盤依序點選棋子與目的地，再提交鎖定答案。
      </p>
      <div className="guess-steps" aria-label="猜著流程">
        <span className={draftMove || submittedGuess ? 'done' : 'active'}>1 選著法</span>
        <span className={submittedGuess ? 'done' : draftMove ? 'active' : ''}>2 提交猜著</span>
        <span className={submittedGuess ? 'active' : ''}>3 深度分析</span>
      </div>
      <div className="row gap">
        <input
          className={`text-input guess-move-picker ${selectionActive ? 'active' : ''}`}
          value={selectedMoveText}
          placeholder="你的著法：點此後到棋盤選擇"
          disabled={submittedGuess !== null}
          readOnly
          aria-label="你的著法"
          onClick={() => {
            if (submittedGuess === null) onBeginMoveSelection()
            setSubmitError(null)
          }}
        />
        {submittedGuess === null && draftMove && (
          <button
            className="btn ghost"
            onClick={() => {
              onDraftMoveChange('')
              onCancelMoveSelection()
              setSubmitError(null)
            }}
          >
            清除
          </button>
        )}
        {submittedGuess === null ? (
          <button className="btn" onClick={submit}>
            提交猜著
          </button>
        ) : (
          <button className="btn ghost" onClick={onUnlockGuess}>
            修改猜著
          </button>
        )}
      </div>
      {selectionActive && (
        <div className="guess-selection-note">
          請到棋盤先點選要走的棋子，再點目的地；選擇過程不會改變棋盤。
        </div>
      )}
      <div className="field guess-reason-field">
        <input
          className="text-input"
          value={submittedGuess?.reason ?? draftReason}
          placeholder="為什麼想走這步？（選填）"
          aria-label="為什麼想走這步"
          readOnly={submittedGuess !== null}
          onChange={(event) => onDraftReasonChange(event.target.value)}
        />
      </div>
      {submitError && <div className="error-text">⚠ {submitError}</div>}
      {submittedGuess && <div className="success-text">✓ 已提交，正在進行完整 AI 深度分析。</div>}
    </div>
  )
}
