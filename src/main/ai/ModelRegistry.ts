/**
 * 模型註冊表 (ModelRegistry) — SDS v0.2 §2.19
 *
 * 模型 id 白名單的唯一查詢入口。
 * getModel() 找不到時丟 UnsupportedModelError（對應 IPC code "unsupported_model"）。
 */

import catalog from '@shared/config/model_catalog.json'
import { isValidModelConfig } from '@shared/logic/ValidationUtils'
import type { AIProviderId } from '@shared/types/AIProviderTypes'

/** 模型設定 */
export interface AIModelConfig {
  provider: AIProviderId
  model: string
  displayName: string
}

export class UnsupportedModelError extends Error {
  constructor(
    public readonly provider: AIProviderId,
    public readonly model: string
  ) {
    super(`Unsupported model: ${provider}/${model}`)
    this.name = 'UnsupportedModelError'
  }
}

/** 各 Provider 預設模型（§2.19.4：anthropic 無使用者設定時用 claude-sonnet-4-6） */
const DEFAULT_MODEL_BY_PROVIDER: Record<AIProviderId, string> = {
  anthropic: 'claude-sonnet-4-6',
  openai: 'gpt-5.4',
  gemini: 'gemini-3.5-flash'
}

/** 介面（§2.19.1） */
export interface ModelRegistry {
  getModel(provider: AIProviderId, model: string): AIModelConfig
  hasModel(provider: AIProviderId, model: string): boolean
  listModels(provider?: AIProviderId): AIModelConfig[]
  getDefaultModel(provider: AIProviderId): AIModelConfig
}

class JsonModelRegistry implements ModelRegistry {
  private readonly models: AIModelConfig[]

  constructor(models: AIModelConfig[]) {
    this.models = models.filter(isValidModelConfig)
  }

  getModel(provider: AIProviderId, model: string): AIModelConfig {
    const found = this.models.find((m) => m.provider === provider && m.model === model)
    if (!found) throw new UnsupportedModelError(provider, model)
    return found
  }

  hasModel(provider: AIProviderId, model: string): boolean {
    return this.models.some((m) => m.provider === provider && m.model === model)
  }

  listModels(provider?: AIProviderId): AIModelConfig[] {
    return provider === undefined
      ? [...this.models]
      : this.models.filter((m) => m.provider === provider)
  }

  getDefaultModel(provider: AIProviderId): AIModelConfig {
    return this.getModel(provider, DEFAULT_MODEL_BY_PROVIDER[provider])
  }
}

/** 由 model_catalog.json 建立的單例 registry */
export const modelRegistry: ModelRegistry = new JsonModelRegistry(
  catalog.models as AIModelConfig[]
)
