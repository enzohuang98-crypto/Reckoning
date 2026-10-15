import type { ConversationMessage } from '@shared/types/AppData'

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
