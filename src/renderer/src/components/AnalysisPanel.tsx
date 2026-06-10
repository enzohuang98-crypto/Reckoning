/**
 * 分析面板 (AnalysisPanel)
 *
 * 顯示引擎狀態、執行引擎分析、列出候選著法，並可請 AI 解說。
 * 引擎不可用時（MVP 未內含 Pikafish）會顯示提示而非崩潰。
 */

import { useEffect, useState } from 'react'
import { formatScore, type EngineAnalysis } from '@shared/types/EngineAnalysis'
import type { EngineStatus } from '@shared/types/ipc'
import type { AIExplanationResponse } from '@shared/types/AIExplanationTypes'
import type { BoardState } from '@shared/types/BoardState'
import type { AppSettings } from '@shared/types/Settings'

interface Props {
  board: BoardState
  settings: AppSettings
  /** 分析完成時回呼上層（供猜著模式等共用） */
  onAnalysis?: (analysis: EngineAnalysis) => void
}

export function AnalysisPanel({ board, settings, onAnalysis }: Props): JSX.Element {
  const [status, setStatus] = useState<EngineStatus | null>(null)
  const [analysis, setAnalysis] = useState<EngineAnalysis | null>(null)
  const [explanation, setExplanation] = useState<AIExplanationResponse | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    window.api.engine
      .status()
      .then(setStatus)
      .catch(() => setStatus({ available: false, engineName: 'Pikafish', message: '無法查詢引擎狀態' }))
  }, [])

  const runAnalysis = async (): Promise<void> => {
    setBusy(true)
    setError(null)
    setExplanation(null)
    try {
      const result = await window.api.engine.analyze({
        fen: board.fen,
        depth: settings.engineDepth,
        multiPv: settings.engineMultiPv
      })
      setAnalysis(result)
      onAnalysis?.(result)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  const explain = async (): Promise<void> => {
    if (!analysis) return
    setBusy(true)
    setError(null)
    try {
      const response = await window.api.ai.explain({
        fen: board.fen,
        sideToMove: board.sideToMove,
        engineAnalysis: analysis,
        provider: settings.activeProvider,
        model: settings.selectedModels[settings.activeProvider],
        language: settings.language
      })
      setExplanation(response)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="analysis-panel">
      <h3>引擎分析</h3>
      {status && (
        <div className={`engine-status ${status.available ? 'ok' : 'warn'}`}>
          {status.available
            ? `✓ ${status.engineName} 就緒`
            : `⚠ ${status.message ?? `${status.engineName} 未就緒`}`}
        </div>
      )}

      <div className="row gap">
        <button className="btn" onClick={runAnalysis} disabled={busy || !status?.available}>
          {busy ? '分析中…' : `分析局面 (深度 ${settings.engineDepth})`}
        </button>
        <button className="btn ghost" onClick={explain} disabled={busy || !analysis}>
          請 AI 解說
        </button>
      </div>

      {error && <div className="error-text">⚠ {error}</div>}

      {analysis && (
        <div className="analysis-result">
          <div className="result-head">
            最佳著法 <b>{analysis.bestMoveUci}</b>　評估 {formatScore(analysis.score)}
            　深度 {analysis.depth}
          </div>
          <ol className="line-list">
            {analysis.lines.map((line) => (
              <li key={line.multipv}>
                <span className="mono">{line.bestMoveUci}</span>　{formatScore(line.score)}
                　<span className="pv">{line.pv.slice(0, 6).join(' ')}</span>
              </li>
            ))}
          </ol>
        </div>
      )}

      {explanation && (
        <div className="ai-explanation">
          <h4>AI 解說（{explanation.model}）</h4>
          <p className="explanation-text">{explanation.text}</p>
          {explanation.usage && (
            <div className="usage">
              token：輸入 {explanation.usage.inputTokens} / 輸出{' '}
              {explanation.usage.outputTokens}
              {explanation.costUsd !== undefined &&
                `　≈ $${explanation.costUsd.toFixed(5)}`}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
