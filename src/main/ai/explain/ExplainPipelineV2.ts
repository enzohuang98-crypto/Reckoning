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
import type { EngineAnalysis, IdeaProbes } from '@shared/types/EngineAnalysis'
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
import { tidyAnswerText } from '@shared/logic/ai/AnswerTidy'
import { buildEngineSummary } from '@shared/logic/ai/EngineSummary'
import type { EngineRegistryService } from '../../engine/EngineRegistryService'
import type { HarnessTraceStore } from '../../storage/HarnessTraceStore'
import type { AnalysisSession } from '../../storage/AnalysisSessionStore'
import { buildBoardQuestionFacts } from '../BoardQuestionFacts'
import { AIHttpError, describeAIExecutionError } from '../http'
import type { PreparedExplanationExecution } from '../prepareExplanationExecution'
import {
  CALL_TIMEOUT_MS,
  ENSURE_LINES_ENGINE_MS,
  IDEA_PROBE_DEADLINE_MS,
  IDEA_PROBE_ENGINE_MS,
  MAX_CALLS,
  MIN_RETRY_WINDOW_MS,
  RATE_LIMIT_DEFAULT_WAIT_MS,
  RATE_LIMIT_RETRY_MAX_WAIT_MS,
  TOTAL_DEADLINE_MS,
  VISIBLE_TOKENS
} from './budget'
import { buildPromptV2, type ExplainMode } from './promptV2'
import { buildRepairPrompt } from './repairPrompt'
import { isCertificateErrorCode } from '@shared/logic/ai/networkErrorCodes'

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
    rateLimitMaxWaitMs: number
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

type FailureClass = 'fatal' | 'backup_eligible' | 'incomplete' | 'network' | 'certificate'

/**
 * 依診斷分類決定：
 * - fatal：金鑰、帳務、每日額度等，換模型也沒用，直接回錯讓錯誤卡提示處理方式；
 * - backup_eligible：限流（每分鐘）、5xx、403、404、逾時、格式錯，可改用備援模型；
 * - incomplete：空白或截斷，先以關閉推理重試同一模型；
 * - network：連線中斷（常見是重用了已被服務端關閉的連線），先重試同一模型一次，
 *   仍失敗就照一般流程改備援或交付引擎摘要，不讓一次瞬間斷線變成整題失敗；
 * - certificate：HTTPS 憑證驗證失敗（多半是防毒軟體攔截），重試或換模型都不會好，
 *   直接交付引擎摘要並說明原因。
 */
