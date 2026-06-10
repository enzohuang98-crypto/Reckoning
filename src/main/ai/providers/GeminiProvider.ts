/**
 * Gemini Provider（stub）
 *
 * 架構保留介面，MVP 尚未實作真實呼叫。
 * 之後可改用 @google/generative-ai SDK，套用相同的 promptBuilder 與護欄規則。
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

export class GeminiProvider implements AIProvider {
  readonly id = 'gemini' as const
  readonly displayName = 'Google Gemini'

  private readonly config: AIProviderConfig

  constructor(config: AIProviderConfig) {
    this.config = config
  }

  listModels(): AIModelInfo[] {
    return PROVIDER_DEFAULT_MODELS.gemini
  }

  isConfigured(): boolean {
    return this.config.apiKey.length > 0 && this.config.model.length > 0
  }

  async generateExplanation(
    _request: AIExplanationRequest
  ): Promise<AIExplanationResponse> {
    throw new Error('GeminiProvider 尚未實作（MVP 為 stub）。')
  }
}
