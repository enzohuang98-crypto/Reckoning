import type {
  ExplainAttemptTrace,
  HarnessEvidence,
  HarnessRegressionCase,
  HarnessTrace
} from '@shared/types/Harness'
import type {
  EngineAnalysis,
  EngineCandidateMove,
  EngineScore
} from '@shared/types/EngineAnalysis'
import type {
  AICredentialDiagnostic,
  AICredentialErrorCategory,
  AICredentialTestStage,
  AIGenerationIncompleteReason
} from '@shared/types/AIProviderTypes'
import type { StorageService } from './StorageService'
import { MAX_APP_DATA_BYTES } from '../security/InputValidation'

export const HARNESS_TRACE_FILE = 'harness-traces.json'
const MAX_TRACES = 100
const MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000
/** 本機保存上限，避免 finalText（供未來評測用）讓 trace 檔案無限變大。 */
const MAX_FINAL_TEXT_CHARS = 12_000

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}
function sanitizeScore(value: unknown): EngineScore | null {
  if (!isRecord(value) || typeof value.type !== 'string') return null
  if (value.type === 'cp') {
    if (
      typeof value.cp !== 'number' ||
      typeof value.value !== 'number' ||
      typeof value.comparableValue !== 'number' ||
      typeof value.raw !== 'string' ||
      typeof value.displayText !== 'string' ||
      typeof value.wasInverted !== 'boolean' ||
      typeof value.source !== 'string'
    ) {
      return null
    }
    return {
      type: 'cp',
      cp: value.cp,
      value: value.value,
      comparableValue: value.comparableValue,
      raw: value.raw,
      displayText: value.displayText,
      wasInverted: value.wasInverted,
      source: value.source as
        | 'root_analysis'
        | 'candidate_move'
        | 'separate_engine_call'
    }
  }
  if (value.type === 'mate') {
    if (
      typeof value.mateIn !== 'number' ||
      typeof value.comparableValue !== 'number' ||
      typeof value.raw !== 'string' ||
      typeof value.displayText !== 'string' ||
      typeof value.isTerminalMate !== 'boolean' ||
      typeof value.wasInverted !== 'boolean' ||
      typeof value.source !== 'string'
    ) {
      return null
    }
    return {
      type: 'mate',
      mateIn: value.mateIn,
      comparableValue: value.comparableValue,
      raw: value.raw,
      displayText: value.displayText,
      isTerminalMate: value.isTerminalMate,
      wasInverted: value.wasInverted,
      source: value.source as 'root_analysis' | 'candidate_move' | 'separate_engine_call'
    }
  }
  return null
}

function sanitizeCandidateMove(value: unknown): EngineCandidateMove | null {
  if (!isRecord(value)) return null
  if (
    typeof value.move !== 'string' ||
    (value.displayMove !== undefined && typeof value.displayMove !== 'string') ||
    (value.score !== null && sanitizeScore(value.score) === null) ||
    typeof value.evaluation !== 'number' && value.evaluation !== null ||
    typeof value.depth !== 'number' && value.depth !== null ||
    !Array.isArray(value.principalVariation) ||
    !value.principalVariation.every((move) => typeof move === 'string')
  ) {
    return null
  }
  return {
    move: value.move,
    ...(value.displayMove !== undefined ? { displayMove: value.displayMove } : {}),
    score: value.score === null ? null : sanitizeScore(value.score),
    evaluation: value.evaluation as number | null,
    depth: value.depth as number | null,
    principalVariation: [...value.principalVariation] as string[],
    ...(Array.isArray(value.displayPrincipalVariation) &&
    value.displayPrincipalVariation.every((move) => typeof move === 'string')
      ? { displayPrincipalVariation: [...value.displayPrincipalVariation] as string[] }
      : {})
  }
}

