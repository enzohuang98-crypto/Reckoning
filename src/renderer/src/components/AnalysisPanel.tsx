import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { BoardState } from '@shared/types/BoardState'
import type { AppSettings } from '@shared/types/Settings'
import type {
  EngineAnalysisProgressPayload,
  EngineAnalysisResultPayload,
  EngineStatus
} from '@shared/types/ipc'
import type { AIExplanationResponse } from '@shared/types/AIExplanationTypes'
import type {
  EngineRegistrySnapshot
} from '@shared/types/EngineRegistry'
import type {
  HarnessEvidence,
  HarnessProgressPayload
} from '@shared/types/Harness'
import type {
  AIConversation,
  ConversationMessage,
  MisunderstoodPosition
} from '@shared/types/AppData'
import type { SubmittedGuess } from '@shared/types/UserGuess'
import { validateMoveInput } from '@shared/logic/ValidationUtils'

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

interface EngineThoughtEntry {
  id: string
  phase: EngineAnalysisProgressPayload['phase']
  elapsedMs: number
  depth: number | null
  selDepth?: number | null
  nodes?: number | null
  nps?: number | null
  scoreRaw: string | null
  displayMove?: string
  displayPrincipalVariation: string[]
}

const AUTO_ROOT_ANALYSIS_MAX_MS = 1500
const AUTO_USER_MOVE_ANALYSIS_MAX_MS = 700
const MAX_ENGINE_THOUGHTS = 80

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
      return '正在啟動象棋引擎'
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

