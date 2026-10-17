import { useEffect, useRef, useState } from 'react'
import type { BoardState } from '@shared/types/BoardState'
import type { AppSettings } from '@shared/types/Settings'
import type {
  EngineAnalysisResultPayload,
  GenerateExplanationErrorPayload
} from '@shared/types/ipc'
import type { AIExplanationResponse } from '@shared/types/AIExplanationTypes'
import type { HarnessProgressPayload, HarnessTrace } from '@shared/types/Harness'
import type { AIConversation } from '@shared/types/AppData'
import type { SubmittedGuess } from '@shared/types/UserGuess'
import {
  aiErrorDiagnosticsText,
  type AiErrorAction,
  type AiErrorInput
} from '@shared/logic/ai/aiErrorPresentation'
import {
  buildConversationHistoryForRequest,
  cloneExplanationStart,
  clonePendingAiRequest,
  isSameAiRequestTarget,
  newMessage,
  type AiRequestTarget,
  type PendingAiRequest,
  type QueuedExplanation,
  type RetryableAiRequest
} from './aiRequest'
import type { ActualMoveSelection, AiAnswerMeta } from './types'
import type { EngineAiLink, EngineAnalysisController } from './useEngineAnalysis'
import {
  canExplainWithCompletedResult,
  isSameAnalysisTarget,
  AI_REQUEST_DEADLINE_MS,
  remainingOneClickDeadlineMs
} from './liveAnalysis'

export interface AiExplanationOptions {
  board: BoardState
  settings: AppSettings
  analysisMove: string
  actualMove: ActualMoveSelection | null
  submittedGuess: SubmittedGuess | null
  conversation: AIConversation | null
  onConversationChange: (conversation: AIConversation | null) => void
  onExplanation: (explanation: AIExplanationResponse | null) => void
  onOpenAiSettings?: () => void
  engine: Pick<
    EngineAnalysisController,
    'result' | 'activeRequestId' | 'primaryEngineId' | 'startAnalysis'
  >
}

export type AiExplanationController = ReturnType<typeof useAiExplanation>

const WAITING_FOR_ENGINE_NOTICE = '正在等待皮卡魚完成這輪分析，完成後會依結果回答。'

/**
 * AI 解說的生命週期：組請求（只送 analysisId，不回傳分析資料）、串流文字與修正輪次、
 * 截止計時、取消、等待引擎的排隊提問、「重試 AI」、對話紀錄、複製與回饋。
 * 引擎狀態只讀不寫；排隊提問何時送出由 useAnalysisOrchestration 決定。
 */
