import type { EngineAnalysis } from '@shared/types/EngineAnalysis'

export const AUTO_INITIAL_ANALYSIS_MAX_MS = 1_100
export const AUTO_USER_MOVE_ANALYSIS_MAX_MS = 400
export const LIVE_REFINEMENT_ANALYSIS_MIN_MS = 15_000
export const ACTUAL_MOVE_ENGINE_DEADLINE_MS = 3_000
export const ONE_CLICK_EXPLANATION_DEADLINE_MS = 30_000

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

export function remainingOneClickDeadlineMs(
  selectedAt: number,
  now = Date.now()
): number {
  const elapsed = Math.max(0, now - selectedAt)
  return Math.max(1, ONE_CLICK_EXPLANATION_DEADLINE_MS - elapsed)
}

export function remainingActualMoveEngineDeadlineMs(
  selectedAt: number,
  now = Date.now()
): number {
  const elapsed = Math.max(0, now - selectedAt)
  return Math.max(1, ACTUAL_MOVE_ENGINE_DEADLINE_MS - elapsed)
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
