/**
 * Anthropic Provider（完整實作）
 *
 * 使用 @anthropic-ai/sdk 呼叫 Claude 模型，將結構化引擎資料轉成人類解說。
 * 預設模型：claude-sonnet-4-6（預設）、claude-opus-4-8。
 */

import Anthropic from '@anthropic-ai/sdk'
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

export class AnthropicProvider implements AIProvider {
  readonly id = 'anthropic' as const
  readonly displayName = 'Anthropic Claude'

  private readonly config: AIProviderConfig
  private readonly client: Anthropic

  constructor(config: AIProviderConfig) {
    this.config = config
    this.client = new Anthropic({ apiKey: config.apiKey, baseURL: config.baseUrl })
  }

  listModels(): AIModelInfo[] {
    return PROVIDER_DEFAULT_MODELS.anthropic
  }

  isConfigured(): boolean {
    return this.config.apiKey.length > 0 && this.config.model.length > 0
  }

  async generateExplanation(
    request: AIExplanationRequest
  ): Promise<AIExplanationResponse> {
    const language = request.language ?? 'zh-TW'
    const model = request.model || this.config.model

    const message = await this.client.messages.create({
      model,
      max_tokens: this.config.maxTokens ?? 1024,
      temperature: this.config.temperature ?? 0.3,
      system: buildSystemPrompt(language),
      messages: [{ role: 'user', content: buildUserPrompt(request) }]
    })

    const text = message.content
      .filter((block): block is Anthropic.TextBlock => block.type === 'text')
      .map((block) => block.text)
      .join('\n')
      .trim()

    const usage = {
      inputTokens: message.usage.input_tokens,
      outputTokens: message.usage.output_tokens
    }

    return {
      text,
      provider: this.id,
      model,
      usage,
      costUsd: estimateCost(model, usage),
      createdAt: Date.now(),
      groundedOnEngineData: true
    }
  }
}
