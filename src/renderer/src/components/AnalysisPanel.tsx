import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState
} from 'react'
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
import { CoachView } from '../features/analysis/CoachView'
import { DetailsView } from '../features/analysis/DetailsView'
import {
  hasVerifiedActiveEngine,
  retryOnce
} from '../features/analysis/engineHealth'
import {
  EngineConsole,
  thoughtSignature,
  type EngineThoughtEntry
} from '../features/analysis/EngineConsole'
import { EngineResultSummary } from '../features/analysis/EngineResultSummary'
import type {
  AnalysisPanelHandle,
  AnalysisPanelStatus,
  AnalysisView
} from '../features/analysis/types'
import {
  automaticRootMovetimeMs,
  automaticUserMoveMovetimeMs,
  isSameAnalysisTarget
} from '../features/analysis/liveAnalysis'

export type { AnalysisPanelHandle, AnalysisPanelStatus } from '../features/analysis/types'

interface Props {
  visible: boolean
  activeView: Exclude<AnalysisView, 'guess'>
  onActiveViewChange: (view: AnalysisView) => void
  board: BoardState
  settings: AppSettings
  submittedGuess: SubmittedGuess | null
  conversation: AIConversation | null
  onConversationChange: (conversation: AIConversation | null) => void
  onResult: (payload: EngineAnalysisResultPayload | null) => void
  onExplanation: (explanation: AIExplanationResponse | null) => void
  onSaveMisunderstood: (entry: MisunderstoodPosition) => void
  onStatusChange: (status: AnalysisPanelStatus) => void
}

interface PendingAiRequest {
  question: string | null
  conversationId: string
}

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

