/**
 * Google Gemini Provider — SDS v0.2 §2.17.8
 *
 * 無狀態 adapter：API key 與 prompt 由 AIExplanationRequest 帶入。
 * 以內建 fetch 呼叫 generateContent REST API（不引入 SDK，減少相依）。
 */

import type {
  AIProvider,
  AIExplanationStreamChunk
} from '@shared/types/AIProviderTypes'
import type {
  AIExplanationRequest,
  AIExplanationResponse
} from '@shared/types/AIExplanationTypes'
import { extractApiErrorMessage } from '../http'

const DEFAULT_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta'
const MAX_OUTPUT_TOKENS = 4096

/** generateContent 回應中本實作會使用的欄位 */
interface GeminiGenerateContentResponse {
  candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>
  usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number }
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

    const res = await fetch(
      `${baseUrl}/models/${encodeURIComponent(request.model)}:generateContent`,
      {
        method: 'POST',
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
            temperature: 0.3
          }
        })
      }
    )

    if (!res.ok) {
      throw new Error(`Gemini API 錯誤 (${res.status})：${await extractApiErrorMessage(res)}`)
    }

    const data = (await res.json()) as GeminiGenerateContentResponse
    const text = data.candidates?.[0]?.content?.parts
      ?.map((part) => part.text ?? '')
      .join('\n')
      .trim()
    if (!text) {
      throw new Error('Gemini 回應中沒有文字內容。')
    }

    const usage = data.usageMetadata
      ? {
          inputTokens: data.usageMetadata.promptTokenCount ?? 0,
          outputTokens: data.usageMetadata.candidatesTokenCount ?? 0
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
}
