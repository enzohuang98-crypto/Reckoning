import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { BoardState } from '@shared/types/BoardState'
import type { AppSettings } from '@shared/types/Settings'
import type {
  EngineAnalysisProgressPayload,
  EngineAnalysisResultPayload,
  EngineStatus
} from '@shared/types/ipc'
import type { AIExplanationResponse } from '@shared/types/AIExplanationTypes'
import type { EngineScore } from '@shared/types/EngineAnalysis'
import type {
  AIConversation,
  ConversationMessage,
  MisunderstoodPosition
} from '@shared/types/AppData'
import type { SubmittedGuess } from '@shared/types/UserGuess'
import { validateMoveInput } from '@shared/logic/ValidationUtils'
import { formatChineseScore } from '@shared/logic/ChineseNotation'

interface Props {
  board: BoardState
  settings: AppSettings
  submittedGuess: SubmittedGuess | null
  conversation: AIConversation | null
  onConversationChange: (conversation: AIConversation | null) => void
  onResult: (payload: EngineAnalysisResultPayload | null) => void
  onExplanation: (explanation: AIExplanationResponse | null) => void
  onSaveMisunderstood: (entry: MisunderstoodPosition) => void
}

interface PendingAiRequest {
  question: string | null
  conversationId: string
}

const AUTO_ROOT_ANALYSIS_MAX_MS = 1500
const AUTO_USER_MOVE_ANALYSIS_MAX_MS = 700

function scoreText(score: EngineScore | null): string {
  return formatChineseScore(score)
}

function hasBothKings(board: BoardState): boolean {
  let red = false
  let black = false
  for (const row of board.grid) {
    for (const piece of row) {
      if (piece?.type !== 'king') continue
      if (piece.color === 'red') red = true
      else black = true
    }
  }
  return red && black
}

function progressPhaseText(phase: EngineAnalysisProgressPayload['phase']): string {
  switch (phase) {
    case 'preparing_engine':
      return '正在啟動 Pikafish'
    case 'root_analysis':
      return '正在分析目前局面'
    case 'user_move_analysis':
      return '正在驗證你的著法'
    case 'finalizing':
      return '正在整理分析結果'
  }
}

function estimateTokens(text: string): number {
  const ascii = text.replace(/[^\x00-\x7F]/g, '').length
  const nonAscii = text.length - ascii
  return Math.max(1, Math.ceil(ascii / 4 + nonAscii / 1.6))
}

function newMessage(role: ConversationMessage['role'], text: string): ConversationMessage {
  return {
    id: crypto.randomUUID(),
    role,
    text,
    createdAt: new Date().toISOString()
  }
}

