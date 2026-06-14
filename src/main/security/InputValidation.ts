import { isAbsolute } from 'node:path'
import { parseFen } from '@shared/logic/fen'
import { detectApiKeyProvider } from '@shared/logic/ApiKeyProvider'
import type { AIProviderId } from '@shared/types/AIProviderTypes'
import type { AnalyzePositionStartPayload, GenerateExplanationStartPayload } from '@shared/types/ipc'
import type { ConversationMessage } from '@shared/types/AppData'
import { maskSecrets } from '../Logger'

export const MAX_APP_DATA_BYTES = 5 * 1024 * 1024
export const MAX_BACKUP_BYTES = 10 * 1024 * 1024
export const MAX_SECRET_FILE_BYTES = 256 * 1024
export const MAX_SETTINGS_FILE_BYTES = 1024 * 1024
export const MAX_AI_RESPONSE_CHARS = 1_000_000

const MAX_REQUEST_ID_LENGTH = 128
const MAX_API_KEY_LENGTH = 8192
const MAX_LICENSE_KEY_LENGTH = 16_384
const MAX_ENGINE_PATH_LENGTH = 2048
const MAX_CONVERSATION_MESSAGES = 50
const MAX_CONVERSATION_TEXT_LENGTH = 4000
const PROVIDERS = new Set<AIProviderId>(['anthropic', 'openai', 'gemini'])
const USER_LEVELS = new Set(['basic', 'intermediate', 'advanced'])
const LANGUAGES = new Set(['zh-TW', 'zh-CN', 'en'])
const MODEL_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$/
const REQUEST_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/
const MOVE_PATTERN = /^[a-i][0-9][a-i][0-9]$/
const ENGINE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/

function optionalEngineId(value: unknown, field: string): string | undefined {
  if (value === undefined || value === null || value === '') return undefined
  if (typeof value !== 'string' || !ENGINE_ID_PATTERN.test(value)) {
    throw new SecurityValidationError(`${field} 格式無效。`)
  }
  return value
}

