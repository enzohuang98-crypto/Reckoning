/**
 * AI Provider 共用 HTTP 工具
 *
 * OpenAI 與 Gemini 的錯誤回應皆為 { error: { message } } 形狀，
 * 統一在此萃取人類可讀的錯誤訊息。
 */

import type { AITestCredentialResult } from '@shared/types/AIProviderTypes'

export const MAX_AI_HTTP_RESPONSE_BYTES = 5 * 1024 * 1024

/** 指定模型低用量推論逾時；必須短於 renderer 的保險逾時。 */
export const CREDENTIAL_TEST_TIMEOUT_MS = 8_000

/**
 * Anthropic SDK 使用的受限 transport。所有 AI 請求都拒絕重新導向，
 * 並在 SDK 解析 JSON／SSE 前限制實際收到的 bytes。
 */
export async function fetchAiResponseBounded(
  input: string | URL | Request,
  init?: RequestInit,
  maxBytes = MAX_AI_HTTP_RESPONSE_BYTES
): Promise<Response> {
  const response = await fetch(input, { ...init, redirect: 'error' })
  if (!response.body) return response

  const declaredLength = Number(response.headers.get('content-length'))
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    await response.body.cancel()
    throw new Error('AI 服務回應超過允許大小。')
  }

  const reader = response.body.getReader()
  let total = 0
  const boundedBody = new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const { done, value } = await reader.read()
        if (done) {
          controller.close()
          return
        }
        total += value.byteLength
        if (total > maxBytes) {
          await reader.cancel()
          controller.error(new Error('AI 服務回應超過允許大小。'))
          return
        }
        controller.enqueue(value)
      } catch (error) {
        controller.error(error)
      }
    },
    async cancel(reason) {
      await reader.cancel(reason)
    }
  })

  return new Response(boundedBody, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers
  })
}

/**
 * 金鑰健康檢查共用的錯誤轉換；只依 HTTP 狀態碼與錯誤型別分類，
 * 不讀取回應內容，避免意外把服務錯誤細節（可能含帳號資訊）外洩。
 */
export function describeCredentialTestError(
  error: unknown,
  providerLabel: string
): AITestCredentialResult {
  const errorClassName =
    error instanceof Error ? error.constructor.name : undefined
  if (
    (error instanceof DOMException && error.name === 'AbortError') ||
    (error instanceof Error &&
      (error.name === 'AbortError' || error.name === 'TimeoutError')) ||
    (errorClassName !== undefined &&
      /Abort|Timeout/.test(errorClassName))
  ) {
    return { ok: false, message: '測試逾時，請檢查網路連線或稍後重試。' }
  }
  const explicitStatus = (error as { status?: unknown } | null)?.status
  const messageStatus =
    error instanceof Error
      ? /\((\d{3})\)/.exec(error.message)?.[1]
      : undefined
  const status =
    typeof explicitStatus === 'number'
      ? explicitStatus
      : messageStatus
        ? Number(messageStatus)
        : undefined
  if (status === 401 || status === 403) {
    return {
      ok: false,
      message: `${providerLabel} 回報認證失敗，請確認金鑰是否正確、是否貼對服務。`
    }
  }
  if (status === 429) {
    return {
      ok: false,
      message: `${providerLabel} 回報限流 (429)；金鑰可能有效，請稍後再試一次。`
    }
  }
  if (typeof status === 'number') {
    return {
      ok: false,
      message: `${providerLabel} 回報錯誤 (${status})，請確認金鑰與服務狀態。`
    }
  }
  if (error instanceof TypeError) {
    return { ok: false, message: '網路連線失敗，請檢查網路後重試。' }
  }
  return { ok: false, message: `${providerLabel} 金鑰測試發生未知錯誤。` }
}

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
  } catch (error) {
    // Cancelling after the response headers arrive can abort the body reader.
    // Preserve that signal so callers report cancellation instead of replacing
    // it with the HTTP status text.
    if (
      (error instanceof DOMException && error.name === 'AbortError') ||
      (error instanceof Error && error.name === 'AbortError')
    ) {
      throw error
    }
    /* 非 JSON 回應 */
  }
  return res.statusText || '未知錯誤'
}
