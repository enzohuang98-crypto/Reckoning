import { ALL_PROVIDER_IDS, type AIProviderId } from '../types/AIProviderTypes'
import type { BoardState, FenValidationResult } from '../types/BoardState'
import type { AppSettings } from '../types/Settings'
import { parseFen } from './fen'
import { legalMoveCheck, type MoveCheckResult } from './moves'

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

export function normalizeSettings(value: unknown, fallback: AppSettings): AppSettings {
  if (typeof value !== 'object' || value === null) return fallback
  const candidate = { ...fallback, ...(value as Partial<AppSettings>) }
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
    multiPv: clampInteger(candidate.multiPv, 1, 5, fallback.multiPv)
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
