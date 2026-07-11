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
    crossEngineEnabled:
      typeof candidate.crossEngineEnabled === 'boolean'
        ? candidate.crossEngineEnabled
        : fallback.crossEngineEnabled,
    harnessAnswerMode:
      candidate.harnessAnswerMode === 'focused' ||
      candidate.harnessAnswerMode === 'research'
        ? candidate.harnessAnswerMode
        : fallback.harnessAnswerMode,
    harnessAutoRun:
      typeof candidate.harnessAutoRun === 'boolean'
        ? candidate.harnessAutoRun
        : fallback.harnessAutoRun,
    harnessReuseEvidence:
      typeof candidate.harnessReuseEvidence === 'boolean'
        ? candidate.harnessReuseEvidence
        : fallback.harnessReuseEvidence,
    harnessEngineTimeMs: clampInteger(
      candidate.harnessEngineTimeMs,
      20_000,
      60_000,
      fallback.harnessEngineTimeMs
    ),
    harnessMaxEngineRounds: clampInteger(
      candidate.harnessMaxEngineRounds,
      1,
      10,
      fallback.harnessMaxEngineRounds
    ),
    harnessResearchMaxModelCalls: clampInteger(
      candidate.harnessResearchMaxModelCalls,
      3,
      10,
      fallback.harnessResearchMaxModelCalls
    ),
    harnessResearchMaxOutputTokens: clampInteger(
      candidate.harnessResearchMaxOutputTokens,
      500,
      20_000,
      fallback.harnessResearchMaxOutputTokens
    ),
    harnessFocusedMaxModelCalls: clampInteger(
      candidate.harnessFocusedMaxModelCalls,
      3,
      10,
      fallback.harnessFocusedMaxModelCalls
    ),
    harnessFocusedMaxOutputTokens: clampInteger(
      candidate.harnessFocusedMaxOutputTokens,
      500,
      20_000,
      fallback.harnessFocusedMaxOutputTokens
    ),
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
