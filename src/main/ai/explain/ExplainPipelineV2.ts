/**
 * v2 解說管線（ExplainPipelineV2）。
 *
 * 程式算事實 → 模型用白話講（純文字、可串流）→ 只查客觀硬錯 → 有錯自動修正一次
 * → 仍不過就交付「引擎重點摘要（非 AI 生成）」。主模型故障時可改用使用者核可的
 * 備援免費模型一次並明示。每題一般 1 次呼叫，上限 3 次，總截止 110 秒。
 */

import { randomUUID } from 'node:crypto'
import type { AIProvider, TokenUsage } from '@shared/types/AIProviderTypes'
import type { AIExplanationRequest, ExplanationLanguage } from '@shared/types/AIExplanationTypes'
import type { EngineAnalysis } from '@shared/types/EngineAnalysis'
import type {
  ExplainAttemptTrace,
  ExplanationAnswerKind,
  HarnessPhase,
  HarnessProgressPayload,
  HarnessTrace
} from '@shared/types/Harness'
import {
  buildExplanationFacts,
  formatFactsForPrompt,
  type ExplanationFacts
} from '@shared/logic/analysis/ExplanationFacts'
import { checkAnswer, type AnswerCheckResult } from '@shared/logic/ai/AnswerCheck'
import { buildEngineSummary } from '@shared/logic/ai/EngineSummary'
import type { EngineRegistryService } from '../../engine/EngineRegistryService'
import type { HarnessTraceStore } from '../../storage/HarnessTraceStore'
import type { AnalysisSession } from '../../storage/AnalysisSessionStore'
import { buildBoardQuestionFacts } from '../BoardQuestionFacts'
import { describeAIExecutionError } from '../http'
import type { PreparedExplanationExecution } from '../prepareExplanationExecution'
import {
  CALL_TIMEOUT_MS,
  ENSURE_LINES_ENGINE_MS,
  MAX_CALLS,
  MIN_RETRY_WINDOW_MS,
  TOTAL_DEADLINE_MS,
  VISIBLE_TOKENS
} from './budget'
import { buildPromptV2, type ExplainMode } from './promptV2'
import { buildRepairPrompt } from './repairPrompt'

export interface ExplainPipelineDeps {
  provider: AIProvider
  apiKey: string
  registry: EngineRegistryService
  traceStore: HarnessTraceStore
  signal: AbortSignal
  onProgress: (payload: Omit<HarnessProgressPayload, 'requestId'>) => void
  /** 串流文字；attempt 改變時 renderer 要先清空舊文字。 */
  onDelta?: (deltaText: string, attempt: number) => void
  /** 使用者核可的備援模型（只有 OpenRouter 會傳入）。 */
  backupModels?: readonly string[]
  timing?: Partial<{
    callTimeoutMs: number
    totalDeadlineMs: number
    minRetryWindowMs: number
  }>
}

export interface ExplainPipelineResult {
  finalText: string
  answerKind: ExplanationAnswerKind
  /** 實際交付回答的模型（備援時為備援模型）。 */
  actualModel?: string
  fallbackFromModel?: string
  fallbackReason?: string
  repairUsed: boolean
  usage?: TokenUsage
  traceId: string
  warnings: string[]
}

/** 單次呼叫超過時限；name 設為 TimeoutError 讓既有診斷分類為 timeout。 */
class PipelineCallTimeoutError extends Error {
  constructor() {
    super('模型呼叫超過時間。')
    this.name = 'TimeoutError'
  }
}

type FailureClass = 'fatal' | 'backup_eligible' | 'incomplete'

/**
 * 依診斷分類決定：
 * - fatal：金鑰、帳務、每日額度、網路等，換模型也沒用，直接回錯讓錯誤卡提示處理方式；
 * - backup_eligible：限流（每分鐘）、5xx、403、404、逾時、格式錯，可改用備援模型；
 * - incomplete：空白或截斷，先以關閉推理重試同一模型。
 */
