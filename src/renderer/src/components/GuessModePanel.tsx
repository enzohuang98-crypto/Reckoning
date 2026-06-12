import { useEffect, useRef, useState } from 'react'
import type { BoardState } from '@shared/types/BoardState'
import type { EngineAnalysisResultPayload } from '@shared/types/ipc'
import type { AIExplanationResponse } from '@shared/types/AIExplanationTypes'
import type { EngineScore } from '@shared/types/EngineAnalysis'
import type { MistakeBookEntry } from '@shared/types/MistakeBookEntry'
import type { SubmittedGuess, UserGuess } from '@shared/types/UserGuess'
import { MISTAKE_LEVEL_LABELS } from '@shared/types/MoveComparisonResult'
import { validateMoveInput } from '@shared/logic/ValidationUtils'

interface Props {
  board: BoardState
  draftMove: string
  draftReason: string
  submittedGuess: SubmittedGuess | null
  onDraftMoveChange: (move: string) => void
  onDraftReasonChange: (reason: string) => void
  onSubmitGuess: (guess: SubmittedGuess) => void
  onUnlockGuess: () => void
  result: EngineAnalysisResultPayload | null
  explanation: AIExplanationResponse | null
  onAddMistake: (entry: MistakeBookEntry) => void
  onRecordGuess: (guess: UserGuess) => void
}

const CONFIDENCE_LABEL = { low: '低', medium: '中', high: '高' } as const

function scoreText(score: EngineScore | null): string {
  return score === null ? '—' : score.displayText
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
  result,
  explanation,
  onAddMistake,
  onRecordGuess
}: Props): JSX.Element {
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [savedToBook, setSavedToBook] = useState(false)
  const recordedAnalysisIds = useRef(new Set<string>())

  const comparison = result?.moveComparison ?? null
  const ea = result?.engineAnalysis ?? null
  const hasGuessResult = comparison !== null && comparison.userMove.length > 0
  const isCorrect = hasGuessResult && comparison.userMove === comparison.engineBestMove
  const canSave =
    hasGuessResult &&
    comparison.mistakeLevel !== 'unknown' &&
    comparison.mistakeLevel !== 'acceptable_or_tiny_inaccuracy'

  useEffect(() => {
    if (!result || !submittedGuess || !hasGuessResult) return
    if (recordedAnalysisIds.current.has(result.analysisId)) return
    recordedAnalysisIds.current.add(result.analysisId)
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
      setSubmitError('請先輸入猜測著法；若只想分析局面，可直接按上方分析按鈕。')
      return
    }
    const check = validateMoveInput(board, move)
    if (!check.ok) {
      setSubmitError(`猜測著法不合法：${check.message}`)
      return
    }
    setSubmitError(null)
    setSavedToBook(false)
    onSubmitGuess({
      move,
      reason: draftReason.trim() || undefined,
      submittedAt: Date.now()
    })
  }

  const addToMistakeBook = (): void => {
    if (!comparison || !ea || savedToBook) return
    const now = new Date().toISOString()
    onAddMistake({
      id: crypto.randomUUID(),
      createdAt: now,
      updatedAt: now,
      positionFen: comparison.positionFen,
      sideToMove: comparison.sideToMove,
      userMove: comparison.userMove,
      engineBestMove: comparison.engineBestMove,
      evaluationAfterUserMove: comparison.evaluationAfterUserMove,
      evaluationAfterBestMove: comparison.evaluationAfterBestMove,
      scoreDifference: comparison.scoreDifference,
      mistakeLevel: comparison.mistakeLevel,
      confidence: comparison.confidence,
      uncertaintyReasons: comparison.uncertaintyReasons,
      explanation: explanation?.text ?? '',
      engineAnalysis: ea,
      userNote: submittedGuess?.reason,
      tags: [],
      understood: false
    })
    setSavedToBook(true)
  }

  return (
    <div className="guess-panel">
      <div className="panel-heading">
        <div>
          <span className="eyebrow">YOUR JUDGEMENT</span>
          <h3>猜著模式</h3>
        </div>
        <span className="panel-number">01</span>
      </div>
      <p className="muted small">
        先填著法與理由，按「提交猜著」鎖定答案，再執行引擎分析。
      </p>
      <div className="row gap">
        <input
          className="text-input mono"
          value={submittedGuess?.move ?? draftMove}
          placeholder="你的著法，如 h2e2"
          disabled={submittedGuess !== null}
          onChange={(event) => {
            onDraftMoveChange(event.target.value)
            setSubmitError(null)
          }}
        />
        {submittedGuess === null ? (
          <button className="btn" onClick={submit}>
            提交猜著
          </button>
        ) : (
          <button className="btn ghost" onClick={onUnlockGuess} disabled={result !== null}>
            修改猜著
          </button>
        )}
      </div>
      <div className="field" style={{ marginTop: 8 }}>
        <input
          className="text-input"
          value={submittedGuess?.reason ?? draftReason}
          placeholder="為什麼想走這步？（選填）"
          disabled={submittedGuess !== null}
          onChange={(event) => onDraftReasonChange(event.target.value)}
        />
      </div>
      {submitError && <div className="error-text">⚠ {submitError}</div>}
      {submittedGuess && !result && <div className="success-text">✓ 猜著已鎖定，可以開始分析。</div>}

      {hasGuessResult && (
        <div className={`guess-result ${isCorrect ? 'correct' : 'wrong'}`}>
          {isCorrect
            ? '✓ 猜中引擎最佳著法！'
            : `引擎最佳：${comparison.engineBestMove}　你的著法：${comparison.userMove}`}
          <div>
            等級：<b>{MISTAKE_LEVEL_LABELS[comparison.mistakeLevel]}</b>
            　評估差距：
            {comparison.scoreDifference === null
              ? '無法計算'
              : comparison.scoreDifference.toFixed(2)}
            　可信度：{CONFIDENCE_LABEL[comparison.confidence]}
          </div>
          <div className="muted small">
            你的著法後 {scoreText(ea?.scoreAfterUserMove ?? null)}　最佳著法後{' '}
            {scoreText(ea?.scoreAfterBestMove ?? null)}（原局面行棋方視角）
          </div>
          {comparison.uncertaintyReasons.length > 0 && (
            <div className="muted small">
              不確定原因：{comparison.uncertaintyReasons.join('；')}
            </div>
          )}
          {canSave && (
            <div className="row gap" style={{ marginTop: 8 }}>
              <button className="btn small" onClick={addToMistakeBook} disabled={savedToBook}>
                {savedToBook ? '✓ 已加入錯題本' : '加入錯題本'}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