export function classifyModelFailure(error: unknown): FailureClass {
  const diagnostic = describeAIExecutionError(error, 'AI 服務')
  switch (diagnostic.category) {
    case 'generation_incomplete':
      return 'incomplete'
    case 'network':
      return isCertificateErrorCode(diagnostic.networkCode) ? 'certificate' : 'network'
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

const FAILURE_REASON: Record<
  ExplanationLanguage,
  Record<
    'check' | 'unknownMove' | 'format' | 'side' | 'unavailable' | 'timeout' | 'incomplete' | 'network' | 'certificate',
    string
  >
> = {
  'zh-TW': {
    check: '回答與引擎事實不符',
    unknownMove: '回答提到引擎資料以外的著法',
    format: '回答格式不符（缺段落或含內部格式）',
    side: '回答把輪到哪一方走說錯了',
    unavailable: '模型暫時無法回應',
    timeout: '模型超過時間沒有回答',
    incomplete: '模型沒有給出完整答案',
    network: '連不上 AI 服務，請檢查網路',
    certificate: 'HTTPS 憑證驗證失敗，可能是防毒軟體攔截了連線'
  },
  'zh-CN': {
    check: '回答与引擎事实不符',
    unknownMove: '回答提到引擎数据以外的着法',
    format: '回答格式不符（缺段落或含内部格式）',
    side: '回答把轮到哪一方走说错了',
    unavailable: '模型暂时无法回应',
    timeout: '模型超过时间没有回答',
    incomplete: '模型没有给出完整答案',
    network: '连不上 AI 服务，请检查网络',
    certificate: 'HTTPS 证书验证失败，可能是杀毒软件拦截了连接'
  },
  en: {
    check: 'the answer contradicted the engine facts',
    unknownMove: 'the answer mentioned moves that are not in the engine data',
    format: 'the answer was missing sections or contained internal formatting',
    side: 'the answer got the side to move wrong',
    unavailable: 'the model is temporarily unavailable',
    timeout: 'the model took too long',
    incomplete: 'the model did not finish an answer',
    network: 'could not reach the AI service; check the network',
    certificate: 'HTTPS certificate verification failed; antivirus HTTPS scanning may be intercepting the connection'
  }
}

function failureReasonKey(
  error: unknown
): 'unavailable' | 'timeout' | 'incomplete' | 'network' | 'certificate' {
  const diagnostic = describeAIExecutionError(error, 'AI 服務')
  const category = diagnostic.category
  if (category === 'network') {
    return isCertificateErrorCode(diagnostic.networkCode) ? 'certificate' : 'network'
  }
  if (category === 'timeout') return 'timeout'
  if (category === 'generation_incomplete' || category === 'response_format') return 'incomplete'
  return 'unavailable'
}

/**
 * 摘要原因後面補上最後一次失敗的細節（失敗分類、回答到一半中斷、服務回報的代碼）：
 * 同一句「模型暫時無法回應」底下可能是 5xx、串流中途錯誤或模型路由不一致，只看截圖分不出來。
 */
function failureDetail(attempt: ExplainAttemptTrace | undefined, language: ExplanationLanguage): string {
  if (!attempt?.error) return ''
  const en = language === 'en'
  const parts = [
    ...(attempt.midStream ? [en ? 'stopped mid-answer' : language === 'zh-CN' ? '回答到一半中断' : '回答到一半中斷'] : []),
    attempt.error,
    ...(attempt.providerCode ? [`${en ? 'code' : language === 'zh-CN' ? '代码' : '代碼'} ${attempt.providerCode}`] : [])
  ]
  return en ? ` (${parts.join('; ')})` : `（${parts.join('；')}）`
}

/** 檢查沒過時附上第一條硬錯（程式自己寫的說明，只含事實表著法），截圖就看得出是哪一句被擋。 */
function checkFailureDetail(check: AnswerCheckResult, language: ExplanationLanguage): string {
  const first = check.hardErrors[0]
  if (!first) return ''
  const message = first.message.replace(/[。.]$/, '')
  const clipped = message.length > 80 ? `${message.slice(0, 80)}…` : message
  return language === 'en' ? ` (${first.code}: ${clipped})` : `（${first.code}：${clipped}）`
}

/** 修正後仍有硬錯時，摘要說明最主要的那一種（事實矛盾優先），不要一律說「與事實不符」。 */
function checkFailureReason(
  check: AnswerCheckResult
): 'check' | 'unknownMove' | 'format' | 'side' | 'incomplete' {
  const codes = new Set(check.hardErrors.map((error) => error.code))
  if (codes.has('H5') || codes.has('H8')) return 'check'
  if (codes.has('H4')) return 'unknownMove'
  if (codes.has('H7')) return 'side'
  if (codes.has('H1') || codes.has('H2')) return 'incomplete'
  return 'format'
}

/** 分鐘級限流（不是每日額度）時要等多久再重試；服務要求等太久就回 null（不重試）。 */
function minuteRateLimitWait(error: unknown, maxWaitMs: number): number | null {
  const diagnostic = describeAIExecutionError(error, 'AI 服務')
  if (diagnostic.category !== 'rate_limited' || diagnostic.quota === 'daily') return null
  const wait = diagnostic.retryAfterMs ?? Math.min(RATE_LIMIT_DEFAULT_WAIT_MS, maxWaitMs)
  return wait <= maxWaitMs ? wait : null
}

function abortableDelay(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new DOMException('Request cancelled', 'AbortError'))
      return
    }
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort)
      resolve()
    }, ms)
    const onAbort = (): void => {
      clearTimeout(timer)
      reject(new DOMException('Request cancelled', 'AbortError'))
    }
    signal.addEventListener('abort', onAbort, { once: true })
  })
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

/** 同一局面、首選與棋手著法的關鍵著法檢查只算一次，追問直接沿用。 */
const ideaProbeCache = new Map<string, IdeaProbes>()
const IDEA_PROBE_CACHE_LIMIT = 20