export function AnalysisPanel({
  board,
  settings,
  submittedGuess,
  conversation,
  onConversationChange,
  onResult,
  onExplanation,
  onSaveMisunderstood
}: Props): JSX.Element {
  const [status, setStatus] = useState<EngineStatus | null>(null)
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState<EngineAnalysisProgressPayload | null>(null)
  const [cancelling, setCancelling] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [engineDiagnostics, setEngineDiagnostics] = useState<string[]>([])
  const [notice, setNotice] = useState<string | null>(null)
  const [result, setResult] = useState<EngineAnalysisResultPayload | null>(null)
  const [explanation, setExplanation] = useState<AIExplanationResponse | null>(null)
  const [aiBusy, setAiBusy] = useState(false)
  const [aiCancelling, setAiCancelling] = useState(false)
  const [streamingText, setStreamingText] = useState('')
  const [followUp, setFollowUp] = useState('')
  const [collectionReason, setCollectionReason] = useState('')
  const activeRequestId = useRef<string | null>(null)
  const activeAiRequestId = useRef<string | null>(null)
  const pendingAiRequest = useRef<PendingAiRequest | null>(null)
  const settingsRef = useRef(settings)
  const conversationRef = useRef(conversation)
  const resultRef = useRef(result)

  useEffect(() => {
    settingsRef.current = settings
  }, [settings])

  useEffect(() => {
    conversationRef.current = conversation
  }, [conversation])

  useEffect(() => {
    void (async () => {
      try {
        const current = await window.api.engine.status()
        if (!current.available) {
          setStatus(current)
          return
        }
        const test = await window.api.engine.test()
        setEngineDiagnostics(test.ok ? [] : test.diagnostics ?? [])
        setStatus(
          test.ok
            ? { ...current, protocol: test.protocol ?? current.protocol }
            : {
                ...current,
                available: false,
                message: test.message ?? '引擎無法完成搜尋測試。'
              }
        )
      } catch {
        setStatus({ available: false, engineName: '引擎', message: '無法查詢引擎狀態' })
      }
    })()
  }, [])

  useEffect(() => {
    if (activeRequestId.current) window.api.engine.cancelAnalysis(activeRequestId.current)
    if (activeAiRequestId.current) {
      window.api.ai.cancelExplanation(activeAiRequestId.current)
    }
    activeRequestId.current = null
    activeAiRequestId.current = null
    pendingAiRequest.current = null
    setBusy(false)
    setProgress(null)
    setCancelling(false)
    setAiBusy(false)
    setAiCancelling(false)
    setResult(null)
    setExplanation(null)
    setStreamingText('')
    setFollowUp('')
    setCollectionReason('')
    setError(null)
    setEngineDiagnostics([])
    setNotice(null)
    onResult(null)
    onExplanation(null)
  }, [board.fen, onConversationChange, onExplanation, onResult])

  useEffect(() => {
    const offProgress = window.api.engine.onAnalysisProgress((payload) => {
      if (payload.requestId !== activeRequestId.current) return
      setProgress(payload)
    })
    const offResult = window.api.engine.onAnalysisResult((payload) => {
      if (payload.requestId !== activeRequestId.current) return
      activeRequestId.current = null
      setBusy(false)
      setProgress(null)
      setCancelling(false)
      setResult(payload)
      onResult(payload)
    })
    const offError = window.api.engine.onAnalysisError((payload) => {
      if (payload.requestId !== activeRequestId.current) return
      activeRequestId.current = null
      setBusy(false)
      setProgress(null)
      setCancelling(false)
      if (payload.code === 'cancelled') setNotice('已取消分析。')
      else {
        setError(payload.message)
        setEngineDiagnostics(payload.diagnostics ?? [])
      }
    })
    const offAiChunk = window.api.ai.onExplanationChunk((payload) => {
      if (payload.requestId !== activeAiRequestId.current) return
      setStreamingText((previous) => previous + payload.deltaText)
    })
    const offAiDone = window.api.ai.onExplanationDone((payload) => {
      if (payload.requestId !== activeAiRequestId.current) return
      const pending = pendingAiRequest.current
      activeAiRequestId.current = null
      pendingAiRequest.current = null
      setAiBusy(false)
      setAiCancelling(false)
      setStreamingText('')
      const response: AIExplanationResponse = {
        text: payload.finalText,
        provider: settingsRef.current.aiProvider,
        model: settingsRef.current.aiModel,
        usage: payload.usage,
        createdAt: Date.now(),
        groundedOnEngineData: true
      }
      setExplanation(response)
      onExplanation(response)

      if (pending && resultRef.current) {
        const now = new Date().toISOString()
        const current = conversationRef.current
        const messages =
          pending.question === null
            ? [newMessage('assistant', payload.finalText)]
            : [
                ...(current?.messages ?? []),
                newMessage('user', pending.question),
                newMessage('assistant', payload.finalText)
              ]
        const next: AIConversation = {
          id: pending.conversationId,
          analysisId: resultRef.current.analysisId,
          positionFen: resultRef.current.engineAnalysis.positionFen,
          createdAt: current?.createdAt ?? now,
          updatedAt: now,
          messages
        }
        conversationRef.current = next
        onConversationChange(next)
      }
    })
    const offAiError = window.api.ai.onExplanationError((payload) => {
      if (payload.requestId !== activeAiRequestId.current) return
      activeAiRequestId.current = null
      pendingAiRequest.current = null
      setAiBusy(false)
      setAiCancelling(false)
      if (payload.code === 'cancelled') setNotice('已取消生成。')
      else setError(payload.message)
    })
    return () => {
      offProgress()
      offResult()
      offError()
      offAiChunk()
      offAiDone()
      offAiError()
    }
  }, [onConversationChange, onExplanation, onResult])

  useEffect(() => {
    resultRef.current = result
  }, [result])

  const startAnalysis = useCallback((automatic = false): void => {
    if (!hasBothKings(board)) {
      if (!automatic) setError('棋盤需要同時有紅帥與黑將才能分析。')
      return
    }
    if (activeRequestId.current) {
      window.api.engine.cancelAnalysis(activeRequestId.current)
    }
    setError(null)
    setEngineDiagnostics([])
    setNotice(null)
    setExplanation(null)
    onExplanation(null)

    const move = submittedGuess?.move ?? ''
    if (move) {
      const check = validateMoveInput(board, move)
      if (!check.ok) {
        setError(`你的猜測著法不合法：${check.message}`)
        return
      }
    }

    const requestId = crypto.randomUUID()
    activeRequestId.current = requestId
    setBusy(true)
    setProgress({
      requestId,
      phase: 'preparing_engine',
      elapsedMs: 0,
      targetMs: null,
      percent: 2,
      depth: null,
      score: null,
      displayPrincipalVariation: []
    })
    setResult(null)
    onResult(null)
    window.api.engine.startAnalysis({
      requestId,
      positionFen: board.fen,
      userMove: move || undefined,
      analysisConfig: {
        rootAnalysisMovetimeMs: automatic
          ? Math.min(settings.rootAnalysisMovetimeMs, AUTO_ROOT_ANALYSIS_MAX_MS)
          : settings.rootAnalysisMovetimeMs,
        userMoveEvalMovetimeMs: automatic
          ? Math.min(
              settings.userMoveEvalMovetimeMs,
              AUTO_USER_MOVE_ANALYSIS_MAX_MS
            )
          : settings.userMoveEvalMovetimeMs,
        multiPv: settings.multiPv
      }
    })
  }, [
    board,
    onExplanation,
    onResult,
    settings.multiPv,
    settings.rootAnalysisMovetimeMs,
    settings.userMoveEvalMovetimeMs,
    submittedGuess?.move
  ])

  useEffect(() => {
    if (!status?.available || !hasBothKings(board)) return
    const timer = window.setTimeout(() => startAnalysis(true), 450)
    return () => window.clearTimeout(timer)
  }, [board.fen, startAnalysis, status?.available, submittedGuess?.move])

  const cancelAnalysis = (): void => {
    if (!activeRequestId.current) return
    setCancelling(true)
    window.api.engine.cancelAnalysis(activeRequestId.current)
  }

  const generateExplanation = (question: string | null, regenerate = false): void => {
    if (!result) return
    const cleanedQuestion = question?.trim() || null
    const currentConversation = regenerate ? null : conversationRef.current
    const conversationId = currentConversation?.id ?? crypto.randomUUID()
    const requestId = crypto.randomUUID()
    activeAiRequestId.current = requestId
    pendingAiRequest.current = { question: cleanedQuestion, conversationId }
    setAiBusy(true)
    setAiCancelling(false)
    setError(null)
    setNotice(null)
    setStreamingText('')
    if (regenerate || cleanedQuestion === null) {
      setExplanation(null)
      onExplanation(null)
      if (regenerate) {
        conversationRef.current = null
        onConversationChange(null)
      }
    }
    window.api.ai.startExplanation({
      requestId,
      analysisId: result.analysisId,
      provider: settings.aiProvider,
      model: settings.aiModel,
      userLevel: settings.userLevel,
      explanationStyle: 'long_analytical',
      language: settings.language,
      conversationHistory: currentConversation?.messages,
      followUpQuestion: cleanedQuestion ?? undefined
    })
  }

  const submitFollowUp = (): void => {
    const question = followUp.trim()
    if (!question) return
    setFollowUp('')
    generateExplanation(question)
  }

  const copyExplanation = async (): Promise<void> => {
    const text = conversation?.messages.length
      ? conversation.messages
          .map((message) => `${message.role === 'user' ? '問' : '答'}：${message.text}`)
          .join('\n\n')
      : explanation?.text
    if (!text) return
    try {
      await navigator.clipboard.writeText(text)
      setNotice('已複製 AI 解說。')
    } catch {
      setError('無法存取剪貼簿，請手動選取文字複製。')
    }
  }

  const saveMisunderstood = (): void => {
    if (!result) return
    const now = new Date().toISOString()
    onSaveMisunderstood({
      id: crypto.randomUUID(),
      positionFen: result.engineAnalysis.positionFen,
      reason: collectionReason.trim() || '需要之後再研究',
      createdAt: now,
      updatedAt: now,
      analysisId: result.analysisId,
      engineAnalysis: result.engineAnalysis,
      moveComparison: result.moveComparison,
      explanation: explanation?.text,
      conversationId: conversation?.id
    })
    setCollectionReason('')
    setNotice('已收藏到「待理解局面」。')
  }

  const tokenEstimate = useMemo(() => {
    if (!result) return null
    const engineText = JSON.stringify({
      fen: result.engineAnalysis.positionFen,
      bestMove: result.engineAnalysis.bestMove,
      candidates: result.engineAnalysis.candidateMoves,
      comparison: result.moveComparison,
      conversation: conversation?.messages ?? []
    })
    return {
      input: estimateTokens(engineText),
      output: conversation ? 700 : 1800
    }
  }, [conversation, result])

  const cancelExplain = (): void => {
    if (!activeAiRequestId.current) return
    setAiCancelling(true)
    window.api.ai.cancelExplanation(activeAiRequestId.current)
  }

  const ea = result?.engineAnalysis ?? null
  const confidence = result?.moveComparison.confidence

  return (
    <div className="analysis-panel">
      <div className="panel-heading">
        <div>
          <span className="eyebrow">ENGINE & AI COACH</span>
          <h3>引擎分析</h3>
        </div>
        <span className="panel-number">02</span>
      </div>
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
          onClick={() => startAnalysis(false)}
          disabled={busy || aiBusy || !status?.available || !hasBothKings(board)}
        >
          {busy
            ? '分析中…'
            : '立即重新分析'}
        </button>
        {busy && (
          <button className="btn ghost" onClick={cancelAnalysis} disabled={cancelling}>
            {cancelling ? '取消中…' : '取消'}
          </button>
        )}
        <button
          className="btn ghost"
          onClick={() => generateExplanation(null, explanation !== null)}
          disabled={busy || aiBusy || !result}
        >
          {aiBusy ? '生成中…' : explanation ? '重新生成' : '請 AI 解說'}
        </button>
        {aiBusy && (
          <button className="btn ghost" onClick={cancelExplain} disabled={aiCancelling}>
            {aiCancelling ? '取消中…' : '取消生成'}
          </button>
        )}
      </div>
      <div className="muted small auto-analysis-note">
        {busy
          ? '局面已變更，正在自動更新分析結果。'
          : `自動分析已開啟（快速模式），每次局面變更最多思考 ${(
              Math.min(
                settings.rootAnalysisMovetimeMs,
                AUTO_ROOT_ANALYSIS_MAX_MS
              ) / 1000
            ).toFixed(1)} 秒；「立即重新分析」會使用完整設定時間。`}
      </div>

      {busy && progress && (
        <div className="live-analysis" aria-live="polite">
          <div className="live-analysis-head">
            <div>
              <b>{progressPhaseText(progress.phase)}</b>
              <span className="muted small">
                {progress.depth !== null ? `深度 ${progress.depth}` : '等待引擎資料'}
                {progress.elapsedMs > 0
                  ? `　已進行 ${(progress.elapsedMs / 1000).toFixed(1)} 秒`
                  : ''}
              </span>
            </div>
            <strong>{progress.percent}%</strong>
          </div>
          <div
            className="analysis-progress-track"
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={progress.percent}
          >
            <span style={{ width: `${progress.percent}%` }} />
          </div>
          {(progress.displayMove || progress.displayPrincipalVariation.length > 0) && (
            <div className="live-analysis-line">
              {progress.displayMove && (
                <span>
                  {progress.phase === 'user_move_analysis'
                    ? '對手目前最佳回應'
                    : '目前首選'}{' '}
                  <b>{progress.displayMove}</b>
                </span>
              )}
              {progress.score && <span>{scoreText(progress.score)}</span>}
              {progress.displayPrincipalVariation.length > 0 && (
                <span className="pv">
                  主要變例：{progress.displayPrincipalVariation.slice(0, 6).join('、')}
                </span>
              )}
            </div>
          )}
        </div>
      )}

      {tokenEstimate && (
        <div className="muted small">
          呼叫前 token 粗估：輸入約 {tokenEstimate.input}、輸出上限約 {tokenEstimate.output}。
        </div>
      )}
      {error && <div className="error-text">⚠ {error}</div>}
      {engineDiagnostics.length > 0 && (
        <details className="raw-engine-analysis">
          <summary>查看 Pikafish 診斷輸出</summary>
          <pre>{engineDiagnostics.join('\n')}</pre>
        </details>
      )}
      {notice && <div className="muted" style={{ marginTop: 8 }}>{notice}</div>}

      {ea && (
        <div className="analysis-result">
          <div className="result-head">
            最佳著法 <b>{ea.displayBestMove ?? '無法辨識著法'}</b>　評估{' '}
            {scoreText(ea.scoreAfterBestMove)}
            　深度 {ea.depth ?? '—'}
            {ea.analysisTimeMs !== undefined && (
              <span className="muted small">　({(ea.analysisTimeMs / 1000).toFixed(1)}s)</span>
            )}
          </div>
          {(ea.incomplete || confidence === 'low') && (
            <div className="engine-status warn">
              ⚠ {ea.warnings.length > 0
                ? ea.warnings.join('；')
                : `本次判斷可信度不足：${result?.moveComparison.uncertaintyReasons.join('；')}`}
            </div>
          )}
          <ol className="line-list">
            {ea.candidateMoves.map((candidate, index) => (
              <li key={`${index}-${candidate.move}`}>
                <b>{candidate.displayMove ?? '無法辨識著法'}</b>　{scoreText(candidate.score)}
                　<span className="pv">
                  {(candidate.displayPrincipalVariation ?? [])
                    .slice(0, 6)
                    .join('、')}
                </span>
              </li>
            ))}
          </ol>
          {ea.rawAnalysis && (
            <details className="raw-engine-analysis">
              <summary>查看 Pikafish 原始分析</summary>
              <h5>主局面分析</h5>
              <pre>{ea.rawAnalysis.root.join('\n') || '（沒有原始輸出）'}</pre>
              {ea.rawAnalysis.userMove && (
                <>
                  <h5>猜測著法二次分析</h5>
                  <pre>{ea.rawAnalysis.userMove.join('\n') || '（沒有原始輸出）'}</pre>
                </>
              )}
            </details>
          )}
        </div>
      )}

      {(aiBusy || (!explanation && streamingText)) && streamingText && (
        <div className="ai-explanation">
          <h4>AI 解說（{settings.aiModel}）{aiBusy ? '　生成中…' : '　（未完成）'}</h4>
          <p className="explanation-text">{streamingText}</p>
        </div>
      )}

      {conversation && (
        <div className="ai-explanation">
          <h4>AI 解說與追問（{settings.aiModel}）</h4>
          {conversation.messages.map((message) => (
            <div key={message.id} className={`conversation-message ${message.role}`}>
              <b>{message.role === 'user' ? '你問' : 'AI 教練'}</b>
              <p className="explanation-text">{message.text}</p>
            </div>
          ))}
          {explanation?.usage && (
            <div className="usage">
              token：輸入 {explanation.usage.inputTokens} / 輸出 {explanation.usage.outputTokens}
            </div>
          )}
          <div className="row gap follow-up-row">
            <input
              className="text-input"
              value={followUp}
              placeholder="針對這個局面繼續追問…"
              disabled={aiBusy}
              onChange={(event) => setFollowUp(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && !event.nativeEvent.isComposing) submitFollowUp()
              }}
            />
            <button
              className="btn"
              onClick={submitFollowUp}
              disabled={aiBusy || !result || !followUp.trim()}
            >
              追問
            </button>
            <button className="btn ghost" onClick={() => void copyExplanation()}>
              複製
            </button>
          </div>
          {!result && (
            <div className="muted small">請先重新分析此局面，再繼續追問。</div>
          )}
        </div>
      )}

      {result && (
        <div className="row gap collection-row">
          <input
            className="text-input"
            value={collectionReason}
            placeholder="收藏原因，例如：看不懂中炮交換"
            onChange={(event) => setCollectionReason(event.target.value)}
          />
          <button className="btn ghost" onClick={saveMisunderstood}>
            收藏待理解
          </button>
        </div>
      )}
    </div>
  )
}
