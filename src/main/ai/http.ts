/**
 * AI Provider 共用 HTTP 工具
 *
 * OpenAI 與 Gemini 的錯誤回應皆為 { error: { message } } 形狀，
 * 統一在此萃取人類可讀的錯誤訊息。
 */

import type {
  AICredentialDiagnostic,
  AICredentialErrorCategory,
  AICredentialTestStage,
  AITestCredentialResult
} from '@shared/types/AIProviderTypes'

export const MAX_AI_HTTP_RESPONSE_BYTES = 5 * 1024 * 1024

/** 指定模型低用量推論逾時；必須短於 renderer 的保險逾時。 */
export const CREDENTIAL_TEST_TIMEOUT_MS = 8_000

const MAX_RETRY_AFTER_MS = 60 * 60 * 1000

/** 可安全傳給憑證測試分類器的 HTTP 錯誤；message 不包含回應本文。 */
export class AIHttpError extends Error {
  readonly name = 'AIHttpError'

  constructor(
    readonly status: number,
    readonly stage: AICredentialTestStage,
    message: string,
    readonly retryAfterMs?: number
  ) {
    super(message)
  }
}

/** Provider 回應已收到，但不符合正式文字答案契約。 */
export class AIResponseValidationError extends Error {
  readonly name = 'AIResponseValidationError'

  constructor(
    readonly stage: AICredentialTestStage,
    readonly category: Extract<
      AICredentialErrorCategory,
      'response_format' | 'model_mismatch' | 'generation_incomplete'
    >,
    message: string
  ) {
    super(message)
  }
}

const AI_TRANSPORT_STAGES = new WeakMap<object, AICredentialTestStage>()

/** Record a safe stage while preserving the original AbortError/TypeError identity. */
export function toAITransportError(
  error: unknown,
  stage: AICredentialTestStage
): Error | undefined {
  const errorClassName = error instanceof Error ? error.constructor.name : undefined
  const isAbort =
    (error instanceof DOMException &&
      (error.name === 'AbortError' || error.name === 'TimeoutError')) ||
    (error instanceof Error &&
      (error.name === 'AbortError' || error.name === 'TimeoutError')) ||
    (errorClassName !== undefined && /Abort|Timeout/.test(errorClassName))
  const isNetwork = error instanceof TypeError || error instanceof RangeError
  if (!isAbort && !isNetwork) return undefined
  if (typeof error !== 'object' || error === null) return undefined
  AI_TRANSPORT_STAGES.set(error, stage)
  return error as Error
}

function getAITransportStage(error: unknown): AICredentialTestStage | undefined {
  return typeof error === 'object' && error !== null
    ? AI_TRANSPORT_STAGES.get(error)
    : undefined
}

/** 將 Retry-After 轉成有限的毫秒數，避免把服務端資料直接帶進 UI。 */
export function parseRetryAfterMs(value: string | null): number | undefined {
  if (!value) return undefined
  const seconds = Number(value.trim())
  if (Number.isFinite(seconds) && seconds >= 0) {
    return Math.min(Math.round(seconds * 1000), MAX_RETRY_AFTER_MS)
  }
  const timestamp = Date.parse(value)
  if (!Number.isFinite(timestamp)) return undefined
  return Math.min(Math.max(timestamp - Date.now(), 0), MAX_RETRY_AFTER_MS)
}

export function createAIHttpError(
  response: Response,
  stage: AICredentialTestStage,
  message: string
): AIHttpError {
  return new AIHttpError(
    response.status,
    stage,
    message,
    parseRetryAfterMs(response.headers.get('retry-after'))
  )
}

