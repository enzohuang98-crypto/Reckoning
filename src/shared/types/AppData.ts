import type { EngineAnalysis } from './EngineAnalysis'
import type { MistakeBookEntry } from './MistakeBookEntry'
import type { MoveComparisonResult } from './MoveComparisonResult'
import type { UserGuess } from './UserGuess'
import {
  ALL_PROVIDER_IDS,
  type AIProviderId
} from './AIProviderTypes'

export const APP_DATA_SCHEMA_VERSION = 1

export interface SavedPosition {
  id: string
  name: string
  fen: string
  createdAt: string
  updatedAt: string
}

export interface ConversationMessage {
  id: string
  role: 'user' | 'assistant'
  text: string
  createdAt: string
  provider?: AIProviderId
  model?: string
}

export interface AIConversation {
  id: string
  analysisId: string
  positionFen: string
  createdAt: string
  updatedAt: string
  messages: ConversationMessage[]
}

export interface MisunderstoodPosition {
  id: string
  positionFen: string
  reason: string
  createdAt: string
  updatedAt: string
  analysisId?: string
  engineAnalysis?: EngineAnalysis
  moveComparison?: MoveComparisonResult
  explanation?: string
  conversationId?: string
}

export interface AppDataSnapshot {
  schemaVersion: number
  mistakeBookEntries: MistakeBookEntry[]
  misunderstoodPositions: MisunderstoodPosition[]
  savedPositions: SavedPosition[]
  conversations: AIConversation[]
  userGuesses: UserGuess[]
}

export interface AppDataImportSummary {
  mistakeBookEntries: number
  misunderstoodPositions: number
  savedPositions: number
  conversations: number
  userGuesses: number
}

export const EMPTY_APP_DATA: AppDataSnapshot = {
  schemaVersion: APP_DATA_SCHEMA_VERSION,
  mistakeBookEntries: [],
  misunderstoodPositions: [],
  savedPositions: [],
  conversations: [],
  userGuesses: []
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function hasString<K extends string>(
  value: Record<string, unknown>,
  key: K
): value is Record<string, unknown> & Record<K, string> {
  return typeof value[key] === 'string'
}

const SENSITIVE_FIELD_PATTERN =
  /^(apiKey|api_key|token|secret|password|authorization|licenseKey)$/i

function stripSensitiveFields<T>(value: T, depth = 0): T {
  if (depth > 8) return value
  if (Array.isArray(value)) {
    return value.map((item) => stripSensitiveFields(item, depth + 1)) as T
  }
  if (!isRecord(value)) return value
  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => !SENSITIVE_FIELD_PATTERN.test(key))
      .map(([key, item]) => [key, stripSensitiveFields(item, depth + 1)])
  ) as T
}

function sanitizeArray<T>(
  value: unknown,
  isValid: (entry: unknown) => entry is T
): T[] {
  return Array.isArray(value)
    ? value.filter(isValid).slice(0, 5000).map((entry) => stripSensitiveFields(entry))
    : []
}

function isMistakeBookEntry(value: unknown): value is MistakeBookEntry {
  return (
    isRecord(value) &&
    hasString(value, 'id') &&
    hasString(value, 'positionFen') &&
    hasString(value, 'userMove') &&
    hasString(value, 'engineBestMove') &&
    isRecord(value.engineAnalysis)
  )
}

function isMisunderstoodPosition(value: unknown): value is MisunderstoodPosition {
  return (
    isRecord(value) &&
    hasString(value, 'id') &&
    hasString(value, 'positionFen') &&
    hasString(value, 'reason') &&
    hasString(value, 'createdAt') &&
    hasString(value, 'updatedAt')
  )
}

function isSavedPosition(value: unknown): value is SavedPosition {
  return (
    isRecord(value) &&
    hasString(value, 'id') &&
    hasString(value, 'name') &&
    hasString(value, 'fen') &&
    hasString(value, 'createdAt') &&
    hasString(value, 'updatedAt')
  )
}

function isAIProviderId(value: unknown): value is AIProviderId {
  return (
    typeof value === 'string' &&
    ALL_PROVIDER_IDS.includes(value as AIProviderId)
  )
}

function sanitizeConversationMessage(value: unknown): ConversationMessage | null {
  if (
    !isRecord(value) ||
    !hasString(value, 'id') ||
    (value.role !== 'user' && value.role !== 'assistant') ||
    !hasString(value, 'text') ||
    !hasString(value, 'createdAt')
  ) {
    return null
  }

  const message: ConversationMessage = {
    id: value.id,
    role: value.role,
    text: value.text,
    createdAt: value.createdAt
  }
  if (isAIProviderId(value.provider)) message.provider = value.provider
  if (typeof value.model === 'string' && value.model.trim()) {
    message.model = value.model.trim()
  }
  return message
}