/**
 * 關鍵著法檢查：把主線看不到的「如果…」另外問引擎（對手的威脅、對手照樣應著、首選的威脅），
 * 讓事實表能點出真正關鍵的那一手。盡力而為：沒有引擎、逾時或失敗就不附，解說照常進行；
 * 只有使用者取消才往外丟。
 */
async function findKeyIdeas(
  analysis: EngineAnalysis,
  session: AnalysisSession,
  engineId: string | undefined,
  registry: EngineRegistryService,
  signal: AbortSignal
): Promise<{ probes?: IdeaProbes; engineRounds: number }> {
  const key = [analysis.positionFen, analysis.bestMove, analysis.userMove ?? ''].join('|')
  const cached = ideaProbeCache.get(key)
  if (cached) return { probes: cached, engineRounds: 0 }
  const resolvedEngineId =
    engineId ?? session.primaryEngineId ?? registry.list().activeEngineId ?? undefined
  const adapter = resolvedEngineId ? registry.getAdapter(resolvedEngineId) : null
  if (!adapter) return { engineRounds: 0 }
  const controller = new AbortController()
  const forwardAbort = (): void => controller.abort()
  signal.addEventListener('abort', forwardAbort, { once: true })
  const timer = setTimeout(() => controller.abort(), IDEA_PROBE_DEADLINE_MS)
  try {
    const probes = await adapter.probeIdeas(
      {
        positionFen: analysis.positionFen,
        bestMove: analysis.bestMove,
        bestLine: analysis.principalVariation,
        userLine: analysis.userMove ? analysis.userMovePrincipalVariation : undefined
      },
      { movetimeMs: IDEA_PROBE_ENGINE_MS, signal: controller.signal }
    )
    if (ideaProbeCache.size >= IDEA_PROBE_CACHE_LIMIT) {
      const oldest = ideaProbeCache.keys().next().value
      if (oldest !== undefined) ideaProbeCache.delete(oldest)
    }
    ideaProbeCache.set(key, probes)
    return { probes, engineRounds: 1 }
  } catch (error) {
    if (signal.aborted) throw error
    return { engineRounds: 1 }
  } finally {
    clearTimeout(timer)
    signal.removeEventListener('abort', forwardAbort)
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
    minRetryWindowMs: deps.timing?.minRetryWindowMs ?? MIN_RETRY_WINDOW_MS,
    rateLimitMaxWaitMs: deps.timing?.rateLimitMaxWaitMs ?? RATE_LIMIT_RETRY_MAX_WAIT_MS
  }
  const deadlineAt = startedAt + timing.totalDeadlineMs
  const remaining = (): number => deadlineAt - Date.now()
  const phases: HarnessTrace['phases'] = []
  const attempts: ExplainAttemptTrace[] = []
  let usage: TokenUsage | undefined
  let modelCalls = 0
  let engineRounds = 0
  let check: AnswerCheckResult | null = null
  /** 修正前那一輪的硬錯；修正後的硬錯記在 hardErrors。 */
  let firstHardErrors: string[] | undefined

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
        ...(firstHardErrors ? { firstHardErrors } : {}),
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

    progress('engine_research', '正在找這局的關鍵著法：對手的威脅、對手照樣走會怎樣、首選的威脅。')
    const ideas = await findKeyIdeas(
      ensured.analysis,
      session,
      payload.engineId,
      deps.registry,
      deps.signal
    )
    engineRounds += ideas.engineRounds
    throwIfAborted()

    const comparison =
      session.moveComparison.userMove === ensured.analysis.userMove
        ? session.moveComparison
        : null
    const facts: ExplanationFacts = buildExplanationFacts(ensured.analysis, comparison, ideas.probes)
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
        const diagnostic = isAbortError(surfaced)
          ? null
          : describeAIExecutionError(surfaced, 'AI 服務')
        const providerCode = surfaced instanceof AIHttpError ? surfaced.providerCode : undefined
        attempts.push({
          model,
          kind,
          durationMs: Date.now() - callStartedAt,
          error: diagnostic ? diagnostic.category : 'cancelled',
          ...(diagnostic?.networkCode ? { networkCode: diagnostic.networkCode } : {}),
          ...(providerCode ? { providerCode } : {}),
          ...(text.length > 0 ? { midStream: true } : {})
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
    if (!answer && lastError && classifyModelFailure(lastError) === 'network' && canCallAgain()) {
      progress('provider_retry', '和 AI 服務的連線中斷，正在重試一次。')
      try {
        answer = await callModel(payload.model, 'network_retry', prompt.prompt)
        lastError = null
      } catch (error) {
        if (isAbortError(error) && deps.signal.aborted) throw error
        lastError = error
      }
    }
    // 分鐘級限流而且沒有可用的備援（例如 demo 用的付費模型）：等服務建議的時間（最多 5 秒）後同一模型重試一次。
    const hasBackup = (deps.backupModels ?? []).some((model) => model !== payload.model)
    const rateWait = !answer && lastError && !hasBackup ? minuteRateLimitWait(lastError, timing.rateLimitMaxWaitMs) : null
    if (rateWait !== null && canCallAgain()) {
      progress('provider_retry', 'AI 服務暫時限流，稍等一下再試一次。')
      try {
        await abortableDelay(rateWait, deps.signal)
        answer = await callModel(payload.model, 'rate_limit_retry', prompt.prompt)
        lastError = null
      } catch (error) {
        if (isAbortError(error) && deps.signal.aborted) throw error
        lastError = error
      }
    }
    // 服務端暫時錯誤（5xx、過載）而且沒有可用的備援（例如付費模型）：同一模型重試一次。
    // 實測：Sonnet 偶爾回 5xx，沒有備援時整題直接變成引擎摘要。
    if (
      !answer &&
      lastError &&
      !hasBackup &&
      describeAIExecutionError(lastError, 'AI 服務').category === 'provider_unavailable' &&
      canCallAgain()
    ) {
      progress('provider_retry', 'AI 服務暫時忙碌，正在重試一次。')
      try {
        answer = await callModel(payload.model, 'unavailable_retry', prompt.prompt)
        lastError = null
      } catch (error) {
        if (isAbortError(error) && deps.signal.aborted) throw error
        lastError = error
      }
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
    if (!answer && lastError && backup && classifyModelFailure(lastError) !== 'certificate' && canCallAgain()) {
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

    const deliverSummary = (
      reasonKey: keyof (typeof FAILURE_REASON)['zh-TW'],
      detail = ''
    ): ExplainPipelineResult => {
      const reason = `${FAILURE_REASON[language][reasonKey]}${detail}`
      const finalText = buildEngineSummary(facts, reason, language)
      progress('completed', '已改用引擎重點摘要（非 AI 生成）。')
      saveTrace('completed', { finalText, answerKind: 'engine_summary', model: answeringModel })
      return {
        finalText,
        answerKind: 'engine_summary',
        repairUsed: attempts.some((item) => item.kind === 'repair'),
        usage,
        traceId,
        warnings: [reason],
        ...(fallbackFromModel ? { fallbackFromModel, fallbackReason } : {})
      }
    }

    if (!answer) {
      return deliverSummary(failureReasonKey(lastError), failureDetail(attempts.at(-1), language))
    }

    // ---- 客觀檢查；有硬錯就修正一次 ----
    // 先做不改變意思的修整（提示標籤換成「引擎資料」、混用數字的著法改回事實表寫法），
    // 避免內容正確的回答只因用字被擋；交付的也是修整後的文字。
    answer = { ...answer, text: tidyAnswerText(answer.text, facts, language) }
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
        repaired.text = tidyAnswerText(repaired.text, facts, language)
        const recheck = checkAnswer({
          text: repaired.text,
          finishReason: repaired.finishReason,
          mode,
          language,
          facts,
          userText
        })
        firstHardErrors = check.hardErrors.map((error) => `${error.code} ${error.message}`)
        answer = repaired
        check = recheck
      } catch (error) {
        if (isAbortError(error) && deps.signal.aborted) throw error
        // 修正呼叫失敗：保留原本的檢查結果，下面改交摘要。
      }
    }
    if (check.hardErrors.length > 0) {
      return deliverSummary(checkFailureReason(check), checkFailureDetail(check, language))
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