export function classifyModelFailure(error: unknown): FailureClass {
  const diagnostic = describeAIExecutionError(error, 'AI 服務')
  switch (diagnostic.category) {
    case 'generation_incomplete':
      return 'incomplete'
    case 'rate_limited':
      return diagnostic.quota === 'daily' ? 'fatal' : 'backup_eligible'
    case 'provider_unavailable':
    case 'permission':
    case 'model_unavailable':
    case 'timeout':
    case 'response_format':
    case 'model_mismatch':
      return 'backup_eligible'
    default:
      return 'fatal'
  }
}

const FAILURE_REASON: Record<ExplanationLanguage, Record<'check' | 'unavailable' | 'timeout' | 'incomplete', string>> = {
  'zh-TW': {
    check: '回答與引擎事實不符',
    unavailable: '模型暫時無法回應',
    timeout: '模型超過時間沒有回答',
    incomplete: '模型沒有給出完整答案'
  },
  'zh-CN': {
    check: '回答与引擎事实不符',
    unavailable: '模型暂时无法回应',
    timeout: '模型超过时间没有回答',
    incomplete: '模型没有给出完整答案'
  },
  en: {
    check: 'the answer contradicted the engine facts',
    unavailable: 'the model is temporarily unavailable',
    timeout: 'the model took too long',
    incomplete: 'the model did not finish an answer'
  }
}

function failureReasonKey(error: unknown): 'unavailable' | 'timeout' | 'incomplete' {
  const category = describeAIExecutionError(error, 'AI 服務').category
  if (category === 'timeout') return 'timeout'
  if (category === 'generation_incomplete' || category === 'response_format') return 'incomplete'
  return 'unavailable'
}

function isAbortError(error: unknown): boolean {
  return (
    error instanceof Error &&
    (error.name === 'AbortError' || error.name === 'APIUserAbortError')
  )
}

function modeFor(execution: PreparedExplanationExecution): ExplainMode {
  if (execution.answerStrategy === 'conversation-follow-up') return 'question'
  return execution.effective.attachedMove ? 'move' : 'position'
}

function addUsage(total: TokenUsage | undefined, next: TokenUsage | undefined): TokenUsage | undefined {
  if (!next) return total
  return {
    inputTokens: (total?.inputTokens ?? 0) + next.inputTokens,
    outputTokens: (total?.outputTokens ?? 0) + next.outputTokens,
    ...(next.reasoningTokens !== undefined || total?.reasoningTokens !== undefined
      ? { reasoningTokens: (total?.reasoningTokens ?? 0) + (next.reasoningTokens ?? 0) }
      : {})
  }
}

/**
 * 主線太短時補算一次引擎（最多約 5 秒），讓事實表有東西可講；
 * 失敗或沒有引擎時沿用原本的分析，不擋解說。不修改 v1 的同名邏輯。
 */
async function ensureMinimumLines(
  session: AnalysisSession,
  attachedMove: string | undefined,
  engineId: string | undefined,
  registry: EngineRegistryService,
  signal: AbortSignal
): Promise<{ analysis: EngineAnalysis; engineRounds: number }> {
  const analysis = session.engineAnalysis
  const userLineTooShort =
    attachedMove !== undefined &&
    (analysis.userMove !== attachedMove ||
      (attachedMove !== analysis.bestMove &&
        (analysis.userMovePrincipalVariation?.length ?? 0) < 3))
  if ((analysis.principalVariation?.length ?? 0) >= 2 && !userLineTooShort) {
    return { analysis, engineRounds: 0 }
  }
  const resolvedEngineId =
    engineId ?? session.primaryEngineId ?? registry.list().activeEngineId ?? undefined
  const adapter = resolvedEngineId ? registry.getAdapter(resolvedEngineId) : null
  if (!adapter) return { analysis, engineRounds: 0 }
  try {
    const refreshed = await adapter.analyzePosition(
      { positionFen: session.positionFen, userMove: attachedMove },
      {
        rootAnalysisMovetimeMs: ENSURE_LINES_ENGINE_MS,
        userMoveEvalMovetimeMs: ENSURE_LINES_ENGINE_MS,
        multiPv: 3
      },
      { signal }
    )
    return { analysis: refreshed, engineRounds: 1 }
  } catch (error) {
    if (signal.aborted || isAbortError(error)) throw error
    return { analysis, engineRounds: 1 }
  }
}

