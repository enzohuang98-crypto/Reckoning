/**
 * Google Gemini Provider — SDS v0.2 §2.17.8
 *
 * 無狀態 adapter：API key 與 prompt 由 AIExplanationRequest 帶入。
 * 以內建 fetch 呼叫 generateContent REST API（不引入 SDK，減少相依）。
 */

import type {
  AIProvider,
  AIExplanationStreamChunk,
  AITestCredentialResult
} from '@shared/types/AIProviderTypes'
import type {
  AIExplanationRequest,
  AIExplanationResponse
} from '@shared/types/AIExplanationTypes'
import {
  CREDENTIAL_TEST_TIMEOUT_MS,
  aiErrorStatus,
  describeCredentialTestError,
  extractApiErrorMessage,
  fetchAiResponseBounded,
  readJsonResponseBounded
} from '../http'

const DEFAULT_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta'
const MAX_OUTPUT_TOKENS = 4096
/** 模型清單只驗證認證與能力，不應等待一次完整文字生成。 */
export const GEMINI_CREDENTIAL_TEST_TIMEOUT_MS = CREDENTIAL_TEST_TIMEOUT_MS
const GEMINI_SERVICE_RETRY_DELAYS_MS = [500, 1_000] as const

function waitForRetry(delayMs: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) {
    return Promise.reject(new DOMException('Request cancelled', 'AbortError'))
  }
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort)
      resolve()
    }, delayMs)
    const onAbort = (): void => {
      clearTimeout(timer)
      reject(new DOMException('Request cancelled', 'AbortError'))
    }
    signal.addEventListener('abort', onAbort, { once: true })
  })
}

/** generateContent 回應中本實作會使用的欄位 */
interface GeminiGenerateContentResponse {
  candidates?: Array<{
    content?: { parts?: Array<{ text?: string; thought?: boolean }> }
    finishReason?: string
  }>
  promptFeedback?: { blockReason?: string }
  usageMetadata?: {
    promptTokenCount?: number
    candidatesTokenCount?: number
    thoughtsTokenCount?: number
  }
}

class GeminiEmptyResponseError extends Error {
  constructor(
    readonly finishReason: string | undefined,
    readonly blockReason: string | undefined,
    readonly thoughtsTokenCount: number
  ) {
    super('Gemini 回應中沒有文字內容。')
    this.name = 'GeminiEmptyResponseError'
  }
}

interface GeminiModelsResponse {
  models?: Array<{
    name?: string
    supportedGenerationMethods?: string[]
  }>
}

export class GeminiProvider implements AIProvider {
  readonly id = 'gemini' as const
  readonly displayName = 'Google Gemini'

  constructor(private readonly options: { baseUrl?: string } = {}) {}

  async generateExplanation(
    request: AIExplanationRequest,
    signal?: AbortSignal
  ): Promise<AIExplanationResponse> {
    const baseUrl = (this.options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, '')
    const thinkingOptions = /^gemini-3(?:[.-]|$)/.test(request.model)
      ? {
          // Gemini 3 uses thinkingLevel. Earlier thinking models use a
          // different contract, so do not send a 3.x-only field to them.
          thinkingConfig: {
            thinkingLevel: 'low',
            includeThoughts: false
          }
        }
      : {}

    const res = await fetch(
      `${baseUrl}/models/${encodeURIComponent(request.model)}:generateContent`,
      {
        method: 'POST',
        redirect: 'error',
        signal,
        headers: {
          'content-type': 'application/json',
          // 金鑰走 header，不放 URL query（避免進入日誌；§2.11）
          'x-goog-api-key': request.apiKey
        },
        body: JSON.stringify({
          contents: [{ role: 'user', parts: [{ text: request.prompt }] }],
          generationConfig: {
            maxOutputTokens: request.maxOutputTokens ?? MAX_OUTPUT_TOKENS,
            ...(!/^gemini-3(?:[.-]|$)/.test(request.model)
              ? { temperature: 0.3 }
              : {}),
            // Gemini 3.5 Flash defaults to medium thinking. Harness already
            // separates planning, validation and repair into explicit calls,
            // so low thinking preserves reasoning while reducing UI latency.
            ...thinkingOptions,
            ...(request.responseFormat === 'json'
              ? {
                  // generateContent still accepts the stable legacy field even
                  // when the newer responseFormat shape is not rolled out for
                  // a given v1beta endpoint. A real gemini-3.5-flash request
                  // returned HTTP 400 for responseFormat.text.mimeType, while
                  // responseMimeType is supported by the same endpoint.
                  responseMimeType: 'application/json'
                }
              : {})
          }
        })
      }
    )

    if (!res.ok) {
      throw new Error(`Gemini API 錯誤 (${res.status})：${await extractApiErrorMessage(res)}`)
    }

    const data = await readJsonResponseBounded<GeminiGenerateContentResponse>(res)
    const candidate = data.candidates?.[0]
    const text = candidate?.content?.parts
      ?.filter((part) => !part.thought)
      ?.map((part) => part.text ?? '')
      .join('\n')
      .trim()
    if (!text) {
      throw new GeminiEmptyResponseError(
        candidate?.finishReason,
        data.promptFeedback?.blockReason,
        data.usageMetadata?.thoughtsTokenCount ?? 0
      )
    }

    const usage = data.usageMetadata
      ? {
          inputTokens: data.usageMetadata.promptTokenCount ?? 0,
          outputTokens:
            (data.usageMetadata.candidatesTokenCount ?? 0) +
            (data.usageMetadata.thoughtsTokenCount ?? 0)
        }
      : undefined

    return {
      text,
      provider: this.id,
      model: request.model,
      usage,
      createdAt: Date.now(),
      groundedOnEngineData: true
    }
  }