function sanitizeAnalysis(value: unknown): EngineAnalysis | null {
  if (!isRecord(value)) return null
  if (
    typeof value.positionFen !== 'string' ||
    typeof value.sideToMove !== 'string' ||
    typeof value.bestMove !== 'string' ||
    typeof value.userMoveEvaluationSource !== 'string' ||
    !Array.isArray(value.candidateMoves) ||
    !Array.isArray(value.principalVariation) ||
    !value.principalVariation.every((move) => typeof move === 'string') ||
    typeof value.incomplete !== 'boolean' ||
    !Array.isArray(value.warnings) ||
    !value.warnings.every((warning) => typeof warning === 'string') ||
    typeof value.engineName !== 'string'
  ) {
    return null
  }
  const scoreAfterUserMove =
    value.scoreAfterUserMove === null ? null : sanitizeScore(value.scoreAfterUserMove)
  const scoreAfterBestMove =
    value.scoreAfterBestMove === null ? null : sanitizeScore(value.scoreAfterBestMove)
  if (
    (value.scoreAfterUserMove !== null && scoreAfterUserMove === null) ||
    (value.scoreAfterBestMove !== null && scoreAfterBestMove === null)
  ) {
    return null
  }
  const candidateMoves = value.candidateMoves
    .map(sanitizeCandidateMove)
    .filter((move): move is EngineCandidateMove => move !== null)
  return {
    positionFen: value.positionFen,
    sideToMove: value.sideToMove as EngineAnalysis['sideToMove'],
    ...(typeof value.userMove === 'string' ? { userMove: value.userMove } : {}),
    ...(typeof value.displayUserMove === 'string'
      ? { displayUserMove: value.displayUserMove }
      : {}),
    bestMove: value.bestMove,
    ...(typeof value.displayBestMove === 'string'
      ? { displayBestMove: value.displayBestMove }
      : {}),
    scoreAfterUserMove,
    scoreAfterBestMove,
    evaluationAfterUserMove:
      typeof value.evaluationAfterUserMove === 'number'
        ? value.evaluationAfterUserMove
        : null,
    evaluationAfterBestMove:
      typeof value.evaluationAfterBestMove === 'number'
        ? value.evaluationAfterBestMove
        : null,
    userMoveEvaluationSource:
      value.userMoveEvaluationSource as EngineAnalysis['userMoveEvaluationSource'],
    ...(Array.isArray(value.userMovePrincipalVariation) &&
    value.userMovePrincipalVariation.every((move) => typeof move === 'string')
      ? { userMovePrincipalVariation: [...value.userMovePrincipalVariation] as string[] }
      : {}),
    ...(Array.isArray(value.displayUserMovePrincipalVariation) &&
    value.displayUserMovePrincipalVariation.every((move) => typeof move === 'string')
      ? {
          displayUserMovePrincipalVariation: [
            ...value.displayUserMovePrincipalVariation
          ] as string[]
        }
      : {}),
    depth: typeof value.depth === 'number' ? value.depth : null,
    candidateMoves,
    principalVariation: [...value.principalVariation] as string[],
    ...(Array.isArray(value.displayPrincipalVariation) &&
    value.displayPrincipalVariation.every((move) => typeof move === 'string')
      ? { displayPrincipalVariation: [...value.displayPrincipalVariation] as string[] }
      : {}),
    ...(typeof value.analysisTimeMs === 'number'
      ? { analysisTimeMs: value.analysisTimeMs }
      : {}),
    incomplete: value.incomplete,
    warnings: [...value.warnings] as string[],
    ...(typeof value.engineId === 'string' ? { engineId: value.engineId } : {}),
    engineName: value.engineName
  }
}

function sanitizeEvidence(value: unknown): HarnessEvidence | null {
  if (!isRecord(value)) return null
  if (
    typeof value.id !== 'string' ||
    typeof value.engineId !== 'string' ||
    typeof value.engineName !== 'string' ||
    typeof value.purpose !== 'string' ||
    typeof value.positionFen !== 'string' ||
    (value.move !== undefined && typeof value.move !== 'string') ||
    (value.displayMove !== undefined && typeof value.displayMove !== 'string') ||
    (value.depth !== null && typeof value.depth !== 'number') ||
    !Array.isArray(value.displayPrincipalVariation) ||
    !value.displayPrincipalVariation.every((move) => typeof move === 'string')
  ) {
    return null
  }
  const analysis = sanitizeAnalysis(value.analysis)
  if (!analysis) return null
  return {
    id: value.id,
    engineId: value.engineId,
    engineName: value.engineName,
    purpose: value.purpose,
    positionFen: value.positionFen,
    ...(typeof value.move === 'string' ? { move: value.move } : {}),
    ...(typeof value.displayMove === 'string' ? { displayMove: value.displayMove } : {}),
    depth: value.depth as number | null,
    score: value.score === null ? null : sanitizeScore(value.score),
    displayPrincipalVariation: [...value.displayPrincipalVariation] as string[],
    analysis
  }
}

