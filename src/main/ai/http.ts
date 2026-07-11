/**
 * AI Provider 共用 HTTP 工具
 *
 * OpenAI 與 Gemini 的錯誤回應皆為 { error: { message } } 形狀，
 * 統一在此萃取人類可讀的錯誤訊息。
 */

export const MAX_AI_HTTP_RESPONSE_BYTES = 5 * 1024 * 1024

export async function readJsonResponseBounded<T>(
  res: Response,
  maxBytes = MAX_AI_HTTP_RESPONSE_BYTES
): Promise<T> {
  if (!res.body) throw new Error('AI 服務回應沒有內容。')
  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let total = 0
  let text = ''
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      total += value.byteLength
      if (total > maxBytes) {
        await reader.cancel()
        throw new Error('AI 服務回應超過允許大小。')
      }
      text += decoder.decode(value, { stream: true })
    }
    text += decoder.decode()
    return JSON.parse(text) as T
  } finally {
    reader.releaseLock()
  }
}

/** 自 API 錯誤回應萃取訊息；非 JSON、過大或無 message 時退回 statusText */
export async function extractApiErrorMessage(res: Response): Promise<string> {
  try {
    const body = await readJsonResponseBounded<{ error?: { message?: string } }>(
      res,
      64 * 1024
    )
    if (body?.error?.message) return body.error.message
  } catch {
    /* 非 JSON 回應 */
  }
  return res.statusText || '未知錯誤'
}
