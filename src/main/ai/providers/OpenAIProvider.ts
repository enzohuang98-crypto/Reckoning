/**
 * OpenAI Provider（真實實作）
 *
 * 以內建 fetch 呼叫 Chat Completions API（不引入 SDK，減少相依）。
 * 套用與 Anthropic 相同的 promptBuilder 與護欄規則。
 */

import type {
  AIProvider,
  AIModelInfo,
  AIProviderConfig
} from '@shared/types/AIProviderTypes'
import { PROVIDER_DEFAULT_MODELS } from '@shared/types/AIProviderTypes'
import type {
  AIExplanationRequest,
  AIExplanationResponse
} from '@shared/types/AIExplanationTypes'
import { buildSystemPrompt, buildUserPrompt } from '../promptBuilder'
import { estimateCost } from '../cost'
import { extractApiErrorMessage } from '../http'

const DEFAULT_BASE_URL = 'https://api.openai.com/v1'

/** Chat Completions 回應中本實作會使用的欄位 */
interface OpenAIChatResponse {
  choices?: Array<{ message?: { content?: string | null } }>
  usage?: { prompt_tokens?: number; completion_tokens?: number }
}

export class OpenAIProvider implements AIProvider {
  readonly id = 'openai' as const
  readonly displayName = 'OpenAI'

  private readonly config: AIProviderConfig

  constructor(config: AIProviderConfig) {
    this.config = config
  }

  listModels(): AIModelInfo[] {
    return PROVIDER_DEFAULT_MODELS.openai
  }

  isConfigured(): boolean {
    return this.config.apiKey.length > 0 && this.config.model.length > 0
  }

  async generateExplanation(
    request: AIExplanationRequest
  ): Promise<AIExplanationResponse> {
    const language = request.language ?? 'zh-TW'
    const model = request.model || this.config.model
    const baseUrl = (this.config.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, '')

    const res = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${this.config.apiKey}`
      },
      body: JSON.stringify({
        model,
        max_tokens: this.config.maxTokens ?? 1024,
        temperature: this.config.temperature ?? 0.3,
        messages: [
          { role: 'system', content: buildSystemPrompt(language) },
          { role: 'user', content: buildUserPrompt(request) }
        ]
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
      model,
      usage,
      costUsd: usage ? estimateCost(model, usage) : undefined,
      createdAt: Date.now(),
      groundedOnEngineData: true
    }
  }
}
