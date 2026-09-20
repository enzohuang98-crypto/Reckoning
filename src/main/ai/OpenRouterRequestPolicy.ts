export const OPENROUTER_NEMOTRON_ULTRA_FREE_MODEL =
  'nvidia/nemotron-3-ultra-550b-a55b:free'
export const OPENROUTER_NEMOTRON_SUPER_FREE_MODEL =
  'nvidia/nemotron-3-super-120b-a12b:free'
export const OPENROUTER_NEMOTRON_JSON_REASONING_MAX_TOKENS = 1_000

export interface OpenRouterReasoningConfig {
  max_tokens: number
  exclude: true
}

export function openRouterReasoningConfig(
  model: string,
  responseFormat: 'json' | 'text'
): OpenRouterReasoningConfig | undefined {
  if (
    responseFormat !== 'json' ||
    (model !== OPENROUTER_NEMOTRON_ULTRA_FREE_MODEL &&
      model !== OPENROUTER_NEMOTRON_SUPER_FREE_MODEL)
  ) {
    return undefined
  }
  return {
    max_tokens: OPENROUTER_NEMOTRON_JSON_REASONING_MAX_TOKENS,
    exclude: true
  }
}
