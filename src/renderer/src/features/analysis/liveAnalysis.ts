import type { EngineAnalysis } from '@shared/types/EngineAnalysis'

export const AUTO_INITIAL_ANALYSIS_MAX_MS = 1_500
export const AUTO_USER_MOVE_ANALYSIS_MAX_MS = 700
export const LIVE_REFINEMENT_ANALYSIS_MIN_MS = 15_000

export interface LiveAnalysisScheduleState {
  livePaused: boolean
  visible: boolean
  engineAvailable: boolean
  boardValid: boolean
  analysisBusy: boolean
}

export function isSameAnalysisTarget(
  analysis: Pick<EngineAnalysis, 'positionFen' | 'userMove'> | null,
  positionFen: string,
  userMove: string
): boolean {
  return Boolean(
    analysis &&
      analysis.positionFen === positionFen &&
      (analysis.userMove ?? '') === userMove
  )
}

export function automaticRootMovetimeMs(
  configuredMs: number,
  refinement: boolean
): number {
  return refinement
    ? Math.max(configuredMs, LIVE_REFINEMENT_ANALYSIS_MIN_MS)
    : Math.min(configuredMs, AUTO_INITIAL_ANALYSIS_MAX_MS)
}

export function automaticUserMoveMovetimeMs(configuredMs: number): number {
  return Math.min(configuredMs, AUTO_USER_MOVE_ANALYSIS_MAX_MS)
}

export function canScheduleLiveAnalysis({
  livePaused,
  visible,
  engineAvailable,
  boardValid,
  analysisBusy
}: LiveAnalysisScheduleState): boolean {
  return !livePaused && visible && engineAvailable && boardValid && !analysisBusy
}

export function liveAnalysisRetryDelayMs(consecutiveFailures: number): number {
  if (consecutiveFailures <= 0) return 0
  return Math.min(5_000, 1_000 * 2 ** (consecutiveFailures - 1))
}