/** 連線錯誤代碼只接受大寫代碼格式（例如 ECONNRESET），避免把任何原文帶進紀錄。 */
function isNetworkCode(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Z][A-Z0-9_]{1,39}$/.test(value)
}

function sanitizeProviderDiagnostic(value: unknown): AICredentialDiagnostic | undefined {
  if (!isRecord(value)) return undefined
  const stages: AICredentialTestStage[] = ['key', 'catalog', 'generation', 'storage']
  const categories: AICredentialErrorCategory[] = [
    'invalid_request', 'authentication', 'permission', 'billing', 'model_unavailable',
    'rate_limited', 'provider_unavailable', 'timeout', 'network', 'response_format',
    'model_mismatch', 'generation_incomplete', 'storage', 'unknown'
  ]
  const reasons: AIGenerationIncompleteReason[] = ['empty_content', 'output_truncated']
  if (
    !stages.includes(value.stage as AICredentialTestStage) ||
    !categories.includes(value.category as AICredentialErrorCategory) ||
    typeof value.retryable !== 'boolean' ||
    typeof value.message !== 'string'
  ) return undefined
  return {
    stage: value.stage as AICredentialTestStage,
    category: value.category as AICredentialErrorCategory,
    ...(reasons.includes(value.reason as AIGenerationIncompleteReason)
      ? { reason: value.reason as AIGenerationIncompleteReason }
      : {}),
    ...(typeof value.httpStatus === 'number' ? { httpStatus: value.httpStatus } : {}),
    retryable: value.retryable,
    ...(typeof value.retryAfterMs === 'number' ? { retryAfterMs: value.retryAfterMs } : {}),
    ...(typeof value.finishReason === 'string'
      ? { finishReason: value.finishReason.slice(0, 64) }
      : {}),
    ...(typeof value.outputTokens === 'number' ? { outputTokens: value.outputTokens } : {}),
    ...(isNetworkCode(value.networkCode) ? { networkCode: value.networkCode } : {}),
    message: value.message.slice(0, 500)
  }
}