export async function runExplainPipelineV2(
  execution: PreparedExplanationExecution,
  deps: ExplainPipelineDeps
): Promise<ExplainPipelineResult> {
  const payload = execution.effective
  const session = payload.session as AnalysisSession
  const language = payload.language
  const mode = modeFor(execution)
  const traceId = randomUUID()
  const startedAt = Date.now()
  const timing = {
    callTimeoutMs: deps.timing?.callTimeoutMs ?? CALL_TIMEOUT_MS,
    totalDeadlineMs: deps.timing?.totalDeadlineMs ?? TOTAL_DEADLINE_MS,
    minRetryWindowMs: deps.timing?.minRetryWindowMs ?? MIN_RETRY_WINDOW_MS
  }
  const deadlineAt = startedAt + timing.totalDeadlineMs
  const remaining = (): number => deadlineAt - Date.now()
  const phases: HarnessTrace['phases'] = []
  const attempts: ExplainAttemptTrace[] = []
  let usage: TokenUsage | undefined
  let modelCalls = 0
  let engineRounds = 0
  let check: AnswerCheckResult | null = null

  const progress = (phase: HarnessPhase, message: string): void => {
    phases.push({ phase, at: new Date().toISOString(), message })
    deps.onProgress({
      phase,
      message,
      modelCallsUsed: modelCalls,
      engineRoundsUsed: engineRounds,
      evidenceCount: 0,
      elapsedMs: Date.now() - startedAt
    })
  }

  const saveTrace = (
    status: HarnessTrace['status'],
    extra: { finalText?: string; answerKind?: ExplanationAnswerKind; error?: unknown; model?: string }
  ): void => {
    // 診斷紀錄非同步寫入（設計原則 §9）；store 內部依序執行，寫入失敗不影響回答。
    try {
      void Promise.resolve(deps.traceStore.save({
        id: traceId,
        createdAt: new Date().toISOString(),
        requestId: payload.requestId,
        analysisId: payload.analysisId,
        provider: payload.provider,
        model: extra.model ?? payload.model,
        language,
        historyMessageCount: payload.conversationHistory.length,
        durationMs: Date.now() - startedAt,
        positionFen: session.positionFen,
        question: payload.followUpQuestion,
        attachedMove: payload.attachedMove,
        mode: payload.answerMode,
        primaryEngineId:
          payload.engineId ?? session.primaryEngineId ?? 'unknown-engine',
        phases,
        evidence: [],
        validationErrors: check?.hardErrors.map((error) => `${error.code} ${error.message}`) ?? [],
        modelCalls,
        engineRounds,
        usage,
        ...(status === 'failed' && extra.error !== undefined
          ? { providerDiagnostic: describeAIExecutionError(extra.error, 'AI 服務') }
          : {}),
        interactionKind: execution.interactionKind,
        executionSemanticsVersion: execution.executionSemanticsVersion,
        status,
        finalText: extra.finalText,
        pipelineVersion: 2,
        ...(extra.answerKind ? { answerKind: extra.answerKind } : {}),
        attempts,
        hardErrors: check?.hardErrors.map((error) => `${error.code} ${error.message}`) ?? [],
        softWarnings: check?.softWarnings.map((warning) => `${warning.code} ${warning.message}`) ?? []
      })).catch(() => undefined)
    } catch {
      // 診斷紀錄寫入失敗不影響回答。
    }
  }

  const throwIfAborted = (): void => {
    if (deps.signal.aborted) throw new DOMException('Request cancelled', 'AbortError')
  }

  try {
    progress('understanding', '正在理解問題與局面。')
    const question = payload.followUpQuestion?.trim()
    if (question) {
      const board = buildBoardQuestionFacts(session.positionFen, question, language)
      if (board.directAnswer) {
        progress('completed', '已用棋規直接回答。')
        saveTrace('completed', { finalText: board.directAnswer, answerKind: 'board_rule' })
        return {
          finalText: board.directAnswer,
          answerKind: 'board_rule',
          repairUsed: false,
          traceId,
          warnings: []
        }
      }
    }

    const ensured = await ensureMinimumLines(
      session,
      payload.attachedMove,
      payload.engineId,
      deps.registry,
      deps.signal
    )
    engineRounds += ensured.engineRounds
    if (ensured.engineRounds > 0) progress('engine_research', '主線太短，已補算一次引擎。')
    throwIfAborted()

    const comparison =
      session.moveComparison.userMove === ensured.analysis.userMove
        ? session.moveComparison
        : null
    const facts: ExplanationFacts = buildExplanationFacts(ensured.analysis, comparison)
    const factsText = formatFactsForPrompt(facts, language)
    const prompt = buildPromptV2({
      mode,
      language,
      userLevel: payload.userLevel,
      facts,
      factsText,
      question,
      userMoveReason: payload.userMoveReason,
      history: payload.conversationHistory
    })
    const userText = [question ?? '', payload.userMoveReason ?? ''].join('\n')

    let attemptNumber = 0
    const callModel = async (
      model: string,
      kind: ExplainAttemptTrace['kind'],
      userPrompt: string,
      reasoningMode?: 'off_strict'
    ): Promise<{ text: string; finishReason?: string }> => {
      throwIfAborted()
      const timeoutMs = Math.min(timing.callTimeoutMs, remaining())
      if (timeoutMs <= 0) throw new PipelineCallTimeoutError()
      modelCalls += 1
      attemptNumber += 1
      const attempt = attemptNumber
      const callStartedAt = Date.now()
      const controller = new AbortController()
      let timedOut = false
      const forwardAbort = (): void => controller.abort()
      deps.signal.addEventListener('abort', forwardAbort, { once: true })
      const timer = setTimeout(() => {
        timedOut = true
        controller.abort()
      }, timeoutMs)
      const visibleTokens = Math.round(
        VISIBLE_TOKENS[mode] * (reasoningMode === 'off_strict' ? 1.5 : 1)
      )
      const request: AIExplanationRequest = {
        provider: payload.provider,
        model,
        apiKey: deps.apiKey,
        baseUrl: payload.baseUrl,
        systemPrompt: prompt.systemPrompt,
        prompt: userPrompt,
        maxOutputTokens: visibleTokens,
        responseFormat: 'text',
        ...(reasoningMode ? { reasoningMode } : {}),
        metadata: {
          requestId: payload.requestId,
          analysisId: payload.analysisId,
          userLevel: payload.userLevel,
          explanationStyle: payload.explanationStyle
        }
      }
      let text = ''
      let finishReason: string | undefined
      let callUsage: TokenUsage | undefined
      try {
        for await (const chunk of deps.provider.generateExplanationStream(request, controller.signal)) {
          if (chunk.type === 'text_delta') {
            text += chunk.deltaText
            deps.onDelta?.(chunk.deltaText, attempt)
          } else {
            finishReason = chunk.finishReason
            callUsage = chunk.usage
          }
        }
        if (controller.signal.aborted) {
          throw timedOut && !deps.signal.aborted
            ? new PipelineCallTimeoutError()
            : new DOMException('Request cancelled', 'AbortError')
        }
        usage = addUsage(usage, callUsage)
        attempts.push({
          model,
          kind,
          durationMs: Date.now() - callStartedAt,
          ...(finishReason ? { finishReason } : {}),
          ...(callUsage ? { outputTokens: callUsage.outputTokens } : {}),
          ...(callUsage?.reasoningTokens !== undefined ? { reasoningTokens: callUsage.reasoningTokens } : {})
        })
        return { text: text.trim(), finishReason }
      } catch (error) {
        const surfaced =
          timedOut && !deps.signal.aborted ? new PipelineCallTimeoutError() : error
        attempts.push({
          model,
          kind,
          durationMs: Date.now() - callStartedAt,
          error: isAbortError(surfaced)
            ? 'cancelled'
            : describeAIExecutionError(surfaced, 'AI 服務').category
        })
        throw surfaced
      } finally {
        clearTimeout(timer)
        deps.signal.removeEventListener('abort', forwardAbort)
      }
    }

    const canCallAgain = (): boolean =>
      modelCalls < MAX_CALLS && remaining() >= timing.minRetryWindowMs

    // ---- 取得第一份答案：主模型 → （空白／截斷時關閉推理重試）→ 備援模型 ----
    progress('writing', '正在請 AI 依引擎事實寫解說。')
    let answer: { text: string; finishReason?: string } | null = null
    let answeringModel = payload.model
    let fallbackFromModel: string | undefined
    let fallbackReason: string | undefined
    let lastError: unknown = null
    try {
      answer = await callModel(payload.model, 'primary', prompt.prompt)
    } catch (error) {
      if (isAbortError(error) && deps.signal.aborted) throw error
      lastError = error
    }
    if (!answer && lastError && classifyModelFailure(lastError) === 'incomplete' && canCallAgain()) {
      progress('provider_retry', 'AI 模型沒有交出完整答案，正在關閉推理後重試一次。')
      try {
        answer = await callModel(payload.model, 'recovery', prompt.prompt, 'off_strict')
        lastError = null
      } catch (error) {
        if (isAbortError(error) && deps.signal.aborted) throw error
        lastError = error
      }
    }
    if (!answer && lastError && classifyModelFailure(lastError) === 'fatal') {
      throw lastError
    }
    const backup = (deps.backupModels ?? []).find((model) => model !== payload.model)
    if (!answer && lastError && backup && canCallAgain()) {
      fallbackFromModel = payload.model
      fallbackReason = FAILURE_REASON[language][failureReasonKey(lastError)]
      progress('provider_retry', `${payload.model} 暫時無法使用，改用備援模型 ${backup}。`)
      try {
        answer = await callModel(backup, 'backup', prompt.prompt)
        answeringModel = backup
        lastError = null
      } catch (error) {
        if (isAbortError(error) && deps.signal.aborted) throw error
        lastError = error
        if (classifyModelFailure(error) === 'fatal') throw error
      }
    }

    const deliverSummary = (reasonKey: keyof (typeof FAILURE_REASON)['zh-TW']): ExplainPipelineResult => {
      const finalText = buildEngineSummary(facts, FAILURE_REASON[language][reasonKey], language)
      progress('completed', '已改用引擎重點摘要（非 AI 生成）。')
      saveTrace('completed', { finalText, answerKind: 'engine_summary', model: answeringModel })
      return {
        finalText,
        answerKind: 'engine_summary',
        repairUsed: attempts.some((item) => item.kind === 'repair'),
        usage,
        traceId,
        warnings: [FAILURE_REASON[language][reasonKey]],
        ...(fallbackFromModel ? { fallbackFromModel, fallbackReason } : {})
      }
    }

    if (!answer) {
      return deliverSummary(failureReasonKey(lastError))
    }

    // ---- 客觀檢查；有硬錯就修正一次 ----
    progress('validating', '正在檢查回答是否與引擎事實一致。')
    check = checkAnswer({
      text: answer.text,
      finishReason: answer.finishReason,
      mode,
      language,
      facts,
      userText
    })
    let repairUsed = false
    if (check.hardErrors.length > 0 && canCallAgain()) {
      repairUsed = true
      progress('repairing', '回答有和引擎資料不符的地方，正在請 AI 修正一次。')
      try {
        const repaired = await callModel(
          answeringModel,
          'repair',
          buildRepairPrompt({
            language,
            errors: check.hardErrors,
            factsText,
            previousAnswer: answer.text
          })
        )
        const recheck = checkAnswer({
          text: repaired.text,
          finishReason: repaired.finishReason,
          mode,
          language,
          facts,
          userText
        })
        answer = repaired
        check = recheck
      } catch (error) {
        if (isAbortError(error) && deps.signal.aborted) throw error
        // 修正呼叫失敗：保留原本的檢查結果，下面改交摘要。
      }
    }
    if (check.hardErrors.length > 0) {
      return deliverSummary('check')
    }

    progress('completed', '已通過檢查。')
    saveTrace('completed', { finalText: answer.text, answerKind: 'ai', model: answeringModel })
    return {
      finalText: answer.text,
      answerKind: 'ai',
      actualModel: answeringModel,
      ...(fallbackFromModel ? { fallbackFromModel, fallbackReason } : {}),
      repairUsed,
      usage,
      traceId,
      warnings: check.softWarnings.map((warning) => warning.message)
    }
  } catch (error) {
    const cancelled = isAbortError(error) && deps.signal.aborted
    saveTrace(cancelled ? 'cancelled' : 'failed', { error })
    throw error
  }
}
