/**
 * AI Provider 共用 HTTP 工具
 *
 * OpenAI 與 Gemini 的錯誤回應皆為 { error: { message } } 形狀，
 * 統一在此萃取人類可讀的錯誤訊息。
 */

/** 自 API 錯誤回應萃取訊息；非 JSON 或無 message 時退回 statusText */
export async function extractApiErrorMessage(res: Response): Promise<string> {
  try {
    const body = (await res.json()) as { error?: { message?: string } }
    if (body?.error?.message) return body.error.message
  } catch {
    /* 非 JSON 回應 */
  }
  return res.statusText || '未知錯誤'
}
