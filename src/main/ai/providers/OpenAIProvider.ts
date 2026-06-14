/**
 * OpenAI Provider — SDS v0.2 §2.17.4、§2.17.8
 *
 * 無狀態 adapter：API key 與 prompt 由 AIExplanationRequest 帶入。
 * 以內建 fetch 呼叫 Chat Completions API（不引入 SDK，減少相依）。
 * streaming 介面為包裝模式（§2.17.1）：等完整回應後以單一 text_delta 回傳。
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

const DEFAULT_BASE_URL = 'https://api.openai.com/v1'
const MAX_OUTPUT_TOKENS = 4096

/** Chat Completions 回應中本實作會使用的欄位 */
interface OpenAIChatResponse {
  choices?: Array<{ message?: { content?: string | null } }>
  usage?: { prompt_tokens?: number; completion_tokens?: number }
}

export class OpenAIProvider implements AIProvider {
  readonly id = 'openai' as const
  readonly displayName = 'OpenAI'

  constructor(private readonly options: { baseUrl?: string } = {}) {}

  async generateExplanation(
    request: AIExplanationRequest,
    signal?: AbortSignal
  ): Promise<AIExplanationResponse> {
    const baseUrl = (this.options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, '')

    const res = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      signal,
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${request.apiKey}`
      },
      body: JSON.stringify({
        model: request.model,
        max_tokens: request.maxOutputTokens ?? MAX_OUTPUT_TOKENS,
        temperature: 0.3,
        messages: [{ role: 'user', content: request.prompt }]
      })
    })

    if (!res.ok) {
      throw new Error(`OpenAI API 錯誤 (${res.status})：${await extractApiErrorMessage(res)}`)
    }

    const data = (await res.json()) as OpenAIChatResponse
    const text = data.choices?.[0]?.message?.content?.trim()
    if (!text) {
      throw new Error('OpenAI 回應中沒有文字內容。')
    }

    const usage = data.usage
      ? {
          inputTokens: data.usage.prompt_tokens ?? 0,
          outputTokens: data.usage.completion_tokens ?? 0
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
