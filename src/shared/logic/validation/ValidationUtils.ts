import { ALL_PROVIDER_IDS, type AIProviderId } from '../../types/AIProviderTypes'
import type { BoardState, FenValidationResult } from '../../types/BoardState'
import { DEFAULT_SETTINGS, FIXED_ANALYSIS_SETTINGS, type AppSettings } from '../../types/Settings'
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

export function normalizeSettings(value: unknown, fallback: AppSettings): AppSettings {
  if (typeof value !== 'object' || value === null) return { ...fallback, ...FIXED_ANALYSIS_SETTINGS, version: DEFAULT_SETTINGS.version }
  const candidate = { ...fallback, ...(value as Partial<AppSettings>) }
  const aiProvider = ALL_PROVIDER_IDS.includes(candidate.aiProvider)
    ? candidate.aiProvider
    : fallback.aiProvider
  return {
    ...fallback,
    aiProvider,
    aiModel:
      typeof candidate.aiModel === 'string' && candidate.aiModel.trim()
        ? candidate.aiModel.trim()
        : fallback.aiModel,
    aiBaseUrl:
      typeof candidate.aiBaseUrl === 'string'
        ? candidate.aiBaseUrl.trim().slice(0, 2048)
        : fallback.aiBaseUrl,
    userLevel: ['basic', 'intermediate', 'advanced'].includes(candidate.userLevel)
      ? candidate.userLevel : fallback.userLevel,
    language: ['zh-TW', 'zh-CN', 'en'].includes(candidate.language)
      ? candidate.language : fallback.language,
    ...FIXED_ANALYSIS_SETTINGS,
    version: DEFAULT_SETTINGS.version
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
