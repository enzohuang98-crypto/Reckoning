import type { EngineAnalysis, EngineScore } from './EngineAnalysis'
import type { TokenUsage } from './AIProviderTypes'

export type HarnessAnswerMode = 'focused' | 'research'
export type HarnessPhase =
  | 'understanding'
  | 'planning'
  | 'engine_research'
  | 'cross_verification'
  | 'consequence_review'
  | 'waiting_for_user'
  | 'writing'
  | 'validating'
  | 'repairing'
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

export interface HarnessClaim {
  id: string
  text: string
  evidenceIds: string[]
}

export interface HarnessAnswer {
  mode: HarnessAnswerMode
  title: string
  directAnswer: string
  directAnswerEvidenceIds: string[]
  sections: Array<{ heading: string; claims: HarnessClaim[] }>
  evidence: HarnessEvidence[]
  warnings: string[]
}

export interface HarnessTrace {
  id: string
  createdAt: string
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
}
