/**
 * AI Provider 工廠 (getAIProvider) — SDS v0.2 §2.17.8
 *
 * 只依 provider 名稱回傳對應 adapter：不讀 API key、不呼叫 PromptBuilder、
 * 不讀寫 AppSettings、不碰 UI、不決定 fallback model。
 * Provider 為無狀態單例。
 */

import type { AIProvider, AIProviderId } from '@shared/types/AIProviderTypes'
import { AnthropicProvider } from './providers/AnthropicProvider'
import { OpenAIProvider } from './providers/OpenAIProvider'
import { GeminiProvider } from './providers/GeminiProvider'

const anthropicProvider = new AnthropicProvider()
const openAIProvider = new OpenAIProvider()
const geminiProvider = new GeminiProvider()

export function getAIProvider(providerName: AIProviderId): AIProvider {
  switch (providerName) {
    case 'anthropic':
      return anthropicProvider
    case 'openai':
      return openAIProvider
    case 'gemini':
      return geminiProvider
    default: {
      const _exhaustive: never = providerName
      throw new Error(`Unsupported AI provider: ${String(_exhaustive)}`)
    }
  }
}

export { AnthropicProvider, OpenAIProvider, GeminiProvider }
