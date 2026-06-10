/**
 * 猜著模式面板 (GuessModePanel)
 *
 * 使用者先輸入一手猜測 (UCI)，按下後與引擎最佳著法比較，
 * 顯示是否正確、厘子損失與錯誤等級。
 *
 * MVP：需先在分析面板取得引擎分析。此處示範使用 MoveComparisonService。
 * 由於目前未對每個候選著法重新搜尋，實際著法分數以「最佳線分數」近似，
 * 若猜中最佳著法則 loss=0；否則以該著法是否在候選線中估分。
 */

import { useState } from 'react'
import type { EngineAnalysis } from '@shared/types/EngineAnalysis'
import { compareMove } from '@shared/logic/MoveComparisonService'
import { MOVE_QUALITY_LABELS, type MoveComparisonResult } from '@shared/types/MoveComparisonResult'

interface Props {
  analysis: EngineAnalysis | null
}

export function GuessModePanel({ analysis }: Props): JSX.Element {
  const [guess, setGuess] = useState('')
  const [result, setResult] = useState<MoveComparisonResult | null>(null)
  const [note, setNote] = useState<string | null>(null)

  const submit = (): void => {
    setNote(null)
    if (!analysis) {
      setNote('請先在分析面板執行引擎分析。')
      return
    }
    const trimmed = guess.trim()
    if (!/^[a-i]\d[a-i]\d$/.test(trimmed)) {
      setNote('請輸入合法 UCI 著法，例如 h2e2。')
      return
    }
    // 在候選線中尋找此著法的分數；找不到則以最差候選線分數近似
    const matched = analysis.lines.find((l) => l.bestMoveUci === trimmed)
    const playedScore = matched
      ? matched.score
      : analysis.lines[analysis.lines.length - 1]?.score ?? analysis.score

    const comparison = compareMove({
      playedMoveUci: trimmed,
      bestMoveUci: analysis.bestMoveUci,
      bestScore: analysis.score,
      playedScore
    })
    setResult(comparison)
  }

  const isCorrect = result && result.playedMoveUci === result.bestMoveUci

  return (
    <div className="guess-panel">
      <h3>猜著模式</h3>
      <div className="row gap">
        <input
          className="text-input mono"
          value={guess}
          placeholder="輸入你的著法，如 h2e2"
          onChange={(e) => setGuess(e.target.value)}
        />
        <button className="btn" onClick={submit}>
          提交猜測
        </button>
      </div>
      {note && <div className="error-text">⚠ {note}</div>}
      {result && (
        <div className={`guess-result ${isCorrect ? 'correct' : 'wrong'}`}>
          {isCorrect ? '✓ 猜中引擎最佳著法！' : `引擎最佳：${result.bestMoveUci}`}
          <div>
            等級：<b>{MOVE_QUALITY_LABELS[result.quality]}</b>
            　厘子損失：{result.centipawnLoss}　信心：{result.confidence}
          </div>
        </div>
      )}
    </div>
  )
}
