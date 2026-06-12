import type { EngineAnalysis } from './EngineAnalysis'
import type { MistakeBookEntry } from './MistakeBookEntry'
import type { MoveComparisonResult } from './MoveComparisonResult'
import type { UserGuess } from './UserGuess'

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

function hasString(value: Record<string, unknown>, key: string): boolean {
  return typeof value[key] === 'string'
}

function sanitizeArray<T>(
  value: unknown,
  isValid: (entry: unknown) => entry is T
): T[] {
  return Array.isArray(value) ? value.filter(isValid).slice(0, 5000) : []
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

function isConversationMessage(value: unknown): value is ConversationMessage {
  return (
    isRecord(value) &&
    hasString(value, 'id') &&
    (value.role === 'user' || value.role === 'assistant') &&
    hasString(value, 'text') &&
    hasString(value, 'createdAt')
  )
}

function isConversation(value: unknown): value is AIConversation {
  return (
    isRecord(value) &&
    hasString(value, 'id') &&
    hasString(value, 'analysisId') &&
    hasString(value, 'positionFen') &&
    hasString(value, 'createdAt') &&
    hasString(value, 'updatedAt') &&
    Array.isArray(value.messages) &&
    value.messages.every(isConversationMessage)
  )
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
    conversations: sanitizeArray(value.conversations, isConversation),
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