function sanitizeTrace(value: unknown): HarnessTrace | null {
  if (typeof value !== 'object' || value === null) return null
  const trace = value as HarnessTrace
  if (
    typeof trace.id !== 'string' ||
    typeof trace.createdAt !== 'string' ||
    typeof trace.positionFen !== 'string' ||
    !Array.isArray(trace.phases) ||
    !Array.isArray(trace.evidence) ||
    !Array.isArray(trace.validationErrors) ||
    (trace.mode !== 'focused' && trace.mode !== 'research') ||
    !['completed', 'clarification_required', 'cancelled', 'failed'].includes(trace.status)
  ) {
    return null
  }
  const evidence = trace.evidence
    .map(sanitizeEvidence)
    .filter((item): item is HarnessEvidence => item !== null)
  const feedback =
    trace.feedback === 'helpful' ||
    trace.feedback === 'unclear' ||
    trace.feedback === 'incorrect' ||
    trace.feedback === 'missing_evidence'
      ? trace.feedback
      : undefined
  return {
    id: trace.id,
    createdAt: trace.createdAt,
    ...(typeof trace.requestId === 'string' ? { requestId: trace.requestId } : {}),
    ...(typeof trace.analysisId === 'string' ? { analysisId: trace.analysisId } : {}),
    ...(trace.provider ? { provider: trace.provider } : {}),
    ...(typeof trace.model === 'string' ? { model: trace.model } : {}),
    ...(trace.language ? { language: trace.language } : {}),
    ...(typeof trace.historyMessageCount === 'number'
      ? { historyMessageCount: trace.historyMessageCount }
      : {}),
    ...(typeof trace.durationMs === 'number' ? { durationMs: trace.durationMs } : {}),
    positionFen: trace.positionFen,
    ...(typeof trace.question === 'string'
      ? { question: trace.question.slice(0, 4000) }
      : {}),
    ...(typeof trace.attachedMove === 'string' ? { attachedMove: trace.attachedMove } : {}),
    mode: trace.mode,
    primaryEngineId: trace.primaryEngineId,
    ...(typeof trace.verificationEngineId === 'string'
      ? { verificationEngineId: trace.verificationEngineId }
      : {}),
    phases: trace.phases
      .filter(
        (phase) =>
          isRecord(phase) &&
          typeof phase.phase === 'string' &&
          typeof phase.at === 'string' &&
          typeof phase.message === 'string'
      )
      .slice(-50)
      .map((phase) => ({
        phase: phase.phase as HarnessTrace['phases'][number]['phase'],
        at: phase.at,
        message: phase.message
      })),
    evidence,
    validationErrors: trace.validationErrors
      .filter((error): error is string => typeof error === 'string')
      .slice(-30),
    modelCalls: typeof trace.modelCalls === 'number' ? trace.modelCalls : 0,
    engineRounds: typeof trace.engineRounds === 'number' ? trace.engineRounds : 0,
    ...(trace.usage &&
    typeof trace.usage.inputTokens === 'number' &&
    typeof trace.usage.outputTokens === 'number'
      ? { usage: { ...trace.usage } }
      : {}),
    ...(sanitizeProviderDiagnostic(trace.providerDiagnostic)
      ? { providerDiagnostic: sanitizeProviderDiagnostic(trace.providerDiagnostic) }
      : {}),
    ...(feedback ? { feedback } : {}),
    ...(trace.interactionKind === 'ordinary'
      ? { interactionKind: trace.interactionKind }
      : {}),
    ...(trace.executionSemanticsVersion === 2
      ? { executionSemanticsVersion: 2 as const }
      : {}),
    status: trace.status,
    ...(typeof trace.finalText === 'string'
      ? { finalText: trace.finalText.slice(0, MAX_FINAL_TEXT_CHARS) }
      : {}),
    ...(trace.pipelineVersion === 2 ? { pipelineVersion: 2 as const } : {}),
    ...(trace.answerKind === 'ai' ||
    trace.answerKind === 'engine_summary' ||
    trace.answerKind === 'board_rule'
      ? { answerKind: trace.answerKind }
      : {}),
    ...(Array.isArray(trace.attempts)
      ? { attempts: trace.attempts.map(sanitizeAttempt).filter((item): item is ExplainAttemptTrace => item !== null).slice(0, 5) }
      : {}),
    ...(Array.isArray(trace.hardErrors)
      ? { hardErrors: trace.hardErrors.filter((item): item is string => typeof item === 'string').map((item) => item.slice(0, 300)).slice(0, 10) }
      : {}),
    ...(Array.isArray(trace.firstHardErrors)
      ? { firstHardErrors: trace.firstHardErrors.filter((item): item is string => typeof item === 'string').map((item) => item.slice(0, 300)).slice(0, 10) }
      : {}),
    ...(Array.isArray(trace.softWarnings)
      ? { softWarnings: trace.softWarnings.filter((item): item is string => typeof item === 'string').map((item) => item.slice(0, 300)).slice(0, 10) }
      : {})
  }
}

function sanitizeAttempt(value: unknown): ExplainAttemptTrace | null {
  if (!isRecord(value)) return null
  const kinds = ['primary', 'network_retry', 'rate_limit_retry', 'recovery', 'backup', 'repair']
  if (
    typeof value.model !== 'string' ||
    !kinds.includes(value.kind as string) ||
    typeof value.durationMs !== 'number'
  ) {
    return null
  }
  return {
    model: value.model.slice(0, 128),
    kind: value.kind as ExplainAttemptTrace['kind'],
    durationMs: value.durationMs,
    ...(typeof value.finishReason === 'string' ? { finishReason: value.finishReason.slice(0, 32) } : {}),
    ...(typeof value.outputTokens === 'number' ? { outputTokens: value.outputTokens } : {}),
    ...(typeof value.reasoningTokens === 'number' ? { reasoningTokens: value.reasoningTokens } : {}),
    ...(typeof value.error === 'string' ? { error: value.error.slice(0, 64) } : {}),
    ...(isNetworkCode(value.networkCode) ? { networkCode: value.networkCode } : {})
  }
}

