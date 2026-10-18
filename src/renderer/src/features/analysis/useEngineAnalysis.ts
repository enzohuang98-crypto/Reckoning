import { useCallback, useEffect, useRef, useState, type MutableRefObject } from 'react'
import type { BoardState } from '@shared/types/BoardState'
import type { AppSettings } from '@shared/types/Settings'
import type {
  EngineAnalysisErrorPayload,
  EngineAnalysisProgressPayload,
  EngineAnalysisResultPayload,
  EngineStatus
} from '@shared/types/ipc'
import type { AIExplanationResponse } from '@shared/types/AIExplanationTypes'
import type { EngineCandidateMove } from '@shared/types/EngineAnalysis'
import type { EngineRegistrySnapshot } from '@shared/types/EngineRegistry'
import { validateMoveInput } from '@shared/logic/validation/ValidationUtils'
import { hasVerifiedActiveEngine, retryOnce } from './engineHealth'
import { thoughtSignature, type EngineThoughtEntry } from './engineThoughts'
import type { ActualMoveSelection } from './types'
import {
  automaticRootMovetimeMs,
  automaticUserMoveMovetimeMs,
  hasBothKings,
  isSameAnalysisTarget,
  ACTUAL_MOVE_ENGINE_DEADLINE_MS,
  remainingActualMoveEngineDeadlineMs
} from './liveAnalysis'

/**
 * 引擎生命週期需要通知 AI 端的兩件事。AI hook 依賴引擎結果，所以 AnalysisPanel 先建立引擎 hook，
 * 再於每次 render 把 AI hook 的實作放進這個 ref；呼叫點都在 effect、計時器或 IPC 事件中，必定晚於 render。
 */
export interface EngineAiLink {
  /** 非精煉的新分析開始：目前顯示的 AI 解說失效（已有對話時保留它的分析快照）。 */
  invalidateExplanation: () => void
  /** 引擎失敗或取消：放棄正在等這輪分析完成的 AI 提問。 */
  abandonQueuedExplanation: (code: EngineAnalysisErrorPayload['code']) => void
}

export interface EngineAnalysisOptions {
  visible: boolean
  board: BoardState
  settings: AppSettings
  /** 實戰著法或已提交的猜測著法；空字串代表只分析局面。 */
  analysisMove: string
  actualMove: ActualMoveSelection | null
  onResult: (payload: EngineAnalysisResultPayload | null) => void
  onReplayCandidates: (candidates: EngineCandidateMove[]) => void
  onExplanation: (explanation: AIExplanationResponse | null) => void
  aiLink: MutableRefObject<EngineAiLink | null>
}

export type EngineAnalysisController = ReturnType<typeof useEngineAnalysis>

const MAX_ENGINE_THOUGHTS = 80

/**
 * 本機引擎分析的生命週期：引擎狀態查詢、啟動／取消搜尋、進度與思考列、實戰步截止計時，
 * 以及切換分析對象時的重設。何時「自動」啟動分析由 useAnalysisOrchestration 決定。
 */
