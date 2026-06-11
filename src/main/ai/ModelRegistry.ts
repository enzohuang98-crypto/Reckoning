/**
 * 模型註冊表 (ModelRegistry) — SDS v0.2 §2.19
 *
 * 模型 id 與定價的唯一查詢入口。與 TokenCostEstimator（cost.ts）讀同一份
 * model_pricing.json，不得各自寫死價格（§2.19.4）。
 * getModel() 找不到時丟 UnsupportedModelError（對應 IPC code "unsupported_model"）。
 */

import pricing from '@shared/config/model_pricing.json'
import type { AIProviderId } from '@shared/types/AIProviderTypes'

/** 定價（§2.19.1） */
export interface ModelPricing {
  inputPricePerMillionTokens: number
  outputPricePerMillionTokens: number
  currency: 'USD'
}

/** 模型設定（§2.19.1） */
export interface AIModelConfig {
  provider: AIProviderId
  /** 實際 API 呼叫使用的 model id */
  model: string
  /** UI 顯示名稱 */
  displayName: string
  pricing: ModelPricing
  /** 分層定價等備註 */
  contextNote?: string
  /** 官方核對日期 (ISO) */
  lastUpdated: string
  /** 官方定價頁來源 */
  sourceNote: string
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
    this.models = models
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

/** 由 model_pricing.json 建立的單例 registry */
export const modelRegistry: ModelRegistry = new JsonModelRegistry(
  pricing.models as AIModelConfig[]
)

export const pricingMeta = {
  lastUpdated: pricing.lastUpdated as string,
  sourceNote: pricing.sourceNote as string
}
