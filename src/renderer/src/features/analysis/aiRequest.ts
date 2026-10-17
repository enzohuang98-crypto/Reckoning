import type { ConversationMessage } from '@shared/types/AppData'
import type { AIExplanationResponse } from '@shared/types/AIExplanationTypes'
import type {
  EngineAnalysisResultPayload,
  GenerateExplanationStartPayload
} from '@shared/types/ipc'

/** AI 請求所屬的分析對象；局面、著法或點選／提交任何一項改變，舊請求的回應都要丟棄。 */
export interface AiRequestTarget {
  boardFen: string
  analysisMove: string
  actualMoveSelectionId: string | null
  submissionId: string | null
}

/** 送出當下的快照：回應抵達時用它組對話，不讀當時（可能已改變）的設定或分析。 */
export interface PendingAiRequest {
  target: AiRequestTarget
  question: string | null
  conversationId: string
  conversationCreatedAt: string | null
  conversationMessages: ConversationMessage[]
  analysisId: string
  positionFen: string
  resultSnapshot: EngineAnalysisResultPayload
  provider: AIExplanationResponse['provider']
  model: string
}

/** 「重試 AI」原樣重送的請求（不含 requestId，每次重送都換新 id）。 */
export interface RetryableAiRequest {
  target: AiRequestTarget
  pending: PendingAiRequest
  start: Omit<GenerateExplanationStartPayload, 'requestId'>
}

/** 引擎尚未完成這輪分析時先排隊的提問；分析完成後若對象沒變就送出。 */
export interface QueuedExplanation {
  question: string | null
  regenerate: boolean
  target: AiRequestTarget
}

/** 每次 AI 請求最多附帶的歷史訊息數；更早的內容對單題回答幫助有限，卻會拉長 prompt。 */
export const MAX_REQUEST_HISTORY_MESSAGES = 6
/** 單則歷史訊息附帶上限；長答案只保留開頭，避免一則長回覆讓之後每次追問都被拒絕。 */
export const MAX_REQUEST_HISTORY_MESSAGE_CHARS = 1_500
export const HISTORY_TRUNCATION_MARKER = '…（已截斷）'

/**
 * 把完整對話縮成送給 main 的請求歷史：只取最後幾則，超長訊息截斷而不是讓整個請求失敗。
 * 原始對話（含全文）仍保存在 AppData，不受影響。
 */
export function buildConversationHistoryForRequest(
  messages: readonly ConversationMessage[] | undefined
): ConversationMessage[] | undefined {
  if (!messages) return undefined
  return messages.slice(-MAX_REQUEST_HISTORY_MESSAGES).map((message) => ({
    ...message,
    text:
      message.text.length > MAX_REQUEST_HISTORY_MESSAGE_CHARS
        ? `${message.text.slice(0, MAX_REQUEST_HISTORY_MESSAGE_CHARS)}${HISTORY_TRUNCATION_MARKER}`
        : message.text
  }))
}

export function newMessage(
  role: ConversationMessage['role'],
  text: string,
  provenance?: Pick<PendingAiRequest, 'provider' | 'model'>
): ConversationMessage {
  return {
    id: crypto.randomUUID(),
    role,
    text,
    createdAt: new Date().toISOString(),
    ...(role === 'assistant' && provenance ? provenance : {})
  }
}

export function isSameAiRequestTarget(
  left: AiRequestTarget,
  right: AiRequestTarget | null
): boolean {
  return Boolean(
    right &&
      left.boardFen === right.boardFen &&
      left.analysisMove === right.analysisMove &&
      left.actualMoveSelectionId === right.actualMoveSelectionId &&
      left.submissionId === right.submissionId
  )
}

export function cloneExplanationStart(
  start: Omit<GenerateExplanationStartPayload, 'requestId'>
): Omit<GenerateExplanationStartPayload, 'requestId'> {
  return {
    ...start,
    conversationHistory: start.conversationHistory?.map((message) => ({ ...message }))
  }
}

export function clonePendingAiRequest(pending: PendingAiRequest): PendingAiRequest {
  return {
    ...pending,
    target: { ...pending.target },
    conversationMessages: pending.conversationMessages.map((message) => ({ ...message }))
  }
}
