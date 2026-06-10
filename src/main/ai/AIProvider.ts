/**
 * AI Provider 工廠 (Provider factory)
 *
 * 依 providerId 與設定建立對應的 Provider 實例。
 * 第一版完整實作 Anthropic；OpenAI / Gemini 為 stub。
 */

import type { AIProvider, AIProviderConfig, AIProviderId } from '@shared/types/AIProviderTypes'
import { AnthropicProvider } from './providers/AnthropicProvider'
import { OpenAIProvider } from './providers/OpenAIProvider'
import { GeminiProvider } from './providers/GeminiProvider'

export function createProvider(
  providerId: AIProviderId,
  config: AIProviderConfig
): AIProvider {
  switch (providerId) {
    case 'anthropic':
      return new AnthropicProvider(config)
    case 'openai':
      return new OpenAIProvider(config)
    case 'gemini':
      return new GeminiProvider(config)
    default: {
      const _exhaustive: never = providerId
      throw new Error(`未知的 Provider：${String(_exhaustive)}`)
    }
  }
}

export { AnthropicProvider, OpenAIProvider, GeminiProvider }
