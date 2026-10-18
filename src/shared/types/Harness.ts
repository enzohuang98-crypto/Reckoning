import type { EngineAnalysis, EngineScore } from './EngineAnalysis'
import type {
  AICredentialDiagnostic,
  AIProviderId,
  TokenUsage
} from './AIProviderTypes'
import type { ExplanationLanguage } from './AIExplanationTypes'

export type HarnessAnswerMode = 'focused' | 'research'

/** v2 起只剩一般互動；保留此欄位讓 trace 格式與舊紀錄相容（老師測試已於 P4-5 移除）。 */
export type ExplanationInteractionKind = 'ordinary'

export type ExplanationAnswerStrategy =
  | 'position-explanation'
  | 'move-comparison'
  | 'conversation-follow-up'

export const EXPLANATION_EXECUTION_SEMANTICS_VERSION = 2 as const

/** 進度與診斷紀錄的階段；部分值只出現在 v1 Harness（已刪除）留下的舊診斷紀錄。 */
export type HarnessPhase =
  | 'understanding'
  | 'planning'
  | 'engine_research'
  | 'cross_verification'
  | 'consequence_review'
  | 'waiting_for_user'
  | 'writing'
  | 'validating'
  | 'quality_check'
  | 'repairing'
  | 'provider_retry'
  | 'completed'

export interface HarnessEvidence {
  id: string
  engineId: string
  engineName: string
  purpose: string
  positionFen: string
  move?: string
  displayMove?: string
  depth: number | null
  score: EngineScore | null
  displayPrincipalVariation: string[]
  analysis: EngineAnalysis
}

export interface HarnessProgressPayload {
  requestId: string
  phase: HarnessPhase
  message: string
  modelCallsUsed: number
  engineRoundsUsed: number
  evidenceCount: number
  elapsedMs?: number
  depth?: number | null
  displayPrincipalVariation?: string[]
}

export interface HarnessTrace {
  id: string
  createdAt: string
  requestId?: string
  analysisId?: string
  provider?: AIProviderId
  model?: string
  language?: ExplanationLanguage
  historyMessageCount?: number
  durationMs?: number
  positionFen: string
  question?: string
  attachedMove?: string
  mode: HarnessAnswerMode
  primaryEngineId: string
  verificationEngineId?: string
  phases: Array<{ phase: HarnessPhase; at: string; message: string }>
  evidence: HarnessEvidence[]
  validationErrors: string[]
  modelCalls: number
  engineRounds: number
  usage?: TokenUsage
  providerDiagnostic?: AICredentialDiagnostic
  feedback?: 'helpful' | 'unclear' | 'incorrect' | 'missing_evidence'
  /** v2 起由 main-process prepared execution 明確指定；舊 trace 不得反推。 */
  interactionKind?: ExplanationInteractionKind
  executionSemanticsVersion?: typeof EXPLANATION_EXECUTION_SEMANTICS_VERSION
  status: 'completed' | 'clarification_required' | 'cancelled' | 'failed'
  /** 最終顯示給使用者的文字（供未來建立回歸評測集用）；儲存時會截斷長度。 */
  finalText?: string
  /** v2 解說管線才有；舊 trace 視為 v1。 */
  pipelineVersion?: 2
  answerKind?: ExplanationAnswerKind
  attempts?: ExplainAttemptTrace[]
  hardErrors?: string[]
  /** 有修正時，修正前那一輪的硬錯（hardErrors 是最後一輪的）。 */
  firstHardErrors?: string[]
  softWarnings?: string[]
}

/** v2 交付種類：AI 回答、引擎重點摘要（非 AI）、或棋規捷徑。 */
export type ExplanationAnswerKind = 'ai' | 'engine_summary' | 'board_rule'

/** v2 每一次模型呼叫的紀錄（不含 prompt 或回答原文）。 */
export interface ExplainAttemptTrace {
  model: string
  kind: 'primary' | 'network_retry' | 'rate_limit_retry' | 'unavailable_retry' | 'recovery' | 'backup' | 'repair'
  durationMs: number
  finishReason?: string
  outputTokens?: number
  reasoningTokens?: number
  /** 失敗時的分類（例如 rate_limited、timeout）；不含服務原文。 */
  error?: string
  /** network 失敗時的底層連線錯誤代碼（例如 ECONNRESET）。 */
  networkCode?: string
}

/** 「匯出診斷紀錄」的檔案格式。 */
export interface HarnessTraceExportV1 {
  schemaVersion: 1
  exportedAt: string
  traces: HarnessTrace[]
  regressionCases: HarnessRegressionCase[]
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