function sanitizeConversation(value: unknown): AIConversation | null {
  if (
    !isRecord(value) ||
    !hasString(value, 'id') ||
    !hasString(value, 'analysisId') ||
    !hasString(value, 'positionFen') ||
    !hasString(value, 'createdAt') ||
    !hasString(value, 'updatedAt') ||
    !Array.isArray(value.messages)
  ) {
    return null
  }

  const messages = value.messages.map(sanitizeConversationMessage)
  if (messages.some((message) => message === null)) return null
  return {
    id: value.id,
    analysisId: value.analysisId,
    positionFen: value.positionFen,
    createdAt: value.createdAt,
    updatedAt: value.updatedAt,
    messages: messages as ConversationMessage[]
  }
}

function sanitizeConversations(value: unknown): AIConversation[] {
  if (!Array.isArray(value)) return []
  return value
    .map(sanitizeConversation)
    .filter((conversation): conversation is AIConversation => conversation !== null)
    .slice(0, 5000)
}

function isUserGuess(value: unknown): value is UserGuess {
  return (
    isRecord(value) &&
    hasString(value, 'id') &&
    hasString(value, 'fen') &&
    hasString(value, 'guessMoveUci') &&
    hasString(value, 'bestMoveUci') &&
    typeof value.createdAt === 'number'
  )
}

export function sanitizeAppData(value: unknown): AppDataSnapshot {
  if (!isRecord(value)) return { ...EMPTY_APP_DATA }
  return {
    schemaVersion: APP_DATA_SCHEMA_VERSION,
    mistakeBookEntries: sanitizeArray(value.mistakeBookEntries, isMistakeBookEntry),
    misunderstoodPositions: sanitizeArray(
      value.misunderstoodPositions,
      isMisunderstoodPosition
    ),
    savedPositions: sanitizeArray(value.savedPositions, isSavedPosition),
    conversations: sanitizeConversations(value.conversations),
    userGuesses: sanitizeArray(value.userGuesses, isUserGuess)
  }
}

function mergeUnique<T>(
  current: T[],
  incoming: T[],
  identity: (entry: T) => string
): { entries: T[]; imported: number } {
  const identities = new Set(current.map(identity))
  const additions = incoming.filter((entry) => {
    const key = identity(entry)
    if (identities.has(key)) return false
    identities.add(key)
    return true
  })
  return { entries: [...current, ...additions], imported: additions.length }
}

export function mergeAppData(
  currentValue: unknown,
  incomingValue: unknown
): { snapshot: AppDataSnapshot; summary: AppDataImportSummary } {
  const current = sanitizeAppData(currentValue)
  const incoming = sanitizeAppData(incomingValue)
  const mistakes = mergeUnique(
    current.mistakeBookEntries,
    incoming.mistakeBookEntries,
    (entry) =>
      `${entry.positionFen}|${entry.userMove}|${entry.engineBestMove}|${entry.createdAt}`
  )
  const misunderstood = mergeUnique(
    current.misunderstoodPositions,
    incoming.misunderstoodPositions,
    (entry) => `${entry.positionFen}|${entry.reason}|${entry.createdAt}`
  )
  const saved = mergeUnique(
    current.savedPositions,
    incoming.savedPositions,
    (entry) => `${entry.fen}|${entry.name}`
  )
  const conversations = mergeUnique(
    current.conversations,
    incoming.conversations,
    (entry) => entry.id
  )
  const guesses = mergeUnique(
    current.userGuesses,
    incoming.userGuesses,
    (entry) =>
      `${entry.fen}|${entry.guessMoveUci}|${entry.bestMoveUci}|${entry.createdAt}`
  )
  return {
    snapshot: {
      schemaVersion: APP_DATA_SCHEMA_VERSION,
      mistakeBookEntries: mistakes.entries,
      misunderstoodPositions: misunderstood.entries,
      savedPositions: saved.entries,
      conversations: conversations.entries,
      userGuesses: guesses.entries
    },
    summary: {
      mistakeBookEntries: mistakes.imported,
      misunderstoodPositions: misunderstood.imported,
      savedPositions: saved.imported,
      conversations: conversations.imported,
      userGuesses: guesses.imported
    }
  }
}