export function useAiExplanation({
  board,
  settings,
  analysisMove,
  actualMove,
  submittedGuess,
  conversation,
  onConversationChange,
  onExplanation,
  onOpenAiSettings,
  engine
}: AiExplanationOptions) {
  const { result, activeRequestId, primaryEngineId, startAnalysis } = engine
  const [aiError, setAiError] = useState<string | null>(null)
  const [aiDiagnostic, setAiDiagnostic] =
    useState<GenerateExplanationErrorPayload['diagnostic']>(undefined)
  const [aiErrorInfo, setAiErrorInfo] =
    useState<(AiErrorInput & { model?: string }) | null>(null)
  const [aiNotice, setAiNotice] = useState<string | null>(null)
  const [explanation, setExplanation] = useState<AIExplanationResponse | null>(null)
  const [explainedResult, setExplainedResult] =
    useState<EngineAnalysisResultPayload | null>(null)
  const [aiBusy, setAiBusy] = useState(false)
  const [aiCancelling, setAiCancelling] = useState(false)
  const [streamingText, setStreamingText] = useState('')
  const [streamingAttempt, setStreamingAttempt] = useState(1)
  const [answerMeta, setAnswerMeta] = useState<AiAnswerMeta | null>(null)
  const streamingAttemptRef = useRef(1)
  const [followUp, setFollowUp] = useState('')
  const [harnessProgress, setHarnessProgress] =
    useState<HarnessProgressPayload | null>(null)
  const [traceId, setTraceId] = useState<string | null>(null)
  const queuedExplanation = useRef<QueuedExplanation | null>(null)
  const activeAiRequestId = useRef<string | null>(null)
  const aiDeadlineTimer = useRef<number | null>(null)
  const pendingAiRequest = useRef<PendingAiRequest | null>(null)
  const retryableAiRequest = useRef<RetryableAiRequest | null>(null)
  const settingsRef = useRef(settings)
  const conversationRef = useRef(conversation)
  const currentAiTargetRef = useRef<AiRequestTarget | null>(null)
  currentAiTargetRef.current = {
    boardFen: board.fen,
    analysisMove,
    actualMoveSelectionId: actualMove?.selectionId ?? null,
    submissionId: submittedGuess?.submissionId ?? null
  }

  useEffect(() => {
    settingsRef.current = settings
  }, [settings])

  useEffect(() => {
    conversationRef.current = conversation
  }, [conversation])

  useEffect(() => () => {
    if (activeAiRequestId.current) {
      window.api.ai.cancelExplanation(activeAiRequestId.current)
    }
    if (aiDeadlineTimer.current !== null) {
      window.clearTimeout(aiDeadlineTimer.current)
      aiDeadlineTimer.current = null
    }
  }, [])

  // 分析對象改變：取消進行中的 AI 請求、丟掉排隊提問與可重試請求，清空畫面上的解說。
  // 緊接在 useEngineAnalysis 的同名重設之後執行（AnalysisPanel 依此順序呼叫兩個 hook）。
  useEffect(() => {
    if (activeAiRequestId.current) {
      window.api.ai.cancelExplanation(activeAiRequestId.current)
    }
    if (aiDeadlineTimer.current !== null) {
      window.clearTimeout(aiDeadlineTimer.current)
      aiDeadlineTimer.current = null
    }
    activeAiRequestId.current = null
    queuedExplanation.current = null
    pendingAiRequest.current = null
    retryableAiRequest.current = null
    setAiBusy(false)
    setAiCancelling(false)
    setExplanation(null)
    setExplainedResult(null)
    setStreamingText('')
    setAnswerMeta(null)
    setFollowUp('')
    setHarnessProgress(null)
    setTraceId(null)
    setAiError(null)
    setAiNotice(null)
    onExplanation(null)
  }, [board.fen, analysisMove, actualMove?.selectionId])

  useEffect(() => {
    const isActiveAiRequest = (requestId: string): boolean => {
      const pending = pendingAiRequest.current
      return Boolean(
        requestId === activeAiRequestId.current &&
          pending &&
          isSameAiRequestTarget(pending.target, currentAiTargetRef.current)
      )
    }

    const offAiChunk = window.api.ai.onExplanationChunk((payload) => {
      if (payload.requestId !== activeAiRequestId.current) return
      if (!isActiveAiRequest(payload.requestId)) return
      const attempt = payload.attempt ?? 1
      if (attempt !== streamingAttemptRef.current) {
        // 修正或備援的新回答取代上一次的串流文字，不把兩次回答接在一起。
        streamingAttemptRef.current = attempt
        setStreamingAttempt(attempt)
        setStreamingText(payload.deltaText)
        return
      }
      setStreamingText((previous) => previous + payload.deltaText)
    })
    const offHarnessProgress = window.api.ai.onHarnessProgress((payload) => {
      if (payload.requestId !== activeAiRequestId.current) return
      if (!isActiveAiRequest(payload.requestId)) return
      setHarnessProgress(payload)
    })
    const offAiDone = window.api.ai.onExplanationDone((payload) => {
      if (payload.requestId !== activeAiRequestId.current) return
      if (!isActiveAiRequest(payload.requestId)) return
      if (aiDeadlineTimer.current !== null) {
        window.clearTimeout(aiDeadlineTimer.current)
        aiDeadlineTimer.current = null
      }
      const pending = pendingAiRequest.current
      const isEngineSummary = payload.answerKind === 'engine_summary'
      // 引擎摘要不是 AI 回答：保留原請求，讓「重試 AI」可以原樣再送一次。
      if (!isEngineSummary) retryableAiRequest.current = null
      activeAiRequestId.current = null
      pendingAiRequest.current = null
      setAiBusy(false)
      setAiCancelling(false)
      setHarnessProgress(null)
      setStreamingText('')
      setTraceId(payload.traceId ?? null)
      setAnswerMeta(
        payload.answerKind
          ? {
              answerKind: payload.answerKind,
              ...(payload.actualModel ? { actualModel: payload.actualModel } : {}),
              ...(payload.fallbackFromModel
                ? { fallbackFromModel: payload.fallbackFromModel, fallbackReason: payload.fallbackReason }
                : {})
            }
          : null
      )
      const response: AIExplanationResponse = {
        text: payload.finalText,
        provider: payload.provider ?? pending?.provider ?? settingsRef.current.aiProvider,
        model: payload.actualModel ?? payload.model ?? pending?.model ?? settingsRef.current.aiModel,
        usage: payload.usage,
        createdAt: Date.now(),
        groundedOnEngineData: true
      }
      setExplanation(response)
      onExplanation(response)

      if (pending) {
        const now = new Date().toISOString()
        const messages =
          pending.question === null
            ? [newMessage('assistant', payload.finalText, {
                provider: payload.provider ?? pending.provider,
                model: payload.actualModel ?? payload.model ?? pending.model
              })]
            : [
                ...pending.conversationMessages,
                newMessage('user', pending.question),
                newMessage('assistant', payload.finalText, {
                  provider: payload.provider ?? pending.provider,
                  model: payload.actualModel ?? payload.model ?? pending.model
                })
              ]
        const next: AIConversation = {
          id: pending.conversationId,
          analysisId: pending.analysisId,
          positionFen: pending.positionFen,
          createdAt: pending.conversationCreatedAt ?? now,
          updatedAt: now,
          messages
        }
        conversationRef.current = next
        setExplainedResult(pending.resultSnapshot)
        if (pending.question !== null) setFollowUp('')
        onConversationChange(next)
      }
    })
    const offAiError = window.api.ai.onExplanationError((payload) => {
      if (payload.requestId !== activeAiRequestId.current) return
      if (!isActiveAiRequest(payload.requestId)) return
      if (aiDeadlineTimer.current !== null) {
        window.clearTimeout(aiDeadlineTimer.current)
        aiDeadlineTimer.current = null
      }
      const failedModel = pendingAiRequest.current?.model
      activeAiRequestId.current = null
      pendingAiRequest.current = null
      setAiBusy(false)
      setAiCancelling(false)
      setHarnessProgress(null)
      setStreamingText('')
      if (payload.code === 'cancelled') setAiNotice('已取消生成；追問內容仍保留。')
      else {
        setAiError(payload.message)
        setAiDiagnostic(payload.diagnostic)
        setAiErrorInfo({
          code: payload.code,
          message: payload.message,
          diagnostic: payload.diagnostic,
          failureReason: payload.failureReason,
          model: failedModel
        })
      }
    })
    return () => {
      offAiChunk()
      offHarnessProgress()
      offAiDone()
      offAiError()
    }
  }, [onConversationChange, onExplanation])

  const generateExplanation = (question: string | null, regenerate = false): void => {
    if (activeAiRequestId.current || queuedExplanation.current) return
    if (
      activeRequestId.current &&
      currentAiTargetRef.current &&
      !canExplainWithCompletedResult(result?.engineAnalysis, board.fen, analysisMove)
    ) {
      queuedExplanation.current = {question, regenerate, target: {...currentAiTargetRef.current}}
      setAiBusy(true)
      setAiError(null)
      setAiDiagnostic(undefined)
      setAiNotice(WAITING_FOR_ENGINE_NOTICE)
      return
    }
    if (!result || activeAiRequestId.current) return
    if (!isSameAnalysisTarget(result.engineAnalysis, board.fen, analysisMove)) return
    const cleanedQuestion = question?.trim() || null
    const target = currentAiTargetRef.current
    if (!target) return
    const retained = regenerate ? retryableAiRequest.current : null
    if (retained && !isSameAiRequestTarget(retained.target, target)) return
    const resultSnapshot = result
    const requestId = crypto.randomUUID()
    const aiRequestedAt = Date.now()
    const currentConversation = regenerate ? null : conversationRef.current
    const start = retained
      ? cloneExplanationStart(retained.start)
      : {
          analysisId: resultSnapshot.analysisId,
          provider: settings.aiProvider,
          model: settings.aiModel,
          baseUrl:
            settings.aiProvider === 'openai-compatible'
              ? settings.aiBaseUrl
              : undefined,
          userLevel: settings.userLevel,
          explanationStyle: 'long_analytical' as const,
          language: settings.language,
          conversationHistory: buildConversationHistoryForRequest(
            currentConversation?.messages
          ),
          followUpQuestion: cleanedQuestion ?? undefined,
          attachedMove: analysisMove || undefined,
          userMoveReason: submittedGuess?.reason,
          engineId: primaryEngineId ?? undefined
        }
    const pending = retained
      ? {
          ...clonePendingAiRequest(retained.pending),
          target: { ...target }
        }
      : {
          target: { ...target },
          question: cleanedQuestion,
          conversationId: currentConversation?.id ?? crypto.randomUUID(),
          conversationCreatedAt: currentConversation?.createdAt ?? null,
          conversationMessages: currentConversation?.messages.slice() ?? [],
          analysisId: resultSnapshot.analysisId,
          positionFen: resultSnapshot.engineAnalysis.positionFen,
          resultSnapshot,
          provider: settings.aiProvider,
          model: settings.aiModel
        }
    activeAiRequestId.current = requestId
    pendingAiRequest.current = pending
    retryableAiRequest.current = {
      target: { ...target },
      pending: clonePendingAiRequest(pending),
      start: cloneExplanationStart(start)
    }
    if (explainedResult === null && conversationRef.current === null) {
      setExplainedResult(pending.resultSnapshot)
    }
    setAiBusy(true)
    setAiCancelling(false)
    setAiError(null)
    setAiDiagnostic(undefined)
    setAiNotice(null)
    setStreamingText('')
    streamingAttemptRef.current = 1
    setStreamingAttempt(1)
    setAnswerMeta(null)
    setHarnessProgress(null)
    window.api.ai.startExplanation({
      requestId,
      ...start
    })
    // 每個 AI 請求（一鍵解說、局面解說、追問）都有同一個硬截止，不會無限停在「生成中」。
    if (aiDeadlineTimer.current !== null) {
      window.clearTimeout(aiDeadlineTimer.current)
    }
    aiDeadlineTimer.current = window.setTimeout(() => {
      if (
        activeAiRequestId.current !== requestId ||
        !isSameAiRequestTarget(target, currentAiTargetRef.current)
      ) {
        return
      }
      const timedOutModel = pendingAiRequest.current?.model
      activeAiRequestId.current = null
      pendingAiRequest.current = null
      aiDeadlineTimer.current = null
      window.api.ai.cancelExplanation(requestId)
      setAiBusy(false)
      setAiCancelling(false)
      setHarnessProgress(null)
      setStreamingText('')
      const deadlineMessage = `AI 解說在點擊後 ${AI_REQUEST_DEADLINE_MS / 1000} 秒內未完成，本次已停止。請重試。`
      setAiError(deadlineMessage)
      setAiErrorInfo({
        code: 'provider_error',
        message: deadlineMessage,
        failureReason: 'model_timeout',
        model: timedOutModel
      })
    }, remainingOneClickDeadlineMs(aiRequestedAt))
  }

  /** 引擎完成這輪分析後送出排隊的提問；對象已改變就只解除等待狀態。 */
  const runQueuedExplanation = (): void => {
    const queued = queuedExplanation.current
    if (!queued) return
    queuedExplanation.current = null
    setAiBusy(false)
    if (!isSameAiRequestTarget(queued.target, currentAiTargetRef.current)) return
    generateExplanation(queued.question, queued.regenerate)
  }

  /** 新的猜測提交：取消舊請求並清空對話，讓這次提交從頭解說。 */
  const resetForNewSubmission = (): void => {
    if (activeAiRequestId.current) {
      window.api.ai.cancelExplanation(activeAiRequestId.current)
    }
    if (aiDeadlineTimer.current !== null) {
      window.clearTimeout(aiDeadlineTimer.current)
      aiDeadlineTimer.current = null
    }
    activeAiRequestId.current = null
    pendingAiRequest.current = null
    retryableAiRequest.current = null
    queuedExplanation.current = null
    conversationRef.current = null
    onConversationChange(null)
    setExplanation(null)
    setExplainedResult(null)
    setStreamingText('')
    setHarnessProgress(null)
    setAiError(null)
    setAiNotice(null)
  }

  /** 先排隊一個局面解說，等引擎完成這輪分析再送出。 */
  const queueExplanationUntilAnalysisCompletes = (target: AiRequestTarget): void => {
    queuedExplanation.current = {
      question: null,
      regenerate: false,
      target: { ...target }
    }
    setAiBusy(true)
    setAiNotice(WAITING_FOR_ENGINE_NOTICE)
  }

  /** 「全部停止」的排隊部分：丟掉等待中的提問；沒有進行中的請求就同時解除忙碌。 */
  const dropQueuedExplanation = (): void => {
    queuedExplanation.current = null
    if (!activeAiRequestId.current) setAiBusy(false)
  }

  /** 「全部停止」的請求部分：取消進行中的 AI 請求（結果由 error 事件收尾）。 */
  const cancelActiveExplanation = (): void => {
    if (activeAiRequestId.current) {
      setAiCancelling(true)
      window.api.ai.cancelExplanation(activeAiRequestId.current)
    }
  }

  const submitFollowUp = (): void => {
    const question = followUp.trim()
    if (!question) return
    generateExplanation(question)
  }

  const copyExplanation = async (): Promise<void> => {
    const currentConversation = conversationRef.current
    const text = currentConversation?.messages.length
      ? currentConversation.messages
          .map((message) => `${message.role === 'user' ? '問' : '答'}：${message.text}`)
          .join('\n\n')
      : explanation?.text
    if (!text) return
    try {
      await navigator.clipboard.writeText(text)
      setAiNotice('已複製 AI 解說。')
      setAiError(null)
    } catch {
      setAiError('無法存取剪貼簿，請手動選取文字複製。')
      setAiNotice(null)
    }
  }

  const cancelExplain = (): void => {
    if (queuedExplanation.current) {
      queuedExplanation.current = null
      setAiBusy(false)
      setAiNotice('已取消等待皮卡魚分析，問題仍保留。')
      return
    }
    if (!activeAiRequestId.current) return
    setAiCancelling(true)
    window.api.ai.cancelExplanation(activeAiRequestId.current)
  }

  const handleAiErrorAction = (action: AiErrorAction): void => {
    if (action === 'open_settings' || action === 'change_model') {
      onOpenAiSettings?.()
      return
    }
    if (action === 'reanalyze') {
      startAnalysis(false)
      return
    }
    generateExplanation(null, retryableAiRequest.current !== null)
  }

  const copyAiDiagnostics = (): void => {
    if (!aiErrorInfo) return
    void navigator.clipboard
      .writeText(aiErrorDiagnosticsText(aiErrorInfo))
      .then(() => setAiNotice('已複製診斷資訊（不含金鑰與對局內容）。'))
      .catch(() => setAiNotice('無法存取剪貼簿。'))
  }

  const retryAi = (): void => {
    if (activeAiRequestId.current) return
    generateExplanation(null, retryableAiRequest.current !== null)
  }

  const sendFeedback = (feedback: NonNullable<HarnessTrace['feedback']>): void => {
    if (!traceId) return
    void window.api.ai
      .setHarnessFeedback(traceId, feedback)
      .then(() => {
        setAiNotice('已記錄這次解說回饋。')
        setAiError(null)
      })
      .catch(() => {
        setAiError('回饋儲存失敗，請稍後再試。')
        setAiNotice(null)
      })
  }

  const engineLink: EngineAiLink = {
    invalidateExplanation: () => {
      setExplanation(null)
      if (!conversationRef.current) setExplainedResult(null)
    },
    abandonQueuedExplanation: (code) => {
      if (queuedExplanation.current) {
        queuedExplanation.current = null
        setAiBusy(false)
        setAiNotice(null)
        setAiError(code === 'cancelled' ? '已取消等待皮卡魚分析，問題仍保留。' : '皮卡魚分析未完成，請重試分析後再回答。')
      }
    }
  }

  return {
    aiError,
    aiDiagnostic,
    aiErrorInfo,
    aiNotice,
    explanation,
    explainedResult,
    aiBusy,
    aiCancelling,
    streamingText,
    streamingAttempt,
    answerMeta,
    followUp,
    setFollowUp,
    harnessProgress,
    traceId,
    /** 最新的對話（含尚未回到父層 props 的回答）。 */
    conversationRef,
    /** 這次 render 的分析對象；排隊提問與事件回應都用它判斷是否過期。 */
    currentAiTargetRef,
    hasQueuedExplanation: (): boolean => queuedExplanation.current !== null,
    engineLink,
    generateExplanation,
    runQueuedExplanation,
    resetForNewSubmission,
    queueExplanationUntilAnalysisCompletes,
    dropQueuedExplanation,
    cancelActiveExplanation,
    submitFollowUp,
    copyExplanation,
    cancelExplain,
    handleAiErrorAction,
    copyAiDiagnostics,
    retryAi,
    sendFeedback
  }
}
