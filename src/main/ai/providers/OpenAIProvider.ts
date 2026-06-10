/**
 * OpenAI Provider（stub）
 *
 * 架構保留介面，MVP 尚未實作真實呼叫。
 * 之後可改用 openai SDK，套用相同的 promptBuilder 與護欄規則。
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
    _request: AIExplanationRequest
  ): Promise<AIExplanationResponse> {
    throw new Error('OpenAIProvider 尚未實作（MVP 為 stub）。')
  }
}
