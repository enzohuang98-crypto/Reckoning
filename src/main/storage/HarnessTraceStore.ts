import type { HarnessTrace } from '@shared/types/Harness'
import type { StorageService } from './StorageService'
import { MAX_APP_DATA_BYTES } from '../security/InputValidation'

export const HARNESS_TRACE_FILE = 'harness-traces.json'
const MAX_TRACES = 100
const MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000
/** 本機保存上限，避免 finalText（供未來評測用）讓 trace 檔案無限變大。 */
const MAX_FINAL_TEXT_CHARS = 12_000

function sanitizeTrace(value: unknown): HarnessTrace | null {
  if (typeof value !== 'object' || value === null) return null
  const trace = value as HarnessTrace
  if (
    typeof trace.id !== 'string' ||
    typeof trace.createdAt !== 'string' ||
    typeof trace.positionFen !== 'string' ||
    !Array.isArray(trace.phases) ||
    !Array.isArray(trace.evidence) ||
    !Array.isArray(trace.validationErrors)
  ) {
    return null
  }
  return trace
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
    const sanitized: HarnessTrace = {
      ...trace,
      question: trace.question?.slice(0, 4000),
      finalText: trace.finalText?.slice(0, MAX_FINAL_TEXT_CHARS),
      phases: trace.phases.slice(-50),
      validationErrors: trace.validationErrors.slice(-30),
      evidence: trace.evidence.map((item) => ({
        ...item,
        analysis: { ...item.analysis, rawAnalysis: undefined }
      }))
    }
    this.storage.write(
      HARNESS_TRACE_FILE,
      [sanitized, ...this.list().filter((item) => item.id !== trace.id)].slice(
        0,
        MAX_TRACES
      ),
      MAX_APP_DATA_BYTES
    )
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
  listRegressionCases(): HarnessRegressionCase[] {
    return this.list()
      .filter(
        (trace) => trace.feedback !== undefined && trace.feedback !== 'helpful'
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

/** 自包含回歸案例：不依賴本機 trace 也能重放品質檢查。 */
export interface HarnessRegressionCase {
  traceId: string
  createdAt: string
  positionFen: string
  question?: string
  attachedMove?: string
  feedback: NonNullable<HarnessTrace['feedback']>
  finalText?: string
  validationErrors: string[]
  availableMoves: string[]
}