function formatLargeNumber(value?: number | null): string | null {
  if (value === undefined || value === null) return null
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}K`
  return String(value)
}

function formatElapsedMs(value: number): string {
  return `${(value / 1000).toFixed(1)}s`
}

function formatConsoleScore(entry: EngineThoughtEntry): string {
  return entry.scoreRaw ?? '等待分數'
}

function consolePhaseLabel(phase: EngineThoughtEntry['phase']): string {
  return phase === 'user_move_analysis' ? '你的著法後' : '局面分析'
}

function thoughtSignature(entry: EngineThoughtEntry): string {
  return [
    entry.phase,
    entry.depth ?? 'none',
    entry.selDepth ?? 'none',
    entry.scoreRaw ?? 'none',
    entry.displayMove ?? 'none',
    entry.displayPrincipalVariation.join('|')
  ].join('::')
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
  const [engineThoughts, setEngineThoughts] = useState<EngineThoughtEntry[]>([])
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
  const [engineRegistry, setEngineRegistry] = useState<EngineRegistrySnapshot>({
    installations: [],
    activeEngineId: null,
    verificationEngineId: null
  })
  const [primaryEngineId, setPrimaryEngineId] = useState<string | null>(null)
  const [verificationEngineId, setVerificationEngineId] = useState<string | null>(
    null
  )
  const [harnessProgress, setHarnessProgress] =
    useState<HarnessProgressPayload | null>(null)
  const [harnessEvidence, setHarnessEvidence] = useState<HarnessEvidence[]>([])
  const [harnessWarnings, setHarnessWarnings] = useState<string[]>([])
  const [traceId, setTraceId] = useState<string | null>(null)
  const activeRequestId = useRef<string | null>(null)
  const activeAnalysisKey = useRef<string | null>(null)
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
        const registry = await window.api.engine.listInstallations()
        setEngineRegistry(registry)
        setPrimaryEngineId(registry.activeEngineId)
        setVerificationEngineId(registry.verificationEngineId)
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
    activeAnalysisKey.current = null
    activeAiRequestId.current = null
    pendingAiRequest.current = null
    setBusy(false)
    setProgress(null)
    setEngineThoughts([])
    setCancelling(false)
    setAiBusy(false)
    setAiCancelling(false)
    setResult(null)
    setExplanation(null)
    setStreamingText('')
    setFollowUp('')
    setCollectionReason('')
    setHarnessProgress(null)
    setHarnessEvidence([])
    setHarnessWarnings([])
    setTraceId(null)
    setError(null)
    setEngineDiagnostics([])
    setNotice(null)
    onResult(null)
    onExplanation(null)
  }, [board.fen])

  useEffect(() => {
    const offProgress = window.api.engine.onAnalysisProgress((payload) => {
      if (payload.requestId !== activeRequestId.current) return
      setProgress(payload)
      if (
        payload.phase === 'preparing_engine' ||
        (payload.depth === null &&
          payload.score === null &&
          !payload.displayMove &&
          payload.displayPrincipalVariation.length === 0)
      ) {
        return
      }
      const entry: EngineThoughtEntry = {
        id: crypto.randomUUID(),
        phase: payload.phase,
        elapsedMs: payload.elapsedMs,
        depth: payload.depth,
        selDepth: payload.selDepth,
        nodes: payload.nodes,
        nps: payload.nps,
        scoreRaw: payload.score?.raw ?? null,
        displayMove: payload.displayMove,
        displayPrincipalVariation: payload.displayPrincipalVariation
      }
      setEngineThoughts((previous) => {
        const last = previous[previous.length - 1]
        if (last && thoughtSignature(last) === thoughtSignature(entry)) {
          return previous
        }
        return [...previous, entry].slice(-MAX_ENGINE_THOUGHTS)
      })
    })
    const offResult = window.api.engine.onAnalysisResult((payload) => {
      if (payload.requestId !== activeRequestId.current) return
      activeRequestId.current = null
      activeAnalysisKey.current = null
      setBusy(false)
      setProgress(null)
      setCancelling(false)
      setResult(payload)
      onResult(payload)
    })
    const offError = window.api.engine.onAnalysisError((payload) => {
      if (payload.requestId !== activeRequestId.current) return
      activeRequestId.current = null
      activeAnalysisKey.current = null
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
    const offHarnessProgress = window.api.ai.onHarnessProgress((payload) => {
      if (payload.requestId !== activeAiRequestId.current) return
      setHarnessProgress(payload)
    })
    const offAiDone = window.api.ai.onExplanationDone((payload) => {
      if (payload.requestId !== activeAiRequestId.current) return
      const pending = pendingAiRequest.current
      activeAiRequestId.current = null
      pendingAiRequest.current = null
      setAiBusy(false)
      setAiCancelling(false)
      setHarnessProgress(null)
      setStreamingText('')
      setHarnessEvidence(payload.evidence ?? [])
      setHarnessWarnings(payload.warnings ?? [])
      setTraceId(payload.traceId ?? null)
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
      setHarnessProgress(null)
      if (payload.code === 'cancelled') setNotice('已取消生成。')
      else setError(payload.message)
    })
    return () => {
      offProgress()
      offResult()
      offError()
      offAiChunk()
      offHarnessProgress()
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
    const move = submittedGuess?.move ?? ''
    if (move) {
      const check = validateMoveInput(board, move)
      if (!check.ok) {
        setError(`你的猜測著法不合法：${check.message}`)
        return
      }
    }

    const rootAnalysisMovetimeMs = automatic
      ? Math.min(settings.rootAnalysisMovetimeMs, AUTO_ROOT_ANALYSIS_MAX_MS)
      : settings.rootAnalysisMovetimeMs
    const userMoveEvalMovetimeMs = automatic
      ? Math.min(
          settings.userMoveEvalMovetimeMs,
          AUTO_USER_MOVE_ANALYSIS_MAX_MS
        )
      : settings.userMoveEvalMovetimeMs
    const analysisKey = [
      automatic ? 'auto' : 'manual',
      board.fen,
      move,
      primaryEngineId ?? '',
      settings.crossEngineEnabled && verificationEngineId ? verificationEngineId : '',
      rootAnalysisMovetimeMs,
      userMoveEvalMovetimeMs,
      settings.multiPv
    ].join('|')
    if (
      automatic &&
      activeRequestId.current &&
      activeAnalysisKey.current === analysisKey
    ) {
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

    const requestId = crypto.randomUUID()
    activeRequestId.current = requestId
    activeAnalysisKey.current = analysisKey
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
    setEngineThoughts([])
    setResult(null)
    onResult(null)
    window.api.engine.startAnalysis({
      requestId,
      engineId: primaryEngineId ?? undefined,
      verificationEngineId:
        settings.crossEngineEnabled && verificationEngineId
          ? verificationEngineId
          : undefined,
      positionFen: board.fen,
      userMove: move || undefined,
      analysisConfig: {
        rootAnalysisMovetimeMs,
        userMoveEvalMovetimeMs,
        multiPv: settings.multiPv
      }
    })
  }, [
    board,
    onExplanation,
    onResult,
    settings.multiPv,
    settings.crossEngineEnabled,
    settings.rootAnalysisMovetimeMs,
    settings.userMoveEvalMovetimeMs,
    submittedGuess?.move,
    primaryEngineId,
    verificationEngineId
  ])

  useEffect(() => {
    if (!status?.available || !hasBothKings(board)) return
    const timer = window.setTimeout(() => startAnalysis(true), 180)
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
    setHarnessProgress(null)
    setHarnessEvidence([])
    setHarnessWarnings([])
    setTraceId(null)
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
      followUpQuestion: cleanedQuestion ?? undefined,
      attachedMove: submittedGuess?.move,
      answerMode: settings.harnessAnswerMode,
      budget: {
        engineTimeMs: settings.harnessEngineTimeMs,
        maxEngineRounds: settings.harnessMaxEngineRounds,
        maxModelCalls:
          settings.harnessAnswerMode === 'research'
            ? settings.harnessResearchMaxModelCalls
            : settings.harnessFocusedMaxModelCalls,
        maxOutputTokens:
          settings.harnessAnswerMode === 'research'
            ? settings.harnessResearchMaxOutputTokens
            : settings.harnessFocusedMaxOutputTokens
      },
      engineId: primaryEngineId ?? undefined,
      verificationEngineId:
        settings.crossEngineEnabled && verificationEngineId
          ? verificationEngineId
          : undefined,
      reuseEvidence: settings.harnessReuseEvidence
    })
  }

  useEffect(() => {
    if (
      settings.harnessAutoRun &&
      result &&
      !aiBusy &&
      !explanation &&
      !conversationRef.current
    ) {
      generateExplanation(null)
    }
  }, [result?.analysisId, settings.harnessAutoRun])

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

  const continueExplain = (): void => {
    if (!activeAiRequestId.current) return
    window.api.ai.continueExplanation(activeAiRequestId.current)
    setHarnessProgress((current) =>
      current ? { ...current, awaitingDecision: false } : current
    )
  }

  const ea = result?.engineAnalysis ?? null
  const confidence = result?.moveComparison.confidence
  const canAnalyze = Boolean(status?.available && hasBothKings(board) && !busy && !aiBusy)
  const analysisBlockedReason = !hasBothKings(board)
    ? '棋盤需要同時有紅帥與黑將才能分析。'
    : !status?.available
      ? '請先到設定頁完成本機引擎設定。'
      : aiBusy
        ? 'AI 正在解說，完成或取消後才能重新分析。'
        : busy
          ? '引擎正在分析中。'
          : null
  const aiBlockedReason = !result
    ? '請先等引擎分析完成，再請 AI 解說。'
    : busy
      ? '引擎分析中，完成後才能解說。'
      : aiBusy
        ? 'AI 正在生成解說。'
        : null

  return (
    <div className="analysis-panel">
      <div className="panel-heading">
        <div>
          <span className="eyebrow">即時分析與解說</span>
          <h3>引擎與 AI 教練</h3>
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
      {engineRegistry.installations.length > 0 && (
        <div className="analysis-engine-selectors">
          <div className="field">
            <label className="field-label">本次主引擎</label>
            <select
              className="select"
              value={primaryEngineId ?? ''}
              disabled={busy || aiBusy}
              onChange={async (event) => {
                const id = event.target.value
                setPrimaryEngineId(id)
                if (verificationEngineId === id) setVerificationEngineId(null)
                setEngineRegistry(
                  await window.api.engine.selectInstallation(
                    id,
                    verificationEngineId === id ? null : verificationEngineId
                  )
                )
                setStatus(await window.api.engine.status())
              }}
            >
              {engineRegistry.installations.map((engine) => (
                <option key={engine.id} value={engine.id}>
                  {engine.displayName}{engine.verified ? '' : '（未驗證）'}
                </option>
              ))}
            </select>
          </div>
          {settings.crossEngineEnabled && (
            <div className="field">
              <label className="field-label">本次複核引擎</label>
              <select
                className="select"
                value={verificationEngineId ?? ''}
                disabled={busy || aiBusy}
                onChange={async (event) => {
                  const id = event.target.value || null
                  setVerificationEngineId(id)
                  if (primaryEngineId) {
                    setEngineRegistry(
                      await window.api.engine.selectInstallation(
                        primaryEngineId,
                        id
                      )
                    )
                  }
                }}
              >
                <option value="">不複核</option>
                {engineRegistry.installations
                  .filter((engine) => engine.id !== primaryEngineId)
                  .map((engine) => (
                    <option key={engine.id} value={engine.id}>
                      {engine.displayName}{engine.verified ? '' : '（未驗證）'}
                    </option>
                  ))}
              </select>
            </div>
          )}
        </div>
      )}

      <section className="engine-console" aria-live="polite">
        <div className="engine-console-tabs" role="tablist" aria-label="analysis tabs">
          <button className="engine-console-tab active" type="button">
            {(status?.engineName ?? '引擎')}分析
          </button>
          <button className="engine-console-tab" type="button" disabled>
            中國象棋題庫
          </button>
          <button className="engine-console-tab" type="button" disabled>
            局勢
          </button>
          <button className="engine-console-tab" type="button" disabled>
            注釋
          </button>
        </div>
        <div className="engine-console-status">
          <span>
            {busy && progress
              ? `${progressPhaseText(progress.phase)} · ${progress.percent}%`
              : ea
                ? `分析完成 · 深度 ${ea.depth ?? '—'}`
                : '等待引擎回傳即時資料'}
          </span>
          {progress?.elapsedMs !== undefined && busy && (
            <span>{formatElapsedMs(progress.elapsedMs)}</span>
          )}
        </div>
        <div className="engine-console-feed">
          {engineThoughts.length === 0 ? (
            <div className="engine-console-empty">
              開始分析後，這裡會持續列出引擎每次回傳的深度、原始分數、耗時、NPS 與主線。
            </div>
          ) : (
            engineThoughts
              .slice()
              .reverse()
              .map((item) => (
                <div className="engine-console-row" key={item.id}>
                  <div className="engine-console-meta">
                    <b>{consolePhaseLabel(item.phase)}</b>
                    <span>深度: {item.depth ?? '—'}</span>
                    <span>分數: {formatConsoleScore(item)}</span>
                    <span>耗時: {formatElapsedMs(item.elapsedMs)}</span>
                    <span>NPS: {formatLargeNumber(item.nps) ?? '—'}</span>
                    {item.nodes !== undefined && item.nodes !== null && (
                      <span>節點: {formatLargeNumber(item.nodes)}</span>
                    )}
                  </div>
                  <div className="engine-console-pv">
                    {item.displayPrincipalVariation.length > 0
                      ? item.displayPrincipalVariation.slice(0, 18).join('  ')
                      : item.displayMove
                        ? item.displayMove
                        : '引擎尚未輸出主線'}
                  </div>
                </div>
              ))
          )}
        </div>
      </section>

      <div className="analysis-action-card">
        <div>
          <b>下一步</b>
          <p className="muted small">
            {result
              ? '可以查看候選著法、加入待理解，或請 AI 用中文解釋。'
              : busy
                ? '正在讀取引擎結果，先觀察即時思考動態。'
                : '可直接重新分析目前棋盤，或先在左側選一個你的著法。'}
          </p>
        </div>
        <div className="row gap analysis-actions">
          <button
            className="btn"
            onClick={() => startAnalysis(false)}
            disabled={!canAnalyze}
            title={analysisBlockedReason ?? undefined}
          >
            {busy ? '分析中…' : '立即重新分析'}
          </button>
          {busy && (
            <button className="btn ghost" onClick={cancelAnalysis} disabled={cancelling}>
              {cancelling ? '取消中…' : '取消'}
            </button>
          )}
          <button
            className="btn ghost"
            onClick={() => generateExplanation(null, explanation !== null)}
            disabled={Boolean(aiBlockedReason)}
            title={aiBlockedReason ?? undefined}
          >
            {aiBusy ? '生成中…' : explanation ? '重新生成' : '請 AI 解說'}
          </button>
          {aiBusy && (
            <button className="btn ghost" onClick={cancelExplain} disabled={aiCancelling}>
              {aiCancelling ? '取消中…' : '取消生成'}
            </button>
          )}
        </div>
      </div>
      <div className="analysis-helper-strip">
        <span>
          {busy
            ? '局面已變更，正在自動更新分析結果。'
            : `自動分析已開啟：快速模式最多 ${(
                Math.min(
                  settings.rootAnalysisMovetimeMs,
                  AUTO_ROOT_ANALYSIS_MAX_MS
                ) / 1000
              ).toFixed(1)} 秒；手動重跑會使用完整設定時間。`}
        </span>
        {(analysisBlockedReason || aiBlockedReason) && !busy && (
          <span className="muted small">
            {analysisBlockedReason ?? aiBlockedReason}
          </span>
        )}
      </div>

      {aiBusy && harnessProgress && (
        <div className="harness-progress" aria-live="polite">
          <div className="live-analysis-head">
            <div>
              <b>{harnessProgress.message}</b>
              <span className="muted small">
                階段：{harnessProgress.phase} · 模型呼叫{' '}
                {harnessProgress.modelCallsUsed} · 引擎輪數{' '}
                {harnessProgress.engineRoundsUsed} · 證據{' '}
                {harnessProgress.evidenceCount}
                {harnessProgress.elapsedMs !== undefined
                  ? ` · 已進行 ${Math.floor(harnessProgress.elapsedMs / 1000)} 秒`
                  : ''}
                {harnessProgress.depth !== undefined
                  ? ` · 深度 ${harnessProgress.depth ?? '—'}`
                  : ''}
                {` · 已確認 ${harnessProgress.verifiedConsequenceCount ?? 0} 項具體後果`}
              </span>
            </div>
            <span className="badge on">
              {settings.harnessAnswerMode === 'research' ? '完整研究' : '聚焦回答'}
            </span>
          </div>
          {(harnessProgress.displayPrincipalVariation ?? []).length > 0 && (
            <div className="muted small harness-current-line">
              目前比較主線：
              {harnessProgress.displayPrincipalVariation?.join('、')}
            </div>
          )}
          {harnessProgress.awaitingDecision && (
            <div className="row gap harness-decision">
              <button className="btn" onClick={continueExplain}>
                繼續分析
              </button>
              <button className="btn ghost" onClick={cancelExplain}>
                取消
              </button>
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
          <summary>查看引擎診斷輸出</summary>
          <pre>{engineDiagnostics.join('\n')}</pre>
        </details>
      )}
      {notice && <div className="muted" style={{ marginTop: 8 }}>{notice}</div>}

      {ea && (
        <div className="analysis-result">
          <div className="result-head">
            最佳著法 <b>{ea.displayBestMove ?? '無法辨識著法'}</b>　原始分數{' '}
            {ea.scoreAfterBestMove?.raw ?? '無'}
            　深度 {ea.depth ?? '—'}
            {ea.analysisTimeMs !== undefined && (
              <span className="muted small">　({(ea.analysisTimeMs / 1000).toFixed(1)}s)</span>
            )}
          </div>
          <div className="analysis-summary-grid">
            <div>
              <span className="muted small">最佳著法</span>
              <b>{ea.displayBestMove ?? '無法辨識著法'}</b>
            </div>
            <div>
              <span className="muted small">原始分數</span>
              <b>{ea.scoreAfterBestMove?.raw ?? '無'}</b>
            </div>
            <div>
              <span className="muted small">搜尋深度</span>
              <b>{ea.depth ?? '—'}</b>
            </div>
          </div>
          {(ea.incomplete || confidence === 'low') && (
            <div className="engine-status warn">
              ⚠ {ea.warnings.length > 0
                ? ea.warnings.join('；')
                : `本次引擎資料不足：${result?.moveComparison.uncertaintyReasons.join('；')}`}
            </div>
          )}
          {result?.engineDisagreement && (
            <div className="engine-status warn">
              主引擎與複核引擎判斷不同；系統保留兩份結果，不會平均分數。
            </div>
          )}
          <ol className="line-list">
            {ea.candidateMoves.map((candidate, index) => (
              <li key={`${index}-${candidate.move}`}>
                <b>{candidate.displayMove ?? '無法辨識著法'}</b>　原始分數{' '}
                {candidate.score?.raw ?? '無'}
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
              <summary>查看 {ea.engineName} 原始分析</summary>
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
          {result?.verificationEngineAnalysis?.rawAnalysis && (
            <details className="raw-engine-analysis">
              <summary>
                查看 {result.verificationEngineAnalysis.engineName} 複核原始分析
              </summary>
              <pre>
                {result.verificationEngineAnalysis.rawAnalysis.root.join('\n') ||
                  '（沒有原始輸出）'}
              </pre>
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
          {submittedGuess?.move && (
            <div className="muted small">
              追問會附加棋盤上選取的著法：
              {ea?.displayUserMove ?? '目前選取著法'}
            </div>
          )}
          {!result && (
            <div className="muted small">請先重新分析此局面，再繼續追問。</div>
          )}
        </div>
      )}

      {harnessWarnings.length > 0 && (
        <div className="engine-status warn">
          {harnessWarnings.join('；')}
        </div>
      )}

      {harnessEvidence.length > 0 && (
        <details className="harness-evidence">
          <summary>展開 AI 解說證據（{harnessEvidence.length} 筆）</summary>
          {harnessEvidence.map((item) => (
            <div className="evidence-card" key={item.id}>
              <b>
                [{item.id}] {item.engineName} · {item.purpose}
              </b>
              <div className="muted small">
                深度 {item.depth ?? '—'} · 原始分數 {item.score?.raw ?? '無'}
              </div>
              <div>
                主線：{item.displayPrincipalVariation.slice(0, 8).join('、') || '無'}
              </div>
            </div>
          ))}
        </details>
      )}

      {traceId && (
        <div className="harness-feedback">
          <span className="muted small">這次解說是否有幫助？</span>
          {(
            [
              ['helpful', '有幫助'],
              ['unclear', '不清楚'],
              ['incorrect', '內容不正確'],
              ['missing_evidence', '證據不足']
            ] as const
          ).map(([value, label]) => (
            <button
              className="btn ghost"
              key={value}
              onClick={async () => {
                await window.api.ai.setHarnessFeedback(traceId, value)
                setNotice('已記錄這次 Harness 回饋。')
              }}
            >
              {label}
            </button>
          ))}
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