/**
 * 本機解說診斷紀錄。所有讀寫都走非同步原子檔案操作（設計原則 §9），並以單一佇列依序執行：
 * 每次解說後的 save、使用者按回饋的 setFeedback、清除與匯出彼此不會互相覆蓋。
 */
export class HarnessTraceStore {
  private queue: Promise<unknown> = Promise.resolve()

  constructor(private readonly storage: StorageService) {}

  /** 依序執行；前一個操作失敗不會卡住後面的操作。 */
  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const run = this.queue.then(operation, operation)
    this.queue = run.catch(() => undefined)
    return run
  }

  private async readAll(): Promise<HarnessTrace[]> {
    const cutoff = Date.now() - MAX_AGE_MS
    const stored = await this.storage.readAsync<unknown>(
      HARNESS_TRACE_FILE,
      [],
      MAX_APP_DATA_BYTES
    )
    if (!Array.isArray(stored)) return []
    return stored
      .map(sanitizeTrace)
      .filter(
        (trace): trace is HarnessTrace =>
          trace !== null && Date.parse(trace.createdAt) >= cutoff
      )
      .slice(0, MAX_TRACES)
  }

  private writeAll(traces: HarnessTrace[]): Promise<void> {
    return this.storage.writeAsync(HARNESS_TRACE_FILE, traces, MAX_APP_DATA_BYTES)
  }

  list(): Promise<HarnessTrace[]> {
    return this.enqueue(() => this.readAll())
  }

  save(trace: HarnessTrace): Promise<void> {
    const sanitized = sanitizeTrace(trace)
    if (!sanitized) return Promise.reject(new Error('Harness trace 格式無效。'))
    return this.enqueue(async () => {
      const existing = await this.readAll()
      await this.writeAll(
        [sanitized, ...existing.filter((item) => item.id !== trace.id)].slice(0, MAX_TRACES)
      )
    })
  }

  /** Export uses the same positive allowlist as storage, never arbitrary JSON fields. */
  async listForExport(): Promise<HarnessTrace[]> {
    return (await this.list())
      .map(sanitizeTrace)
      .filter((trace): trace is HarnessTrace => trace !== null)
  }

  clear(): Promise<void> {
    return this.enqueue(() => this.writeAll([]))
  }

  setFeedback(
    traceId: string,
    feedback: NonNullable<HarnessTrace['feedback']>
  ): Promise<void> {
    return this.enqueue(async () => {
      const existing = await this.readAll()
      await this.writeAll(
        existing.map((trace) => (trace.id === traceId ? { ...trace, feedback } : trace))
      )
    })
  }

  /**
   * 使用者標記「不清楚／不正確／證據不足」的 trace 轉為自包含回歸案例：
   * 匯出後可直接加入 tests/fixtures 的回歸評測集，
   * 用 screenExplanationText 驗證未來版本不再產出同類問題。
   */
  async listRegressionCases(): Promise<HarnessRegressionCase[]> {
    return (await this.list())
      .filter((trace) => trace.feedback !== undefined && trace.feedback !== 'helpful')
      .map((trace) => ({
        traceId: trace.id,
        createdAt: trace.createdAt,
        positionFen: trace.positionFen,
        question: trace.question,
        attachedMove: trace.attachedMove,
        feedback: trace.feedback as NonNullable<HarnessTrace['feedback']>,
        finalText: trace.finalText,
        validationErrors: trace.validationErrors,
        availableMoves: [
          ...new Set(
            trace.evidence.flatMap((item) => [
              ...item.displayPrincipalVariation,
              ...(item.analysis?.displayPrincipalVariation ?? []),
              ...(item.analysis?.displayUserMovePrincipalVariation ?? [])
            ])
          )
        ].filter(Boolean)
      }))
  }
}
