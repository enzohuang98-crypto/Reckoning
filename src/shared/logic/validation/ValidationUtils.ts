import { ALL_PROVIDER_IDS, type AIProviderId } from '../../types/AIProviderTypes'
import type { BoardState, FenValidationResult } from '../../types/BoardState'
import type { AppSettings } from '../../types/Settings'
import { parseFen } from '../board/fen'
import { legalMoveCheck, type MoveCheckResult } from '../board/moves'

export interface ModelConfigLike {
  provider: AIProviderId
  model: string
  displayName: string
}

export function validateFenInput(fen: string): FenValidationResult {
  return parseFen(fen.trim())
}

export function validateMoveInput(board: BoardState, move: string): MoveCheckResult {
  return legalMoveCheck(board.grid, board.sideToMove, move.trim().toLowerCase())
}

function clampInteger(value: unknown, min: number, max: number, fallback: number): number {
  return typeof value === 'number' && Number.isSafeInteger(value)
    ? Math.min(max, Math.max(min, value))
    : fallback
}

/**
 * v5 移除的設定：v4 以前可由使用者調整的 Harness 參數（改由 main 固定），
 * 以及已移除的雙引擎複核開關。讀到舊設定時一律丟棄。
 */
export const REMOVED_SETTING_KEYS = [
  'crossEngineEnabled',
  'harnessAnswerMode',
  'harnessAutoRun',
  'harnessReuseEvidence',
  'harnessEngineTimeMs',
  'harnessMaxEngineRounds',
  'harnessResearchMaxModelCalls',
  'harnessResearchMaxOutputTokens',
  'harnessFocusedMaxModelCalls',
  'harnessFocusedMaxOutputTokens'
] as const

export function normalizeSettings(value: unknown, fallback: AppSettings): AppSettings {
  if (typeof value !== 'object' || value === null) return fallback
  const candidate: Record<string, unknown> & AppSettings = {
    ...fallback,
    ...(value as Partial<AppSettings>)
  }
  for (const key of REMOVED_SETTING_KEYS) delete candidate[key]
  const aiProvider = ALL_PROVIDER_IDS.includes(candidate.aiProvider)
    ? candidate.aiProvider
    : fallback.aiProvider
  return {
    ...candidate,
    aiProvider,
    aiModel:
      typeof candidate.aiModel === 'string' && candidate.aiModel.trim()
        ? candidate.aiModel.trim()
        : fallback.aiModel,
    aiBaseUrl:
      typeof candidate.aiBaseUrl === 'string'
        ? candidate.aiBaseUrl.trim().slice(0, 2048)
        : fallback.aiBaseUrl,
    rootAnalysisMovetimeMs: clampInteger(
      candidate.rootAnalysisMovetimeMs,
      1_000,
      10_000,
      fallback.rootAnalysisMovetimeMs
    ),
    userMoveEvalMovetimeMs: clampInteger(
      candidate.userMoveEvalMovetimeMs,
      500,
      3_000,
      fallback.userMoveEvalMovetimeMs
    ),
    multiPv: clampInteger(candidate.multiPv, 1, 5, fallback.multiPv),
    version: fallback.version
  }
}

export function isValidModelConfig(value: unknown): value is ModelConfigLike {
  if (typeof value !== 'object' || value === null) return false
  const candidate = value as Partial<ModelConfigLike>
  return (
    ALL_PROVIDER_IDS.includes(candidate.provider as AIProviderId) &&
    typeof candidate.model === 'string' &&
    candidate.model.trim().length > 0 &&
    typeof candidate.displayName === 'string' &&
    candidate.displayName.trim().length > 0
  )
}