export function useEngineAnalysis({
  visible,
  board,
  settings,
  analysisMove,
  actualMove,
  onResult,
  onReplayCandidates,
  onExplanation,
  aiLink
}: EngineAnalysisOptions) {
  const [status, setStatus] = useState<EngineStatus | null>(null)
  const [busy, setBusy] = useState(false)
  const [refining, setRefining] = useState(false)
  const [livePaused, setLivePaused] = useState(false)
  const [progress, setProgress] = useState<EngineAnalysisProgressPayload | null>(null)
  const [engineThoughts, setEngineThoughts] = useState<EngineThoughtEntry[]>([])
  const [retainingPreviousAnalysis, setRetainingPreviousAnalysis] = useState(false)
  const [cancelling, setCancelling] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [engineDiagnostics, setEngineDiagnostics] = useState<string[]>([])
  const [notice, setNotice] = useState<string | null>(null)
  const [result, setResult] = useState<EngineAnalysisResultPayload | null>(null)
  const [engineRegistry, setEngineRegistry] = useState<EngineRegistrySnapshot>({
    installations: [],
    activeEngineId: null
  })
  const [primaryEngineId, setPrimaryEngineId] = useState<string | null>(null)
  const activeRequestId = useRef<string | null>(null)
  const activeAnalysisKey = useRef<string | null>(null)
  const engineDeadlineTimer = useRef<number | null>(null)
  const explicitAnalysisTarget = useRef<string | null>(null)
  const resultRef = useRef(result)
  const analysisStartedAtRef = useRef<number | null>(null)
  const lastThoughtAtRef = useRef<number | null>(null)
  const pendingThoughtResetRequestId = useRef<string | null>(null)
  const liveReplayCandidatesByRank = useRef<Map<number, EngineCandidateMove>>(new Map())
  const [liveNow, setLiveNow] = useState(() => Date.now())
  const [liveRetryCount, setLiveRetryCount] = useState(0)

  const refreshEngineState = useCallback(async (): Promise<void> => {
    try {
      const registry = await window.api.engine.listInstallations()
      setEngineRegistry(registry)
      setPrimaryEngineId(registry.activeEngineId)
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

  useEffect(() => () => {
    if (activeRequestId.current) {
      window.api.engine.cancelAnalysis(activeRequestId.current)
    }
    if (engineDeadlineTimer.current !== null) {
      window.clearTimeout(engineDeadlineTimer.current)
      engineDeadlineTimer.current = null
    }
  }, [])

  // 分析對象（局面、著法、實戰點選）改變：取消進行中的搜尋並清空結果。
  // AI 端的對應重設在 useAiExplanation，緊接在這個 effect 之後執行。
  useEffect(() => {
    if (activeRequestId.current) window.api.engine.cancelAnalysis(activeRequestId.current)
    if (engineDeadlineTimer.current !== null) {
      window.clearTimeout(engineDeadlineTimer.current)
      engineDeadlineTimer.current = null
    }
    activeRequestId.current = null
    activeAnalysisKey.current = null
    explicitAnalysisTarget.current = null
    analysisStartedAtRef.current = null
    lastThoughtAtRef.current = null
    setBusy(false)
    setRefining(false)
    setLivePaused(false)
    setProgress(null)
    pendingThoughtResetRequestId.current = null
    liveReplayCandidatesByRank.current.clear()
    onReplayCandidates([])
    setCancelling(false)
    setResult(null)
    resultRef.current = null
    setLiveRetryCount(0)
    setError(null)
    setEngineDiagnostics([])
    setNotice(null)
    onResult(null)
  }, [board.fen, analysisMove, actualMove?.selectionId, onReplayCandidates])

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
        scoreDisplay: payload.score?.displayText ?? null,
        scoreComparableValue: payload.score?.comparableValue ?? null,
        candidateRank: payload.candidateRank,
        displayMove: payload.displayMove,
        displayPrincipalVariation: payload.displayPrincipalVariation,
        engineName: payload.engineName
      }
      const replacePreviousRows =
        pendingThoughtResetRequestId.current === payload.requestId
      if (replacePreviousRows) {
        pendingThoughtResetRequestId.current = null
        setRetainingPreviousAnalysis(false)
      }
      setEngineThoughts((previous) => {
        const rows = replacePreviousRows ? [] : previous
        const last = rows[rows.length - 1]
        if (last && thoughtSignature(last) === thoughtSignature(entry)) {
          return rows
        }
        return [...rows, entry].slice(-MAX_ENGINE_THOUGHTS)
      })
      if (
        payload.phase === 'root_analysis' &&
        payload.candidateRank &&
        payload.move &&
        payload.principalVariation?.length
      ) {
        liveReplayCandidatesByRank.current.set(payload.candidateRank, {
          move: payload.move,
          displayMove: payload.displayMove,
          score: payload.score,
          evaluation: payload.score?.comparableValue ?? null,
          depth: payload.depth,
          principalVariation: payload.principalVariation,
          displayPrincipalVariation: payload.displayPrincipalVariation
        })
        onReplayCandidates(
          [...liveReplayCandidatesByRank.current.entries()]
            .sort(([left], [right]) => left - right)
            .map(([, candidate]) => candidate)
        )
      }
    })
    const offResult = window.api.engine.onAnalysisResult((payload) => {
      if (payload.requestId !== activeRequestId.current) return
      if (engineDeadlineTimer.current !== null) {
        window.clearTimeout(engineDeadlineTimer.current)
        engineDeadlineTimer.current = null
      }
      activeRequestId.current = null
      activeAnalysisKey.current = null
      analysisStartedAtRef.current = null
      lastThoughtAtRef.current = null
      setBusy(false)
      setRefining(false)
      setProgress(null)
      setCancelling(false)
      setLiveRetryCount(0)
      setRetainingPreviousAnalysis(false)
      setResult(payload)
      resultRef.current = payload
      onResult(payload)
      liveReplayCandidatesByRank.current = new Map(
        payload.engineAnalysis.candidateMoves.map((candidate, index) => [index + 1, candidate])
      )
      onReplayCandidates(payload.engineAnalysis.candidateMoves)
    })
    const offError = window.api.engine.onAnalysisError((payload) => {
      if (payload.requestId !== activeRequestId.current) return
      if (engineDeadlineTimer.current !== null) {
        window.clearTimeout(engineDeadlineTimer.current)
        engineDeadlineTimer.current = null
      }
      activeRequestId.current = null
      activeAnalysisKey.current = null
      analysisStartedAtRef.current = null
      lastThoughtAtRef.current = null
      setBusy(false)
      setRefining(false)
      setProgress(null)
      setCancelling(false)
      aiLink.current?.abandonQueuedExplanation(payload.code)
      if (payload.code === 'cancelled') setNotice('已取消分析。')
      else {
        setLiveRetryCount((current) => current + 1)
        setError(payload.message)
        setEngineDiagnostics(payload.diagnostics ?? [])
      }
    })
    return () => {
      offProgress()
      offResult()
      offError()
    }
  }, [aiLink, onReplayCandidates, onResult])

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
    const move = analysisMove
    const refinement =
      automatic &&
      isSameAnalysisTarget(resultRef.current?.engineAnalysis ?? null, board.fen, move)
    if (move) {
      const check = validateMoveInput(board, move)
      if (!check.ok) {
        setError(
          `${actualMove ? '實戰著法' : '你的猜測著法'}不合法：${check.message}`
        )
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
    if (engineDeadlineTimer.current !== null) {
      window.clearTimeout(engineDeadlineTimer.current)
      engineDeadlineTimer.current = null
    }
    setError(null)
    setEngineDiagnostics([])
    setNotice(null)
    if (!refinement) {
      aiLink.current?.invalidateExplanation()
      onExplanation(null)
    }

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
    if (!refinement) {
      pendingThoughtResetRequestId.current = requestId
      setRetainingPreviousAnalysis(true)
      setResult(null)
      resultRef.current = null
      onResult(null)
    }
    window.api.engine.startAnalysis({
      requestId,
      engineId: primaryEngineId ?? undefined,
      positionFen: board.fen,
      userMove: move || undefined,
      analysisConfig: {
        rootAnalysisMovetimeMs,
        userMoveEvalMovetimeMs,
        multiPv: settings.multiPv
      }
    })
    if (actualMove && automatic && !refinement) {
      engineDeadlineTimer.current = window.setTimeout(() => {
        if (activeRequestId.current !== requestId) return
        window.api.engine.cancelAnalysis(requestId)
        activeRequestId.current = null
        activeAnalysisKey.current = null
        analysisStartedAtRef.current = null
        lastThoughtAtRef.current = null
        engineDeadlineTimer.current = null
        setBusy(false)
        setRefining(false)
        setProgress(null)
        setCancelling(false)
        setLivePaused(true)
        setError(
          `引擎比較在點擊後 ${ACTUAL_MOVE_ENGINE_DEADLINE_MS / 1000} 秒內未完成，請重試或檢查本機引擎。`
        )
      }, remainingActualMoveEngineDeadlineMs(actualMove.selectedAt))
    }
  }, [
    aiLink,
    board,
    onExplanation,
    onResult,
    settings.multiPv,
    settings.rootAnalysisMovetimeMs,
    settings.userMoveEvalMovetimeMs,
    analysisMove,
    primaryEngineId,
    actualMove
  ])

  const cancelAnalysis = (): void => {
    if (!activeRequestId.current) return
    setLivePaused(true)
    setCancelling(true)
    if (engineDeadlineTimer.current !== null) {
      window.clearTimeout(engineDeadlineTimer.current)
      engineDeadlineTimer.current = null
    }
    window.api.engine.cancelAnalysis(activeRequestId.current)
  }

  /** 「全部停止」的引擎部分：即使沒有進行中的搜尋也暫停 live 分析。 */
  const pauseAndCancelAnalysis = (): void => {
    setLivePaused(true)
    if (activeRequestId.current) {
      setCancelling(true)
      if (engineDeadlineTimer.current !== null) {
        window.clearTimeout(engineDeadlineTimer.current)
        engineDeadlineTimer.current = null
      }
      window.api.engine.cancelAnalysis(activeRequestId.current)
    }
  }

  const selectPrimaryEngine = async (id: string): Promise<void> => {
    try {
      setPrimaryEngineId(id)
      setEngineRegistry(await window.api.engine.selectInstallation(id))
      setStatus(await window.api.engine.status())
      setError(null)
    } catch {
      setError('無法切換主引擎，請到設定頁重新測試該引擎。')
    }
  }

  const liveElapsedMs =
    busy && analysisStartedAtRef.current !== null
      ? liveNow - analysisStartedAtRef.current
      : null
  const sinceLastThoughtMs =
    busy && lastThoughtAtRef.current !== null ? liveNow - lastThoughtAtRef.current : null

  return {
    status,
    busy,
    refining,
    livePaused,
    progress,
    engineThoughts,
    retainingPreviousAnalysis,
    cancelling,
    error,
    engineDiagnostics,
    notice,
    result,
    engineRegistry,
    primaryEngineId,
    liveRetryCount,
    liveElapsedMs,
    sinceLastThoughtMs,
    /** 進行中的引擎請求 id；null 代表沒有搜尋在跑。 */
    activeRequestId,
    /** 已自動分析過的實戰點選，避免同一次點選重複啟動。 */
    explicitAnalysisTarget,
    startAnalysis,
    cancelAnalysis,
    pauseAndCancelAnalysis,
    selectPrimaryEngine
  }
}
