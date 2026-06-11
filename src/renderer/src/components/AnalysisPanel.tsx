/**
 * 分析面板 (AnalysisPanel) — SDS v0.2 §2.16、§2.17、§2.5
 *
 * 事件式引擎分析：產生 requestId 送 start，訂閱 result/error，
 * 進行中可取消（main 端 AbortController + UCI stop）。
 * 收到 cancelled 顯示「已取消」而非系統失敗。
 *
 * AI 解說為 streaming（§2.17.7）：只帶 analysisId，逐段 append chunk，
 * done 結束 loading，error 顯示訊息並保留 partial text；
 * 已收到 done 後同一 requestId 的事件一律忽略。
 */

import { useEffect, useRef, useState } from 'react'
import type { BoardState } from '@shared/types/BoardState'
import type { AppSettings } from '@shared/types/Settings'
import type {
  EngineAnalysisResultPayload,
  EngineStatus
} from '@shared/types/ipc'
import type { AIExplanationResponse } from '@shared/types/AIExplanationTypes'
import type { EngineScore } from '@shared/types/EngineAnalysis'
import { legalMoveCheck } from '@shared/logic/moves'
import { parseFen } from '@shared/logic/fen'

interface Props {
  board: BoardState
  settings: AppSettings
  /** 使用者猜的著法（來自猜棋區塊；可為空字串） */
  userMove: string
  onResult: (payload: EngineAnalysisResultPayload | null) => void
  onExplanation: (explanation: AIExplanationResponse | null) => void
}

/** 只用 displayText 顯示分數（raw 禁止進 UI；SDS §2.15.5） */
function scoreText(score: EngineScore | null): string {
  return score === null ? '—' : score.displayText
}

