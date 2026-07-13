import { useEffect, useRef, useState } from 'react'
import type { BoardState } from '@shared/types/BoardState'
import type { EngineAnalysisResultPayload } from '@shared/types/ipc'
import type { AIExplanationResponse } from '@shared/types/AIExplanationTypes'
import type { MistakeBookEntry } from '@shared/types/MistakeBookEntry'
import type { SubmittedGuess, UserGuess } from '@shared/types/UserGuess'
import { MISTAKE_LEVEL_LABELS } from '@shared/types/MoveComparisonResult'
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
  explanation: AIExplanationResponse | null
  onAddMistake: (entry: MistakeBookEntry) => void
  onRecordGuess: (guess: UserGuess) => void
  onRequestExplanation: () => void
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
  explanation,
  onAddMistake,
  onRecordGuess,
  onRequestExplanation
}: Props): JSX.Element {
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [savedToBook, setSavedToBook] = useState(false)
  const recordedGuessKeys = useRef(new Set<string>())

  const comparison = result?.moveComparison ?? null
  const ea = result?.engineAnalysis ?? null
  const hasGuessResult = comparison !== null && comparison.userMove.length > 0
  const isCorrect = hasGuessResult && comparison.userMove === comparison.engineBestMove
  const canSave =
    hasGuessResult &&
    comparison.mistakeLevel !== 'unknown' &&
    comparison.mistakeLevel !== 'acceptable_or_tiny_inaccuracy'
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
        <span className={hasGuessResult ? 'done' : submittedGuess ? 'active' : ''}>3 看比較</span>
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
      {submittedGuess !== null && result !== null && (
        <div className="muted small guess-lock-note">
          已完成本次比較；按「修改猜著」會清除目前比較並重新分析。
        </div>
      )}
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
          disabled={submittedGuess !== null}
          onChange={(event) => onDraftReasonChange(event.target.value)}
        />
      </div>
      {submitError && <div className="error-text">⚠ {submitError}</div>}
      {submittedGuess && !result && <div className="success-text">✓ 猜著已鎖定，正在自動分析。</div>}

      {hasGuessResult && (
        <div className={`guess-result ${isCorrect ? 'correct' : 'wrong'}`}>
          {isCorrect
            ? '✓ 猜中引擎最佳著法！'
            : `引擎最佳：${ea?.displayBestMove ?? '無法辨識著法'}　你的著法：${
                formatChineseMove(board, comparison.userMove) ?? '無法辨識著法'
              }`}
          <div>
            等級：<b>{MISTAKE_LEVEL_LABELS[comparison.mistakeLevel]}</b>
          </div>
          <div className="muted small guess-engine-line">
            最佳主線｜原始分數：{ea?.scoreAfterBestMove?.raw ?? '無'}｜
            {ea?.displayPrincipalVariation?.slice(0, 8).join('、') || '無主線'}
          </div>
          {(ea?.displayUserMovePrincipalVariation ?? []).length > 1 && (
            <div className="muted small guess-engine-line">
              你的著法主線｜原始分數：{ea?.scoreAfterUserMove?.raw ?? '無'}｜
              {ea?.displayUserMovePrincipalVariation?.slice(0, 8).join('、')}
            </div>
          )}
          {comparison.uncertaintyReasons.length > 0 && (
            <div className="muted small">
              不確定原因：{comparison.uncertaintyReasons.join('；')}
            </div>
          )}
          {!isCorrect && (
            <div className="guess-explain-hint">
              {explanation ? (
                <span className="success-text small">
                  ✓ AI 已解釋原因，見上方「AI 解說」。
                </span>
              ) : (
                <span className="muted small">
                  想知道為什麼？
                  <button type="button" className="text-link" onClick={onRequestExplanation}>
                    請 AI 解說
                  </button>
                </span>
              )}
            </div>
          )}
          {canSave && (
            <div className="row gap guess-result-actions">
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
