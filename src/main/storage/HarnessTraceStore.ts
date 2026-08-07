import type {
  HarnessEvidence,
  HarnessRegressionCase,
  HarnessTrace
} from '@shared/types/Harness'
import type {
  EngineAnalysis,
  EngineCandidateMove,
  EngineScore
} from '@shared/types/EngineAnalysis'
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

function sanitizeEvaluation(value: unknown): HarnessTrace['evaluation'] | undefined {
  if (!isRecord(value)) return undefined
  if (
    value.schemaVersion !== 1 ||
    typeof value.testRunId !== 'string' ||
    typeof value.testCaseId !== 'string' ||
    value.canonicalizationVersion !== 1 ||
    typeof value.externalReviewId !== 'string'
  ) {
    return undefined
  }
  return {
    schemaVersion: 1,
    testRunId: value.testRunId,
    testCaseId: value.testCaseId,
    canonicalizationVersion: 1,
    externalReviewId: value.externalReviewId
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
    ...(feedback ? { feedback } : {}),
    ...(sanitizeEvaluation(trace.evaluation)
      ? { evaluation: sanitizeEvaluation(trace.evaluation) }
      : {}),
    ...(trace.interactionKind === 'ordinary' ||
    trace.interactionKind === 'teacher-prelude' ||
    trace.interactionKind === 'teacher-formal-case'
      ? { interactionKind: trace.interactionKind }
      : {}),
    ...(trace.executionSemanticsVersion === 2
      ? { executionSemanticsVersion: 2 as const }
      : {}),
    ...(trace.teacherCaseSetId === 'teacher-test-cases-v1'
      ? { teacherCaseSetId: trace.teacherCaseSetId }
      : {}),
    ...(typeof trace.teacherCaseKey === 'string'
      ? { teacherCaseKey: trace.teacherCaseKey.slice(0, 128) }
      : {}),
    status: trace.status,
    ...(typeof trace.finalText === 'string'
      ? { finalText: trace.finalText.slice(0, MAX_FINAL_TEXT_CHARS) }
      : {})
  }
}

export class HarnessTraceStore {
  constructor(private readonly storage: StorageService) {}

  list(): HarnessTrace[] {
    const cutoff = Date.now() - MAX_AGE_MS
    const stored = this.storage.read<unknown>(
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

  save(trace: HarnessTrace): void {
    const sanitized = sanitizeTrace(trace)
    if (!sanitized) throw new Error('Harness trace 格式無效。')
    this.storage.write(
      HARNESS_TRACE_FILE,
      [sanitized, ...this.list().filter((item) => item.id !== trace.id)].slice(
        0,
        MAX_TRACES
      ),
      MAX_APP_DATA_BYTES
    )
  }

  /** Export uses the same positive allowlist as storage, never arbitrary JSON fields. */
  listForExport(testRunId?: string): HarnessTrace[] {
    return this.list()
      .filter((trace) => testRunId === undefined || trace.evaluation?.testRunId === testRunId)
      .map(sanitizeTrace)
      .filter((trace): trace is HarnessTrace => trace !== null)
  }

  clear(): void {
    this.storage.write(HARNESS_TRACE_FILE, [], MAX_APP_DATA_BYTES)
  }

  setFeedback(
    traceId: string,
    feedback: NonNullable<HarnessTrace['feedback']>
  ): void {
    this.storage.write(
      HARNESS_TRACE_FILE,
      this.list().map((trace) =>
        trace.id === traceId ? { ...trace, feedback } : trace
      ),
      MAX_APP_DATA_BYTES
    )
  }

  /**
   * 使用者標記「不清楚／不正確／證據不足」的 trace 轉為自包含回歸案例：
   * 匯出後可直接加入 tests/fixtures 的回歸評測集，
   * 用 screenExplanationText 驗證未來版本不再產出同類問題。
   */
  listRegressionCases(testRunId?: string): HarnessRegressionCase[] {
    return this.list()
      .filter(
        (trace) =>
          (testRunId === undefined || trace.evaluation?.testRunId === testRunId) &&
          trace.feedback !== undefined &&
          trace.feedback !== 'helpful'
      )
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
