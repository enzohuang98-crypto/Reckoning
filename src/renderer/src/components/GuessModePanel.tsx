/**
 * 猜著模式面板 (GuessModePanel) — SDS v0.2 §2.5 猜棋頁
 *
 * 使用者在分析前先輸入猜測著法與理由（看答案前猜），按「分析局面」後
 * 由雙階段分析取得精確比較：candidate fast path 或二次分析（main 端）。
 * 結果顯示錯誤等級（六級）、評估差距、可信度與不確定原因；
 * 緩手以上可一鍵加入錯題本（理由帶入 userNote）。
 */

import { useState } from 'react'
import type { EngineAnalysisResultPayload } from '@shared/types/ipc'
import type { AIExplanationResponse } from '@shared/types/AIExplanationTypes'
import type { EngineScore } from '@shared/types/EngineAnalysis'
import { MISTAKE_LEVEL_LABELS } from '@shared/types/MoveComparisonResult'
import { addMistakeEntry } from '../storage/localSettings'

interface Props {
  /** 猜測著法（由 App 持有，分析時送往 main） */
  userMove: string
  onUserMoveChange: (move: string) => void
  /** 最近一次分析結果（含比較）；尚未分析為 null */
  result: EngineAnalysisResultPayload | null
  /** 最近一次 AI 解說（加入錯題本時一併保存） */
  explanation: AIExplanationResponse | null
}

const CONFIDENCE_LABEL = { low: '低', medium: '中', high: '高' } as const

function scoreText(score: EngineScore | null): string {
  return score === null ? '—' : score.displayText
}

export function GuessModePanel({
  userMove,
  onUserMoveChange,
  result,
  explanation
}: Props): JSX.Element {
  const [reason, setReason] = useState('')
  const [savedToBook, setSavedToBook] = useState(false)

  const comparison = result?.moveComparison ?? null
  const ea = result?.engineAnalysis ?? null
  /** 只在這次結果確實帶了使用者著法時顯示比較 */
  const hasGuessResult = comparison !== null && comparison.userMove.length > 0
  const isCorrect = hasGuessResult && comparison.userMove === comparison.engineBestMove
  const canSave =
    hasGuessResult &&
    comparison.mistakeLevel !== 'unknown' &&
    comparison.mistakeLevel !== 'acceptable_or_tiny_inaccuracy'

  const addToMistakeBook = (): void => {
    if (!comparison || !ea || savedToBook) return
    const now = new Date().toISOString()
    addMistakeEntry({
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
      userNote: reason.trim() || undefined,
      tags: [],
      understood: false
    })
    setSavedToBook(true)
  }

  return (
    <div className="guess-panel">
      <h3>猜著模式</h3>
      <p className="muted small">
        先輸入你認為的最佳著法（可附理由），再按上方「分析局面」——看答案前先想，
        學習效果最好。留空則只做引擎分析。
      </p>
      <div className="row gap">
        <input
          className="text-input mono"
          value={userMove}
          placeholder="你的著法，如 h2e2（可留空）"
          onChange={(e) => {
            onUserMoveChange(e.target.value)
            setSavedToBook(false)
          }}
        />
      </div>
      <div className="field" style={{ marginTop: 8 }}>
        <input
          className="text-input"
          value={reason}
          placeholder="為什麼想走這步？（選填，加入錯題本時會保存）"
          onChange={(e) => setReason(e.target.value)}
        />
      </div>

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
                {savedToBook ? '✓ 已加入錯題本' : '➕ 加入錯題本'}
              </button>
            </div>
          )}
        </div>
      )}
      {!hasGuessResult && result && userMove.trim() && (
        <div className="muted small" style={{ marginTop: 8 }}>
          本次結果未包含猜測比較——著法是在分析開始後才輸入的，請再按一次「分析局面」。
        </div>
      )}
    </div>
  )
}
