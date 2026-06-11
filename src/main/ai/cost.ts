/**
 * 成本估算 (TokenCostEstimator) — SDS v0.2 §2.19
 *
 * 與 ModelRegistry 讀同一份 model_pricing.json（§2.19.4）。
 * 若價格缺失，回傳 undefined（UI 顯示「無法估算」，不得亂填）。
 */

import type { TokenUsage } from '@shared/types/AIProviderTypes'
import { modelRegistry } from './ModelRegistry'

export { pricingMeta } from './ModelRegistry'

/** 估算成本 (USD)。找不到模型定價時回傳 undefined。 */
export function estimateCost(model: string, usage: TokenUsage): number | undefined {
  const config = modelRegistry.listModels().find((m) => m.model === model)
  if (!config) return undefined
  const inputCost = (usage.inputTokens / 1_000_000) * config.pricing.inputPricePerMillionTokens
  const outputCost =
    (usage.outputTokens / 1_000_000) * config.pricing.outputPricePerMillionTokens
  return Math.round((inputCost + outputCost) * 1_000_000) / 1_000_000
}