export class SecurityValidationError extends Error {
  constructor(
    message: string,
    public readonly code: 'invalid_request' | 'invalid_fen' | 'invalid_analysis_config' | 'invalid_user_move' =
      'invalid_request'
  ) {
    super(message)
    this.name = 'SecurityValidationError'
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function boundedString(
  value: unknown,
  field: string,
  maxLength: number,
  allowEmpty = false
): string {
  if (typeof value !== 'string') {
    throw new SecurityValidationError(`${field} 必須是字串。`)
  }
  const normalized = value.trim()
  if ((!allowEmpty && normalized.length === 0) || normalized.length > maxLength) {
    throw new SecurityValidationError(`${field} 長度無效。`)
  }
  if (normalized.includes('\0')) {
    throw new SecurityValidationError(`${field} 含有不允許的字元。`)
  }
  return normalized
}

export function normalizeRequestId(value: unknown): string {
  const requestId = boundedString(value, 'requestId', MAX_REQUEST_ID_LENGTH)
  if (!REQUEST_ID_PATTERN.test(requestId)) {
    throw new SecurityValidationError('requestId 格式無效。')
  }
  return requestId
}

export function safeRequestId(value: unknown): string {
  if (typeof value !== 'string') return 'invalid-request'
  const normalized = value.trim()
  return REQUEST_ID_PATTERN.test(normalized) ? normalized : 'invalid-request'
}

export function normalizeProviderId(value: unknown): AIProviderId {
  if (typeof value !== 'string' || !PROVIDERS.has(value as AIProviderId)) {
    throw new SecurityValidationError('AI Provider 無效。')
  }
  return value as AIProviderId
}

export function normalizeApiKey(value: unknown): {
  provider: AIProviderId
  apiKey: string
} {
  const apiKey = boundedString(value, 'API key', MAX_API_KEY_LENGTH)
  if (/[\r\n]/.test(apiKey)) {
    throw new SecurityValidationError('API key 格式無效。')
  }
  const detected = detectApiKeyProvider(apiKey)
  if (!detected) {
    throw new SecurityValidationError(
      '無法辨識 API Key。支援 Claude（sk-ant-）、Gemini（AIza）與 OpenAI（sk-）。'
    )
  }
  return { provider: detected.provider, apiKey: detected.normalizedKey }
}

export function normalizeLicenseKey(value: unknown): string {
  return boundedString(value, 'License Key', MAX_LICENSE_KEY_LENGTH)
}

export function normalizeEnginePath(
  value: unknown,
  platform: NodeJS.Platform = process.platform
): string | null {
  if (value === null || value === undefined || value === '') return null
  const enginePath = boundedString(value, '引擎路徑', MAX_ENGINE_PATH_LENGTH)
  if (!isAbsolute(enginePath)) {
    throw new SecurityValidationError('引擎路徑必須是絕對路徑。')
  }
  if (
    platform === 'win32' &&
    (enginePath.startsWith('\\\\') || enginePath.startsWith('//'))
  ) {
    throw new SecurityValidationError('引擎必須位於本機磁碟，不允許網路共享路徑。')
  }
  if (platform === 'win32' && !enginePath.toLowerCase().endsWith('.exe')) {
    throw new SecurityValidationError('Windows 引擎必須是 .exe 可執行檔。')
  }
  return enginePath
}

export function assertJsonSize(value: unknown, maxBytes: number, label: string): void {
  let serialized: string
  try {
    serialized = JSON.stringify(value)
  } catch {
    throw new SecurityValidationError(`${label} 無法序列化。`)
  }
  if (Buffer.byteLength(serialized, 'utf8') > maxBytes) {
    throw new SecurityValidationError(`${label} 超過允許大小。`)
  }
}

export function sanitizePublicErrorMessage(value: unknown, fallback: string): string {
  if (typeof value !== 'string') return fallback
  const sanitized = maskSecrets(value)
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '')
    .trim()
    .slice(0, 500)
  return sanitized || fallback
}

export function validateAnalyzePositionPayload(value: unknown): AnalyzePositionStartPayload {
  if (!isRecord(value) || !isRecord(value.analysisConfig)) {
    throw new SecurityValidationError('分析請求格式無效。', 'invalid_analysis_config')
  }
  const requestId = normalizeRequestId(value.requestId)
  const positionFen = boundedString(value.positionFen, 'FEN', 256)
  const parsed = parseFen(positionFen)
  if (!parsed.valid) {
    throw new SecurityValidationError(`FEN 格式不正確：${parsed.message}`, 'invalid_fen')
  }

  const userMove =
    value.userMove === undefined || value.userMove === null || value.userMove === ''
      ? undefined
      : boundedString(value.userMove, '使用者著法', 4).toLowerCase()
  if (userMove && !MOVE_PATTERN.test(userMove)) {
    throw new SecurityValidationError('使用者著法格式無效。', 'invalid_user_move')
  }

  const config = value.analysisConfig
  const rootAnalysisMovetimeMs = config.rootAnalysisMovetimeMs
  const userMoveEvalMovetimeMs = config.userMoveEvalMovetimeMs
  const multiPv = config.multiPv
  if (
    !Number.isSafeInteger(rootAnalysisMovetimeMs) ||
    (rootAnalysisMovetimeMs as number) < 100 ||
    (rootAnalysisMovetimeMs as number) > 60_000 ||
    !Number.isSafeInteger(userMoveEvalMovetimeMs) ||
    (userMoveEvalMovetimeMs as number) < 100 ||
    (userMoveEvalMovetimeMs as number) > 60_000 ||
    !Number.isSafeInteger(multiPv) ||
    (multiPv as number) < 1 ||
    (multiPv as number) > 20
  ) {
    throw new SecurityValidationError('分析參數超出允許範圍。', 'invalid_analysis_config')
  }

  return {
    requestId,
    engineId: optionalEngineId(value.engineId, '主引擎識別碼'),
    verificationEngineId: optionalEngineId(
      value.verificationEngineId,
      '複核引擎識別碼'
    ),
    positionFen: parsed.board.fen,
    userMove,
    analysisConfig: {
      rootAnalysisMovetimeMs: rootAnalysisMovetimeMs as number,
      userMoveEvalMovetimeMs: userMoveEvalMovetimeMs as number,
      multiPv: multiPv as number
    }
  }
}

function normalizeConversationMessage(value: unknown): ConversationMessage {
  if (!isRecord(value) || (value.role !== 'user' && value.role !== 'assistant')) {
    throw new SecurityValidationError('對話紀錄格式無效。')
  }
  return {
    id: boundedString(value.id, '對話訊息 ID', 128),
    role: value.role,
    text: boundedString(value.text, '對話文字', MAX_CONVERSATION_TEXT_LENGTH, true),
    createdAt: boundedString(value.createdAt, '對話時間', 64)
  }
}

export function validateGenerateExplanationPayload(
  value: unknown
): GenerateExplanationStartPayload {
  if (!isRecord(value)) {
    throw new SecurityValidationError('AI 解說請求格式無效。')
  }
  const requestId = normalizeRequestId(value.requestId)
  const analysisId = boundedString(value.analysisId, 'analysisId', 128)
  const provider = normalizeProviderId(value.provider)
  const model = boundedString(value.model, '模型 ID', 128)
  if (!MODEL_ID_PATTERN.test(model)) {
    throw new SecurityValidationError('模型 ID 格式無效。')
  }
  if (typeof value.userLevel !== 'string' || !USER_LEVELS.has(value.userLevel)) {
    throw new SecurityValidationError('使用者棋力設定無效。')
  }
  if (value.explanationStyle !== 'long_analytical') {
    throw new SecurityValidationError('解說風格無效。')
  }
  if (typeof value.language !== 'string' || !LANGUAGES.has(value.language)) {
    throw new SecurityValidationError('解說語言無效。')
  }

  let conversationHistory: ConversationMessage[] | undefined
  if (value.conversationHistory !== undefined) {
    if (!Array.isArray(value.conversationHistory)) {
      throw new SecurityValidationError('對話紀錄格式無效。')
    }
    conversationHistory = value.conversationHistory
      .slice(-MAX_CONVERSATION_MESSAGES)
      .map(normalizeConversationMessage)
  }
  const followUpQuestion =
    value.followUpQuestion === undefined || value.followUpQuestion === null
      ? undefined
      : boundedString(
          value.followUpQuestion,
          '追問內容',
          MAX_CONVERSATION_TEXT_LENGTH,
          true
        )
  const attachedMove =
    value.attachedMove === undefined || value.attachedMove === null || value.attachedMove === ''
      ? undefined
      : boundedString(value.attachedMove, '附加著法', 4).toLowerCase()
  if (attachedMove && !MOVE_PATTERN.test(attachedMove)) {
    throw new SecurityValidationError('附加著法格式無效。')
  }
  const answerMode =
    value.answerMode === 'focused' || value.answerMode === 'research'
      ? value.answerMode
      : undefined
  let budget: GenerateExplanationStartPayload['budget']
  if (value.budget !== undefined) {
    if (!isRecord(value.budget)) {
      throw new SecurityValidationError('Harness 預算格式無效。')
    }
    const engineTimeMs = value.budget.engineTimeMs
    const maxEngineRounds = value.budget.maxEngineRounds
    const maxModelCalls = value.budget.maxModelCalls
    const maxOutputTokens = value.budget.maxOutputTokens
    if (
      !Number.isSafeInteger(engineTimeMs) ||
      (engineTimeMs as number) < 3000 ||
      (engineTimeMs as number) > 60_000 ||
      !Number.isSafeInteger(maxEngineRounds) ||
      (maxEngineRounds as number) < 1 ||
      (maxEngineRounds as number) > 3 ||
      !Number.isSafeInteger(maxModelCalls) ||
      (maxModelCalls as number) < 2 ||
      (maxModelCalls as number) > 10 ||
      !Number.isSafeInteger(maxOutputTokens) ||
      (maxOutputTokens as number) < 500 ||
      (maxOutputTokens as number) > 20_000
    ) {
      throw new SecurityValidationError('Harness 預算超出允許範圍。')
    }
    budget = {
      engineTimeMs: engineTimeMs as number,
      maxEngineRounds: maxEngineRounds as number,
      maxModelCalls: maxModelCalls as number,
      maxOutputTokens: maxOutputTokens as number
    }
  }

  return {
    requestId,
    analysisId,
    provider,
    model,
    userLevel: value.userLevel as GenerateExplanationStartPayload['userLevel'],
    explanationStyle: 'long_analytical',
    language: value.language as GenerateExplanationStartPayload['language'],
    conversationHistory,
    followUpQuestion,
    attachedMove,
    answerMode,
    budget,
    engineId: optionalEngineId(value.engineId, '主引擎識別碼'),
    verificationEngineId: optionalEngineId(
      value.verificationEngineId,
      '複核引擎識別碼'
    ),
    reuseEvidence: value.reuseEvidence === true
  }
}