export function AnalysisPanel({
  board,
  settings,
  userMove,
  onResult,
  onExplanation
}: Props): JSX.Element {
  const [status, setStatus] = useState<EngineStatus | null>(null)
  const [busy, setBusy] = useState(false)
  const [cancelling, setCancelling] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [result, setResult] = useState<EngineAnalysisResultPayload | null>(null)
  const [explanation, setExplanation] = useState<AIExplanationResponse | null>(null)
  const [aiBusy, setAiBusy] = useState(false)
  const [aiCancelling, setAiCancelling] = useState(false)
  /** streaming 中逐段累積的文字（§2.17.7） */
  const [streamingText, setStreamingText] = useState('')
  /** 進行中分析的 requestId；過時事件一律忽略（§2.17.7 同款規則） */
  const activeRequestId = useRef<string | null>(null)
  /** 進行中 AI 生成的 requestId；done/error 後同 id 事件忽略（§2.17.7） */
  const activeAiRequestId = useRef<string | null>(null)

  /** 訂閱只建立一次，但 done 事件需要當下的 provider/model 設定 */
  const settingsRef = useRef(settings)
  useEffect(() => {
    settingsRef.current = settings
  }, [settings])

  useEffect(() => {
    window.api.engine
      .status()
      .then(setStatus)
      .catch(() =>
        setStatus({ available: false, engineName: '引擎', message: '無法查詢引擎狀態' })
      )
  }, [])

  useEffect(() => {
    const offResult = window.api.engine.onAnalysisResult((payload) => {
      if (payload.requestId !== activeRequestId.current) return
      activeRequestId.current = null
      setBusy(false)
      setCancelling(false)
      setResult(payload)
      onResult(payload)
    })
    const offError = window.api.engine.onAnalysisError((payload) => {
      if (payload.requestId !== activeRequestId.current) return
      activeRequestId.current = null
      setBusy(false)
      setCancelling(false)
      if (payload.code === 'cancelled') {
        // 取消不是系統失敗（§2.17.7）
        setNotice('已取消分析。')
      } else {
        setError(payload.message)
      }
    })
    // AI streaming 事件（§2.17.7）
    const offAiChunk = window.api.ai.onExplanationChunk((payload) => {
      if (payload.requestId !== activeAiRequestId.current) return
      setStreamingText((prev) => prev + payload.deltaText)
    })
    const offAiDone = window.api.ai.onExplanationDone((payload) => {
      if (payload.requestId !== activeAiRequestId.current) return
      activeAiRequestId.current = null
      setAiBusy(false)
      setAiCancelling(false)
      setStreamingText('')
      const response: AIExplanationResponse = {
        text: payload.finalText,
        provider: settingsRef.current.aiProvider,
        model: settingsRef.current.aiModel,
        usage: payload.usage,
        costUsd: payload.estimatedCostUsd ?? undefined,
        createdAt: Date.now(),
        groundedOnEngineData: true
      }
      setExplanation(response)
      onExplanation(response)
    })
    const offAiError = window.api.ai.onExplanationError((payload) => {
      if (payload.requestId !== activeAiRequestId.current) return
      activeAiRequestId.current = null
      setAiBusy(false)
      setAiCancelling(false)
      if (payload.code === 'cancelled') {
        // 取消不是系統失敗（§2.17.7）
        setNotice('已取消生成。')
      } else {
        setError(payload.message)
      }
      // partial text 保留在畫面上（streamingText 不清空）
    })
    return () => {
      offResult()
      offError()
      offAiChunk()
      offAiDone()
      offAiError()
    }
    // onResult 由 App 提供且穩定；訂閱僅建立一次
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const startAnalysis = (): void => {
    setError(null)
    setNotice(null)
    setExplanation(null)
    onExplanation(null)

    const trimmedMove = userMove.trim().toLowerCase()
    if (trimmedMove) {
      // 送引擎前先做合法性檢查，給出人話錯誤（main 端也會再驗一次）
      const parsed = parseFen(board.fen)
      if (parsed.valid) {
        const check = legalMoveCheck(parsed.board.grid, parsed.board.sideToMove, trimmedMove)
        if (!check.ok) {
          setError(`你的猜測著法不合法：${check.message}`)
          return
        }
      }
    }

    const requestId = crypto.randomUUID()
    activeRequestId.current = requestId
    setBusy(true)
    setResult(null)
    onResult(null)
    window.api.engine.startAnalysis({
      requestId,
      positionFen: board.fen,
      userMove: trimmedMove || undefined,
      analysisConfig: {
        rootAnalysisMovetimeMs: settings.rootAnalysisMovetimeMs,
        userMoveEvalMovetimeMs: settings.userMoveEvalMovetimeMs,
        multiPv: settings.multiPv
      }
    })
  }

  const cancelAnalysis = (): void => {
    if (!activeRequestId.current) return
    setCancelling(true)
    window.api.engine.cancelAnalysis(activeRequestId.current)
  }

  const explain = (): void => {
    if (!result) return
    const requestId = crypto.randomUUID()
    activeAiRequestId.current = requestId
    setAiBusy(true)
    setAiCancelling(false)
    setError(null)
    setNotice(null)
    setStreamingText('')
    setExplanation(null)
    onExplanation(null)
    window.api.ai.startExplanation({
      requestId,
      analysisId: result.analysisId,
      provider: settings.aiProvider,
      model: settings.aiModel,
      userLevel: settings.userLevel,
      explanationStyle: 'long_analytical',
      language: settings.language
    })
  }

  const cancelExplain = (): void => {
    if (!activeAiRequestId.current) return
    setAiCancelling(true)
    window.api.ai.cancelExplanation(activeAiRequestId.current)
  }

  const ea = result?.engineAnalysis ?? null
  const confidence = result?.moveComparison.confidence

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
        <button
          className="btn"
          onClick={startAnalysis}
          disabled={busy || aiBusy || !status?.available}
        >
          {busy ? '分析中…' : `分析局面（${(settings.rootAnalysisMovetimeMs / 1000).toFixed(1)} 秒）`}
        </button>
        {busy && (
          <button className="btn ghost" onClick={cancelAnalysis} disabled={cancelling}>
            {cancelling ? '取消中…' : '取消'}
          </button>
        )}
        <button className="btn ghost" onClick={explain} disabled={busy || aiBusy || !result}>
          {aiBusy ? '生成中…' : '請 AI 解說'}
        </button>
        {aiBusy && (
          <button className="btn ghost" onClick={cancelExplain} disabled={aiCancelling}>
            {aiCancelling ? '取消中…' : '取消生成'}
          </button>
        )}
      </div>

      {error && <div className="error-text">⚠ {error}</div>}
      {notice && <div className="muted" style={{ marginTop: 8 }}>{notice}</div>}

      {ea && (
        <div className="analysis-result">
          <div className="result-head">
            最佳著法 <b>{ea.bestMove}</b>　評估 {scoreText(ea.scoreAfterBestMove)}
            　深度 {ea.depth ?? '—'}
            {ea.analysisTimeMs !== undefined && (
              <span className="muted small">　({(ea.analysisTimeMs / 1000).toFixed(1)}s)</span>
            )}
          </div>
          {confidence === 'low' && (
            <div className="engine-status warn">
              ⚠ 本次判斷可信度不足：{result?.moveComparison.uncertaintyReasons.join('；')}
            </div>
          )}
          <ol className="line-list">
            {ea.candidateMoves.map((c, i) => (
              <li key={`${i}-${c.move}`}>
                <span className="mono">{c.move}</span>　{scoreText(c.score)}
                　<span className="pv">{c.principalVariation.slice(0, 6).join(' ')}</span>
              </li>
            ))}
          </ol>
        </div>
      )}

      {(aiBusy || (!explanation && streamingText)) && streamingText && (
        <div className="ai-explanation">
          <h4>AI 解說（{settings.aiModel}）{aiBusy ? '　生成中…' : '　（未完成）'}</h4>
          <p className="explanation-text">{streamingText}</p>
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
              {explanation.costUsd !== undefined
                ? `　≈ $${explanation.costUsd.toFixed(5)}`
                : '　成本：無法估算（此模型尚未設定價格）'}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
