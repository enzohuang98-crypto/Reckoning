export const OPENROUTER_NEMOTRON_ULTRA_FREE_MODEL =
  'nvidia/nemotron-3-ultra-550b-a55b:free'
export const OPENROUTER_NEMOTRON_SUPER_FREE_MODEL =
  'nvidia/nemotron-3-super-120b-a12b:free'
export const OPENROUTER_NEMOTRON_JSON_REASONING_MAX_TOKENS = 1_000

export interface OpenRouterReasoningConfig {
  max_tokens?: number
  effort?: 'none'
  exclude: true
}

export function openRouterReasoningConfig(
  model: string,
  responseFormat: 'json' | 'text'
): OpenRouterReasoningConfig | undefined {
  if (responseFormat !== 'json') return undefined
  if (model === OPENROUTER_NEMOTRON_SUPER_FREE_MODEL) {
    // The catalog marks reasoning as optional. Live fixed-case calls returned
    // 3,877 tokens with max_tokens: 1,000 and 3,822 with effort: low, exhausting
    // the 4,000-token response budget. Request reasoning off explicitly.
    return { effort: 'none', exclude: true }
  }
  if (model !== OPENROUTER_NEMOTRON_ULTRA_FREE_MODEL) return undefined
  return {
    max_tokens: OPENROUTER_NEMOTRON_JSON_REASONING_MAX_TOKENS,
    exclude: true
  }
}