export const AnalysisPanel = forwardRef<AnalysisPanelHandle, Props>(function AnalysisPanel(
  {
    visible,
    activeView,
    onActiveViewChange,
    board,
    settings,
    submittedGuess,
    conversation,
    onConversationChange,
    onResult,
    onExplanation,
    onSaveMisunderstood,
    onStatusChange
  }: Props,
  ref
): JSX.Element {
  const [status, setStatus] = useState<EngineStatus | null>(null)
  const [busy, setBusy] = useState(false)
  const [refining, setRefining] = useState(false)
  const [livePaused, setLivePaused] = useState(false)
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
  const explanationAnchorRef = useRef<HTMLDivElement>(null)
  const analysisStartedAtRef = useRef<number | null>(null)
  const lastThoughtAtRef = useRef<number | null>(null)
  const [liveNow, setLiveNow] = useState(() => Date.now())

  useEffect(() => {
    settingsRef.current = settings
  }, [settings])

  useEffect(() => {
    conversationRef.current = conversation
  }, [conversation])

  const refreshEngineState = useCallback(async (): Promise<void> => {
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

      const active = registry.installations.find(
        (installation) => installation.id === registry.activeEngineId
      )
      if (hasVerifiedActiveEngine(registry)) {
        setEngineDiagnostics([])
        setStatus({ ...current, protocol: active?.protocol ?? current.protocol })
        return
      }

      const test = await retryOnce(
        () => window.api.engine.test(),
        (result) => result.ok,
        600
      )
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
  }, [])

  useEffect(() => {
    if (!visible) return
    void refreshEngineState()
  }, [refreshEngineState, visible])

  useEffect(() => {
    if (activeRequestId.current) window.api.engine.cancelAnalysis(activeRequestId.current)
    if (activeAiRequestId.current) {
      window.api.ai.cancelExplanation(activeAiRequestId.current)
    }
    activeRequestId.current = null
    activeAnalysisKey.current = null
    activeAiRequestId.current = null
    pendingAiRequest.current = null
    analysisStartedAtRef.current = null
    lastThoughtAtRef.current = null
    setBusy(false)
    setRefining(false)
    setLivePaused(false)
    setProgress(null)
    setEngineThoughts([])
    setCancelling(false)
    setAiBusy(false)
    setAiCancelling(false)
    setResult(null)
    resultRef.current = null
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
  }, [board.fen, submittedGuess?.move])

  useEffect(() => {
    const offProgress = window.api.engine.onAnalysisProgress((payload) => {
      if (payload.requestId !== activeRequestId.current) return
      lastThoughtAtRef.current = Date.now()
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
        displayPrincipalVariation: payload.displayPrincipalVariation,
        engineRole: payload.engineRole,
        engineName: payload.engineName
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
      analysisStartedAtRef.current = null
      lastThoughtAtRef.current = null
      setBusy(false)
      setRefining(false)
      setProgress(null)
      setCancelling(false)
      setResult(payload)
      resultRef.current = payload
      onResult(payload)
    })
    const offError = window.api.engine.onAnalysisError((payload) => {
      if (payload.requestId !== activeRequestId.current) return
      activeRequestId.current = null
      activeAnalysisKey.current = null
      analysisStartedAtRef.current = null
      lastThoughtAtRef.current = null
      setBusy(false)
      setRefining(false)
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

  // 每秒重新渲染一次，讓「仍在分析中」的耗時持續走動，即使引擎暫時沒有新的 info 行也不會看起來像停止。
  useEffect(() => {
    if (!busy) return
    const timer = window.setInterval(() => setLiveNow(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [busy])

  const startAnalysis = useCallback((automatic = false): void => {
    if (!hasBothKings(board)) {
      if (!automatic) setError('棋盤需要同時有紅帥與黑將才能分析。')
      return
    }
    if (!automatic) setLivePaused(false)
    const move = submittedGuess?.move ?? ''
    const refinement =
      automatic &&
      isSameAnalysisTarget(resultRef.current?.engineAnalysis ?? null, board.fen, move)
    if (move) {
      const check = validateMoveInput(board, move)
      if (!check.ok) {
        setError(`你的猜測著法不合法：${check.message}`)
        return
      }
    }

    const rootAnalysisMovetimeMs = automatic
      ? automaticRootMovetimeMs(settings.rootAnalysisMovetimeMs, refinement)
      : settings.rootAnalysisMovetimeMs
    const userMoveEvalMovetimeMs = automatic
      ? automaticUserMoveMovetimeMs(settings.userMoveEvalMovetimeMs)
      : settings.userMoveEvalMovetimeMs
    const analysisKey = [
      automatic ? (refinement ? 'auto-refine' : 'auto-initial') : 'manual',
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
    analysisStartedAtRef.current = Date.now()
    lastThoughtAtRef.current = Date.now()
    setLiveNow(Date.now())
    setBusy(true)
    setRefining(refinement)
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
    if (!refinement) {
      setResult(null)
      resultRef.current = null
      onResult(null)
    }
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
    if (livePaused || !visible || !status?.available || !hasBothKings(board)) return
    const timer = window.setTimeout(() => startAnalysis(true), 180)
    return () => window.clearTimeout(timer)
  }, [
    board.fen,
    livePaused,
    startAnalysis,
    status?.available,
    submittedGuess?.move,
    visible
  ])

  useEffect(() => {
    if (
      livePaused ||
      !visible ||
      !status?.available ||
      !result ||
      aiBusy ||
      explanation ||
      conversationRef.current ||
      activeRequestId.current
    ) {
      return
    }
    const timer = window.setTimeout(() => startAnalysis(true), 320)
    return () => window.clearTimeout(timer)
  }, [
    aiBusy,
    conversation?.id,
    explanation,
    livePaused,
    result?.analysisId,
    startAnalysis,
    status?.available,
    visible
  ])

  const cancelAnalysis = (): void => {
    if (!activeRequestId.current) return
    setLivePaused(true)
    setCancelling(true)
    window.api.engine.cancelAnalysis(activeRequestId.current)
  }

  const stopAll = (): void => {
    setLivePaused(true)
    if (activeRequestId.current) {
      setCancelling(true)
      window.api.engine.cancelAnalysis(activeRequestId.current)
    }
    if (activeAiRequestId.current) {
      setAiCancelling(true)
      window.api.ai.cancelExplanation(activeAiRequestId.current)
    }
  }

  const generateExplanation = (question: string | null, regenerate = false): void => {
    if (!result) return
    if (refining && activeRequestId.current) {
      window.api.engine.cancelAnalysis(activeRequestId.current)
      setRefining(false)
    }
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
      baseUrl:
        settings.aiProvider === 'openai-compatible'
          ? settings.aiBaseUrl
          : undefined,
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

  // 不傳 deps：generateExplanation/startAnalysis 等閉包捕捉了 settings/引擎選擇等會變動的值，
  // 每次 render 都重建這個 handle 才能避免呼叫到過期的閉包。
  useImperativeHandle(ref, () => ({
    requestExplanation: () => {
      if (!result || aiBusy) return
      onActiveViewChange('coach')
      generateExplanation(
        null,
        explanation !== null || conversationRef.current !== null
      )
      explanationAnchorRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    },
    startAnalysis: () => startAnalysis(false),
    cancelAnalysis,
    cancelExplain,
    stopAll
  }))

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
    : busy && !refining
      ? '引擎分析中，完成後才能解說。'
      : aiBusy
        ? 'AI 正在生成解說。'
        : null

  // 把外部（頂部工具列）需要的按鈕狀態往上回報，本身不影響任何分析/Harness 邏輯。
  useEffect(() => {
    onStatusChange({
      canAnalyze,
      analysisBusy: busy,
      analysisCancelling: cancelling,
      aiBusy,
      aiCancelling,
      hasExplanation: explanation !== null,
      hasResult: result !== null,
      analysisBlockedReason,
      aiBlockedReason
    })
  }, [
    canAnalyze,
    busy,
    cancelling,
    aiBusy,
    aiCancelling,
    explanation,
    result,
    analysisBlockedReason,
    aiBlockedReason,
    onStatusChange
  ])

  const liveElapsedMs =
    busy && analysisStartedAtRef.current !== null
      ? liveNow - analysisStartedAtRef.current
      : null
  const sinceLastThoughtMs =
    busy && lastThoughtAtRef.current !== null ? liveNow - lastThoughtAtRef.current : null

  const selectPrimaryEngine = async (id: string): Promise<void> => {
    try {
      const nextVerification = verificationEngineId === id ? null : verificationEngineId
      setPrimaryEngineId(id)
      setVerificationEngineId(nextVerification)
      setEngineRegistry(
        await window.api.engine.selectInstallation(id, nextVerification)
      )
      setStatus(await window.api.engine.status())
      setError(null)
    } catch {
      setError('無法切換主引擎，請到設定頁重新測試該引擎。')
    }
  }

  const selectVerificationEngine = async (id: string | null): Promise<void> => {
    if (!primaryEngineId) return
    try {
      setVerificationEngineId(id)
      setEngineRegistry(
        await window.api.engine.selectInstallation(primaryEngineId, id)
      )
      setError(null)
    } catch {
      setError('無法切換複核引擎；主引擎與複核引擎必須不同。')
    }
  }

  return (
    <div className={`analysis-panel analysis-view-${activeView}`}>
      <div className="inspector-context-bar">
        {status && (
          <div className={`engine-status ${status.available ? 'ok' : 'warn'}`}>
            {status.available
              ? `${status.engineName} 已連線`
              : status.message ?? `${status.engineName} 未就緒`}
          </div>
        )}
        {error && <div className="error-text">{error}</div>}
        {notice && <div className="notice-text">{notice}</div>}
      </div>

      {activeView === 'live' && (
        <div className="analysis-view-content">
          <EngineConsole
            status={status}
            progress={progress}
            busy={busy}
            completedDepth={ea?.depth ?? null}
            thoughts={engineThoughts}
            liveElapsedMs={liveElapsedMs}
            sinceLastThoughtMs={sinceLastThoughtMs}
          />

          <div className="analysis-helper-strip">
            <span>
              {busy
                ? refining
                  ? 'Live 分析持續加深中；可直接請 AI 解說，系統會保留目前最佳結果。'
                  : '棋盤已變更，正在快速建立第一份可用結果。'
                : livePaused
                  ? 'Live 分析已暫停；按頂部「重新分析」即可恢復。'
                  : 'Live 分析已開啟：先快速出結果，再持續加深；需要時可按「停止」。'}
            </span>
            {(analysisBlockedReason || aiBlockedReason) && !busy && (
              <span className="muted small">
                {analysisBlockedReason ?? aiBlockedReason}
              </span>
            )}
          </div>

          {result ? (
            <EngineResultSummary result={result} />
          ) : (
            <div className="panel-empty-state">
              <span className="empty-state-mark">棋</span>
              <h3>等待引擎結果</h3>
              <p>棋盤變動後會自動開始快速分析，也可以使用頂部按鈕執行完整分析。</p>
            </div>
          )}
        </div>
      )}

      {activeView === 'coach' && (
        <div ref={explanationAnchorRef}>
          <CoachView
            settings={settings}
            result={result}
            explanation={explanation}
            conversation={conversation}
            submittedGuess={submittedGuess}
            aiBusy={aiBusy}
            streamingText={streamingText}
            harnessProgress={harnessProgress}
            harnessEvidence={harnessEvidence}
            harnessWarnings={harnessWarnings}
            traceId={traceId}
            tokenEstimate={tokenEstimate}
            aiBlockedReason={aiBlockedReason}
            followUp={followUp}
            onFollowUpChange={setFollowUp}
            onGenerate={() => generateExplanation(null)}
            onContinue={continueExplain}
            onCancel={cancelExplain}
            onSubmitFollowUp={submitFollowUp}
            onCopy={() => void copyExplanation()}
            onFeedback={(feedback) => {
              if (!traceId) return
              void window.api.ai
                .setHarnessFeedback(traceId, feedback)
                .then(() => setNotice('已記錄這次解說回饋。'))
                .catch(() => setError('回饋儲存失敗，請稍後再試。'))
            }}
          />
        </div>
      )}

      {activeView === 'details' && (
        <DetailsView
          result={result}
          settings={settings}
          registry={engineRegistry}
          primaryEngineId={primaryEngineId}
          verificationEngineId={verificationEngineId}
          busy={busy}
          aiBusy={aiBusy}
          collectionReason={collectionReason}
          diagnostics={engineDiagnostics}
          onCollectionReasonChange={setCollectionReason}
          onSaveMisunderstood={saveMisunderstood}
          onSelectPrimary={(id) => void selectPrimaryEngine(id)}
          onSelectVerification={(id) => void selectVerificationEngine(id)}
        />
      )}
    </div>
  )
})