  /** streaming 介面為包裝模式（§2.17.1）：等完整回應後以單一 text_delta 回傳 */
  async *generateExplanationStream(
    request: AIExplanationRequest,
    signal: AbortSignal
  ): AsyncIterable<AIExplanationStreamChunk> {
    const response = await this.generateExplanation(request, signal)
    if (signal.aborted) throw new DOMException('Request cancelled', 'AbortError')
    yield { type: 'text_delta', deltaText: response.text }
    yield { type: 'done', usage: response.usage }
  }

  async listModels(
    apiKey: string,
    timeoutMs = CREDENTIAL_TEST_TIMEOUT_MS
  ): Promise<string[]> {
    const baseUrl = (this.options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, '')
    const signal = AbortSignal.timeout(timeoutMs)
    let retryCount = 0
    while (true) {
      try {
        const response = await fetchAiResponseBounded(`${baseUrl}/models?pageSize=1000`, {
          method: 'GET',
          signal,
          headers: { 'x-goog-api-key': apiKey }
        })
        if (!response.ok) {
          throw new Error(`Gemini models API 錯誤 (${response.status})`)
        }
        const body = await readJsonResponseBounded<GeminiModelsResponse>(response)
        return (body.models ?? [])
          .filter((model) => model.supportedGenerationMethods?.includes('generateContent'))
          .map((model) => model.name?.trim() ?? '')
          .filter(Boolean)
      } catch (error) {
        const status = aiErrorStatus(error)
        const transient =
          error instanceof TypeError ||
          status === 408 ||
          status === 429 ||
          (typeof status === 'number' && status >= 500)
        if (!transient || retryCount >= GEMINI_SERVICE_RETRY_DELAYS_MS.length) {
          throw error
        }
        const delayMs = GEMINI_SERVICE_RETRY_DELAYS_MS[retryCount]
        retryCount += 1
        await waitForRetry(delayMs, signal)
      }
    }
  }

  async testCredential(
    apiKey: string,
    model: string,
    _baseUrlOverride?: string,
    timeoutMs = GEMINI_CREDENTIAL_TEST_TIMEOUT_MS
  ): Promise<AITestCredentialResult> {
    try {
      const availableModels = await this.listModels(apiKey, timeoutMs)
      const normalizedModel = model.replace(/^models\//, '')
      const modelAvailable = availableModels.some(
        (available) => available.replace(/^models\//, '') === normalizedModel
      )
      if (!modelAvailable) {
        return {
          ok: false,
          message: `Gemini 金鑰可連線，但模型 ${normalizedModel} 不在這把金鑰可用的文字生成模型清單中。`
        }
      }
      return {
        ok: true,
        message: `Google Gemini · ${normalizedModel} 已通過官方模型清單與 generateContent 能力驗證。`
      }
    } catch (error) {
      return describeCredentialTestError(error, 'Gemini')
    }
  }
}
