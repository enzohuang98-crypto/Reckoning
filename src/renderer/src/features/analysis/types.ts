export type AnalysisView = 'live' | 'coach' | 'guess' | 'details'

/**
 * 棋譜上被明確點擊的實戰著法。positionFen 永遠是走這一步之前的局面，
 * selectionId 用來區分連續點擊並取消上一個引擎／AI 工作。
 */
export interface ActualMoveSelection {
  selectionId: string
  positionFen: string
  move: string
  displayMove: string
  plyIndex: number
  selectedAt: number
}

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
