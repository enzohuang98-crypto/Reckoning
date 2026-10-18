import type { BoardState } from '@shared/types/BoardState'
import type { EngineAnalysis } from '@shared/types/EngineAnalysis'

export const AUTO_INITIAL_ANALYSIS_MAX_MS = 1_100
export const AUTO_USER_MOVE_ANALYSIS_MAX_MS = 400
export const LIVE_REFINEMENT_ANALYSIS_MIN_MS = 15_000
/** 實戰步引擎比較截止；慢機或首次載入 NNUE 時 3 秒不夠，放寬到 8 秒。 */
export const ACTUAL_MOVE_ENGINE_DEADLINE_MS = 8_000
/** 所有 AI 請求的 renderer 硬截止；main 端 Harness 總截止（110 秒）必須早於它。 */
export const AI_REQUEST_DEADLINE_MS = 120_000

/** 已完成結果達此深度時，追問可直接使用它，不必等背景 live 精煉跑完。 */
export const MIN_EXPLAIN_DEPTH = 14

export interface LiveAnalysisScheduleState {
  livePaused: boolean
  visible: boolean
  engineAvailable: boolean
  boardValid: boolean
  analysisBusy: boolean
}

/** 棋盤要同時有紅帥與黑將，引擎才能分析。 */
export function hasBothKings(board: BoardState): boolean {
  let red = false
  let black = false
  for (const row of board.grid) {
    for (const piece of row) {
      if (piece?.type !== 'king') continue
      if (piece.color === 'red') red = true
      else black = true
    }
  }
  return red && black
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

/**
 * 引擎仍在背景精煉時，若目前已完成的結果就是同一局面、同一著法，且深度足夠、
 * 非未完成結果，就可以立刻拿它回答，而不是讓每則追問多等一輪精煉。
 */
export function canExplainWithCompletedResult(
  analysis:
    | Pick<EngineAnalysis, 'positionFen' | 'userMove' | 'depth' | 'incomplete'>
    | null
    | undefined,
  positionFen: string,
  userMove: string
): boolean {
  return Boolean(
    analysis &&
      isSameAnalysisTarget(analysis, positionFen, userMove) &&
      !analysis.incomplete &&
      typeof analysis.depth === 'number' &&
      analysis.depth >= MIN_EXPLAIN_DEPTH
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
  return Math.max(1, AI_REQUEST_DEADLINE_MS - elapsed)
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
