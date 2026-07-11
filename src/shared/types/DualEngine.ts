import type { EngineScore } from './EngineAnalysis'

export type DualEngineComparisonStatus =
  | 'agreement'
  | 'disagreement'
  | 'insufficient'

export interface DualEngineDisagreementReason {
  code: 'best_move' | 'score_sign' | 'score_gap' | 'missing_score'
  message: string
}

export interface EngineMoveView {
  engineId: string
  engineName: string
  rank: number | null
  score: EngineScore | null
  displayPrincipalVariation: string[]
}

export interface VariationPlyFact {
  ply: number
  move: string
  displayMove: string
  side: 'red' | 'black'
  piece: string
  capturedPiece?: string
  givesCheck: boolean
  destinationZone: string
  terms: string[]
}

export interface HumanControlIndicators {
  legalPlies: number
  forcingPlies: number
  captures: number
  checks: number
  nearBestAlternatives: number | null
  crossEngineSupport: number
  precisionDemand: 'lower' | 'medium' | 'higher' | 'unknown'
  summary: string
}

export interface DualEngineMoveAssessment {
  move: string
  displayMove: string
  proposedBy: string[]
  engineViews: EngineMoveView[]
  lineFacts: VariationPlyFact[]
  humanControl: HumanControlIndicators
}

export interface DualEngineComparison {
  status: DualEngineComparisonStatus
  primaryEngineName: string
  verificationEngineName: string
  reasons: DualEngineDisagreementReason[]
  candidateLines: DualEngineMoveAssessment[]
  /** 給 AI 的硬限制；不代表系統已替使用者選出答案。 */
  adjudicationRules: string[]
}
