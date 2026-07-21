import type { EngineAnalysis, EngineScore } from './EngineAnalysis'
import type { AIProviderId, TokenUsage } from './AIProviderTypes'
import type { ExplanationLanguage } from './AIExplanationTypes'

export type HarnessAnswerMode = 'focused' | 'research'

/**
 * Stable machine-readable section identifiers. Display headings may be
 * translated or reworded without changing validation or repair routing.
 */
export const HARNESS_SECTION_IDS = {
  directConclusion: 'direct_conclusion',
  actualMoveProblem: 'actual_move_problem',
  bestMovePlan: 'best_move_plan',
  opponentExploitation: 'opponent_exploitation',
  practicalPrinciple: 'practical_principle',
  dualEngineAdjudication: 'dual_engine_adjudication',
  followUp: 'follow_up'
} as const

export type HarnessSectionId =
  (typeof HARNESS_SECTION_IDS)[keyof typeof HARNESS_SECTION_IDS]

/**
 * 棋手明確選取實戰步後，完整一鍵解說唯一允許的五個玩家可見區塊。
 * 順序本身也是產品契約，驗證與 render 不得自行增加第六區。
 */
export const INITIAL_MOVE_EXPLANATION_SECTION_IDS = [
  HARNESS_SECTION_IDS.directConclusion,
  HARNESS_SECTION_IDS.actualMoveProblem,
  HARNESS_SECTION_IDS.bestMovePlan,
  HARNESS_SECTION_IDS.opponentExploitation,
  HARNESS_SECTION_IDS.practicalPrinciple
] as const satisfies readonly HarnessSectionId[]

/** 約 500–900 個中文字為寫作目標；400 個漢字是防止短答混過驗證的安全下限。 */
export const INITIAL_MOVE_EXPLANATION_MIN_HAN_CHARACTERS = 400

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

export interface HarnessBudget {
  engineTimeMs: number
  maxEngineRounds: number
  maxModelCalls: number
  maxOutputTokens: number
}

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
  verifiedConsequenceCount?: number
  awaitingDecision?: boolean
}

/**
 * 因果鏈：核心主張必須完整交代五段結構，
 * 品質評分器逐段驗證具體性，缺一段即退回重寫。
 */
export interface CausalChain {
  /** 原因：因為哪一步（必須逐字含主線中文著法） */
  cause: string
  /** 機制：造成什麼棋理或盤面變化 */
  mechanism: string
  /** 受影響對象：哪個棋子、線路、王區、陣形或威脅 */
  affected: string
  /** 對手利用：對手下一步如何利用 */
  opponentUse: string
  /** 後果：後續具體變差在哪裡 */
  consequence: string
}

export interface HarnessClaim {
  id: string
  text: string
  evidenceIds: string[]
  /** 直接連到已通過具體後果審查的 K 編號，讓系統可確定性驗證寫作者沒有另造結論。 */
  findingIds?: string[]
  /** 核心區塊（錯失／對手利用／後果／比較）的 claim 必須附完整因果鏈。 */
  causal?: CausalChain
}

export interface HarnessSection {
  /** Stable validation/repair key; never derive behavior from heading text. */
  id: HarnessSectionId
  /** User-facing localized label. */
  heading: string
  claims: HarnessClaim[]
}

export interface HarnessAnswer {
  mode: HarnessAnswerMode
  title: string
  directAnswer: string
  directAnswerEvidenceIds: string[]
  sections: HarnessSection[]
  /** 一般棋理補充：未經引擎驗證的教練常識，必須與引擎結論分開顯示，不得引用證據編號。 */
  generalNotes?: string[]
  evidence: HarnessEvidence[]
  warnings: string[]
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
  feedback?: 'helpful' | 'unclear' | 'incorrect' | 'missing_evidence'
  status: 'completed' | 'clarification_required' | 'cancelled' | 'failed'
  /** 最終顯示給使用者的文字（供未來建立回歸評測集用）；儲存時會截斷長度。 */
  finalText?: string
}
