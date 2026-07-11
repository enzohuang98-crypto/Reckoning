export type AnalysisView = 'live' | 'coach' | 'guess' | 'details'

export interface AnalysisPanelStatus {
  canAnalyze: boolean
  analysisBusy: boolean
  analysisCancelling: boolean
  aiBusy: boolean
  aiCancelling: boolean
  hasExplanation: boolean
  hasResult: boolean
  analysisBlockedReason: string | null
  aiBlockedReason: string | null
}

export const EMPTY_ANALYSIS_STATUS: AnalysisPanelStatus = {
  canAnalyze: false,
  analysisBusy: false,
  analysisCancelling: false,
  aiBusy: false,
  aiCancelling: false,
  hasExplanation: false,
  hasResult: false,
  analysisBlockedReason: null,
  aiBlockedReason: null
}

export interface AnalysisPanelHandle {
  requestExplanation: () => void
  startAnalysis: () => void
  cancelAnalysis: () => void
  cancelExplain: () => void
  stopAll: () => void
}
