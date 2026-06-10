/**
 * 猜著模式面板 (GuessModePanel)
 *
 * 使用者先輸入一手猜測 (UCI)，與引擎最佳著法比較，
 * 顯示是否正確、厘子損失與錯誤等級。
 *
 * 精確 loss：猜測著法若非引擎最佳著法，透過 engine:evaluateMove
 * 對「走完該著法後的局面」單獨搜尋（同深度），分數取負還原為走子方視角，
 * 與最佳著法分數相減取得精確損失（取代早期以候選線分數近似的作法）。
 *
 * 判定為錯著（非 OK）時可一鍵加入錯題本。
 */

import { useState } from 'react'
import { formatScore, type EngineAnalysis } from '@shared/types/EngineAnalysis'
import type { AppSettings } from '@shared/types/Settings'
import { compareMove } from '@shared/logic/MoveComparisonService'
import { basicMoveCheck } from '@shared/logic/moves'
import { parseFen } from '@shared/logic/fen'
import {
  MOVE_QUALITY_LABELS,
  type MoveComparisonResult
} from '@shared/types/MoveComparisonResult'
import { addMistakeEntry } from '../storage/localSettings'

interface Props {
  analysis: EngineAnalysis | null
  settings: AppSettings
}

export function GuessModePanel({ analysis, settings }: Props): JSX.Element {
  const [guess, setGuess] = useState('')
  const [result, setResult] = useState<MoveComparisonResult | null>(null)
  const [note, setNote] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  /** 目前 result 是否已加入錯題本（避免重複加入） */
  const [savedToBook, setSavedToBook] = useState(false)

  const submit = async (): Promise<void> => {
    setNote(null)
    setResult(null)
    setSavedToBook(false)
    if (!analysis) {
      setNote('請先在分析面板執行引擎分析。')
      return
    }
    const trimmed = guess.trim().toLowerCase()

    // 以「被分析的局面」為準做基本檢查（起點是輪走方棋子、終點非己方）
    const parsed = parseFen(analysis.fen)
    if (parsed.valid) {
      const check = basicMoveCheck(parsed.board.grid, analysis.sideToMove, trimmed)
      if (!check.ok) {
        setNote(check.message)
        return
      }
    }

    if (trimmed === analysis.bestMoveUci) {
      // 猜中最佳著法：loss = 0，不需額外搜尋
      setResult(
        compareMove({
          playedMoveUci: trimmed,
          bestMoveUci: analysis.bestMoveUci,
          bestScore: analysis.score,
          playedScore: analysis.score
        })
      )
      return
    }

    setBusy(true)
    try {
      const evaluation = await window.api.engine.evaluateMove({
        fen: analysis.fen,
        moveUci: trimmed,
        depth: analysis.depth
      })
      setResult(
        compareMove({
          playedMoveUci: trimmed,
          bestMoveUci: analysis.bestMoveUci,
          bestScore: analysis.score,
          playedScore: evaluation.score
        })
      )
    } catch (err) {
      setNote(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  const addToMistakeBook = (): void => {
    if (!analysis || !result || savedToBook) return
    addMistakeEntry({
      id: crypto.randomUUID(),
      createdAt: Date.now(),
      fen: analysis.fen,
      sideToMove: analysis.sideToMove,
      playedMoveUci: result.playedMoveUci,
      bestMoveUci: result.bestMoveUci,
      comparison: result,
      tags: []
    })
    setSavedToBook(true)
  }

  const isCorrect = result && result.playedMoveUci === result.bestMoveUci

  return (
    <div className="guess-panel">
      <h3>猜著模式</h3>
      <p className="muted small">先在上方執行引擎分析，再輸入你認為的最佳著法。</p>
      <div className="row gap">
        <input
          className="text-input mono"
          value={guess}
          placeholder="輸入你的著法，如 h2e2"
          disabled={busy}
          onChange={(e) => setGuess(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.nativeEvent.isComposing && !busy) {
              void submit()
            }
          }}
        />
        <button className="btn" onClick={() => void submit()} disabled={busy}>
          {busy ? '評估中…' : '提交猜測'}
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
          <div className="muted small">
            你的著法 {formatScore(result.playedScore)}　最佳著法{' '}
            {formatScore(result.bestScore)}（深度 {analysis?.depth ?? settings.engineDepth}）
          </div>
          {result.quality !== 'OK' && (
            <div className="row gap" style={{ marginTop: 8 }}>
              <button className="btn small" onClick={addToMistakeBook} disabled={savedToBook}>
                {savedToBook ? '✓ 已加入錯題本' : '➕ 加入錯題本'}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