/** 從 SDK status 欄位或共用錯誤訊息格式取得 HTTP 狀態碼。 */
export function aiErrorStatus(error: unknown): number | undefined {
  const explicitStatus = (error as { status?: unknown } | null)?.status
  if (typeof explicitStatus === 'number') return explicitStatus
  const messageStatus =
    error instanceof Error
      ? /\((\d{3})\)/.exec(error.message)?.[1]
      : undefined
  return messageStatus ? Number(messageStatus) : undefined
}

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
  providerLabel: string,
  fallbackStage: AICredentialTestStage = 'generation'
): AITestCredentialResult {
  const candidateStage =
    (error as { stage?: unknown } | null)?.stage ?? getAITransportStage(error)
  const resolvedStage: AICredentialTestStage =
    candidateStage === 'key' ||
    candidateStage === 'catalog' ||
    candidateStage === 'generation' ||
    candidateStage === 'storage'
      ? candidateStage
      : fallbackStage
  const diagnostic = (
    category: AICredentialErrorCategory,
    message: string,
    options: Partial<
      Pick<AICredentialDiagnostic, 'retryable' | 'httpStatus' | 'retryAfterMs'>
    > = {},
    stage: AICredentialTestStage = resolvedStage
  ): AITestCredentialResult => ({
    ok: false,
    message,
    diagnostic: {
      stage,
      category,
      retryable: options.retryable ?? false,
      ...(options.httpStatus === undefined
        ? {}
        : { httpStatus: options.httpStatus }),
      ...(options.retryAfterMs === undefined
        ? {}
        : { retryAfterMs: options.retryAfterMs }),
      message
    }
  })

  const errorClassName =
    error instanceof Error ? error.constructor.name : undefined
  if (
    (error instanceof DOMException && error.name === 'AbortError') ||
    (error instanceof Error &&
      (error.name === 'AbortError' || error.name === 'TimeoutError')) ||
    (errorClassName !== undefined &&
      /Abort|Timeout/.test(errorClassName))
  ) {
    return diagnostic('timeout', '測試逾時，請檢查網路連線或稍後重試。', {
      retryable: true
    })
  }
  const status = aiErrorStatus(error)
  const retryAfterMs = (error as { retryAfterMs?: unknown } | null)?.retryAfterMs
  const safeRetryAfterMs =
    typeof retryAfterMs === 'number' && Number.isFinite(retryAfterMs)
      ? retryAfterMs
      : undefined
  if (status === 401) {
    return diagnostic(
      'authentication',
      `${providerLabel} 回報認證失敗，請確認金鑰是否正確、是否貼對服務。`,
      { httpStatus: status, retryable: false, retryAfterMs: safeRetryAfterMs }
    )
  }
  if (status === 403) {
    return diagnostic(
      'permission',
      `${providerLabel} 回報沒有使用此服務的權限，請確認帳戶與金鑰權限。`,
      { httpStatus: status, retryable: false, retryAfterMs: safeRetryAfterMs }
    )
  }
  if (status === 402) {
    return diagnostic(
      'billing',
      `${providerLabel} 回報帳務或額度不足 (402)；請確認帳戶方案後再試。`,
      { httpStatus: status, retryable: false, retryAfterMs: safeRetryAfterMs }
    )
  }
  if (status === 429) {
    return diagnostic(
      'rate_limited',
      `${providerLabel} 回報限流 (429)；金鑰可能有效，請稍後再試一次。`,
      { httpStatus: status, retryable: true, retryAfterMs: safeRetryAfterMs }
    )
  }
  if (status === 404) {
    return diagnostic(
      'model_unavailable',
      `${providerLabel} 找不到要求的模型或端點 (404)，請重新讀取模型清單。`,
      { httpStatus: status, retryable: resolvedStage !== 'generation' }
    )
  }
  if (status === 503) {
    return diagnostic(
      'provider_unavailable',
      `${providerLabel} 服務暫時過載或不可用 (503)；這不是金鑰認證失敗，請稍後再試。`,
      { httpStatus: status, retryable: true, retryAfterMs: safeRetryAfterMs }
    )
  }
  if (typeof status === 'number' && status >= 500 && status <= 599) {
    return diagnostic(
      'provider_unavailable',
      `${providerLabel} 服務暫時不可用 (${status})；請稍後再試。`,
      { httpStatus: status, retryable: true, retryAfterMs: safeRetryAfterMs }
    )
  }
  if (status === 400 || status === 422) {
    return diagnostic(
      'invalid_request',
      `${providerLabel} 拒絕了這個測試請求 (${status})，請確認模型與設定。`,
      { httpStatus: status, retryable: false, retryAfterMs: safeRetryAfterMs }
    )
  }
  if (typeof status === 'number') {
    return diagnostic(
      'unknown',
      `${providerLabel} 回報錯誤 (${status})，請確認金鑰與服務狀態。`,
      { httpStatus: status, retryable: false, retryAfterMs: safeRetryAfterMs }
    )
  }
  if (error instanceof AIResponseValidationError) {
    const messages: Record<typeof error.category, string> = {
      response_format: `${providerLabel} 回應格式無效，沒有可用的正式文字答案。`,
      model_mismatch: `${providerLabel} 回傳的模型與選擇不一致，請重新讀取模型清單。`,
      generation_incomplete: `${providerLabel} 測試未完成正式文字答案，請稍後重試。`
    }
    return diagnostic(error.category, messages[error.category], {}, error.stage)
  }
  if (
    error instanceof Error &&
    error.message.includes('回應中沒有文字內容')
  ) {
    return diagnostic(
      'generation_incomplete',
      `${providerLabel} 金鑰可連線，但測試模型沒有返回文字，請稍後重試。`
    )
  }
  if (error instanceof TypeError || error instanceof RangeError) {
    return diagnostic('network', '網路連線失敗，請檢查網路後重試。', {
      retryable: true
    })
  }
  return diagnostic('unknown', `${providerLabel} 金鑰測試發生未知錯誤。`)
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
