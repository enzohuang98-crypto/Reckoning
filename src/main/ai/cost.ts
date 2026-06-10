/**
 * 成本估算 (Cost estimation)
 *
 * 依 shared/config/model_pricing.json 估算單次呼叫成本 (USD)。
 */

import pricing from '@shared/config/model_pricing.json'
import type { TokenUsage } from '@shared/types/AIProviderTypes'

interface ModelPrice {
  provider: string
  input: number
  output: number
}

const models = pricing.models as Record<string, ModelPrice>

/** 估算成本 (USD)。找不到模型時回傳 undefined。 */
export function estimateCost(model: string, usage: TokenUsage): number | undefined {
  const price = models[model]
  if (!price) return undefined
  const inputCost = (usage.inputTokens / 1_000_000) * price.input
  const outputCost = (usage.outputTokens / 1_000_000) * price.output
  return Math.round((inputCost + outputCost) * 1_000_000) / 1_000_000
}

export const pricingMeta = {
  lastUpdated: pricing.lastUpdated as string,
  sourceNote: pricing.sourceNote as string
}
