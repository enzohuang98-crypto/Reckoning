import type {
  AIExplanationStreamChunk,
  AIProvider
} from '@shared/types/AIProviderTypes'
import type {
  AIExplanationRequest,
  AIExplanationResponse
} from '@shared/types/AIExplanationTypes'
import { extractApiErrorMessage, readJsonResponseBounded } from '../http'

interface CompatibleChatResponse {
  choices?: Array<{
    message?: {
      content?: string | null
      reasoning_content?: string | null
    }
  }>
  usage?: {
    prompt_tokens?: number
    completion_tokens?: number
    input_tokens?: number
    output_tokens?: number
  }
}

function chatEndpoint(baseUrl: string): string {
  const normalized = baseUrl.replace(/\/+$/, '')
  return normalized.endsWith('/chat/completions')
    ? normalized
    : `${normalized}/chat/completions`
}

function redactExactSecret(value: string, secret: string): string {
  return secret ? value.replaceAll(secret, '[REDACTED]') : value
}

/**
 * DeepSeek、Kimi、xAI、Ollama、LM Studio 與其他 Chat Completions 相容服務共用。
 * Base URL 已在 main process 的 InputValidation 驗證；此 adapter 不接受任意 renderer URL。
 */
export class OpenAICompatibleProvider implements AIProvider {
  readonly id = 'openai-compatible' as const
  readonly displayName = 'OpenAI 相容／本機模型'

  async generateExplanation(
    request: AIExplanationRequest,
    signal?: AbortSignal
  ): Promise<AIExplanationResponse> {
    if (!request.baseUrl) throw new Error('OpenAI-compatible 端點尚未設定。')
    const headers: Record<string, string> = {
      'content-type': 'application/json'
    }
    if (request.apiKey) headers.authorization = `Bearer ${request.apiKey}`

    const res = await fetch(chatEndpoint(request.baseUrl), {
      method: 'POST',
      signal,
      headers,
      body: JSON.stringify({
        model: request.model,
        max_tokens: request.maxOutputTokens ?? 4096,
        temperature: 0.2,
        stream: false,
        messages: [{ role: 'user', content: request.prompt }]
      })
    })
    if (!res.ok) {
      const detail = redactExactSecret(
        await extractApiErrorMessage(res),
        request.apiKey
      )
      throw new Error(
        `OpenAI-compatible API 錯誤 (${res.status})：${detail}`
      )
    }
    const data = await readJsonResponseBounded<CompatibleChatResponse>(res)
    const message = data.choices?.[0]?.message
    const text = (message?.content ?? message?.reasoning_content ?? '').trim()
    if (!text) throw new Error('OpenAI-compatible 回應中沒有文字內容。')
    const usage = data.usage
      ? {
          inputTokens:
            data.usage.prompt_tokens ?? data.usage.input_tokens ?? 0,
          outputTokens:
            data.usage.completion_tokens ?? data.usage.output_tokens ?? 0
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
