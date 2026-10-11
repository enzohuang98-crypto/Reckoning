export const OPENROUTER_NEMOTRON_ULTRA_FREE_MODEL =
  'nvidia/nemotron-3-ultra-550b-a55b:free'
export const OPENROUTER_NEMOTRON_SUPER_FREE_MODEL =
  'nvidia/nemotron-3-super-120b-a12b:free'
export const OPENROUTER_DOTS_NOTE_FREE_MODEL = 'dots-studio/dots-3-note-preview:free'
export const OPENROUTER_QWEN38_FREE_MODEL = 'qwen/qwen3.8-27b:free'
export const OPENROUTER_NEMOTRON_JSON_REASONING_MAX_TOKENS = 1_000

export interface OpenRouterReasoningConfig {
  max_tokens?: number
  effort?: 'none' | 'low'
  enabled?: false
  exclude: true
}

export function openRouterReasoningConfig(
  model: string,
  responseFormat: 'json' | 'text',
  maxOutputTokens = 4_096
): OpenRouterReasoningConfig | undefined {
  if (model === OPENROUTER_QWEN38_FREE_MODEL) {
    // This exact free endpoint advertises optional thinking, but no hard
    // reasoning-token budget. Both xhigh and low formal fixed cases used all
    // 6,000 output tokens reasoning and returned empty content with length
    // (2026-10-03). Disable its optional thinking to preserve visible-output
    // room; exclude alone cannot do this. Harness caps/validation stay intact.
    return { enabled: false, exclude: true }
  }
  if (model === OPENROUTER_NEMOTRON_SUPER_FREE_MODEL) {
    // The catalog marks reasoning as optional. Live fixed-case calls returned
    // 3,877 tokens with max_tokens: 1,000 and 3,822 with effort: low, exhausting
    // the 4,000-token response budget. Text question recovery also consumed
    // 890 of 1,200 tokens in reasoning and ended with length on 2026-09-30.
    // The same exact endpoint supports effort=none for both output formats.
    return { effort: 'none', exclude: true }
  }
  if (responseFormat !== 'json') return undefined
  if (model === OPENROUTER_DOTS_NOTE_FREE_MODEL) {
    // This exact free endpoint advertises optional reasoning. Its live formal
    // JSON case ended with length at 6,000 tokens; enabled=false finished both
    // bounded JSON calls at 2,074/2,140 tokens with zero reasoning. This only
    // protects the visible-output budget; local chess validation is unchanged.
    return { enabled: false, exclude: true }
  }
  if (model !== OPENROUTER_NEMOTRON_ULTRA_FREE_MODEL) return undefined
  // Ultra's exact free metadata advertises supports_max_tokens=true. Planner
  // JSON has a smaller total allowance than the full writer; reasoning shares
  // that allowance. Retain visible output room without enlarging either cap.
  return {
    max_tokens: Math.min(OPENROUTER_NEMOTRON_JSON_REASONING_MAX_TOKENS,
      Math.max(1, Math.floor(maxOutputTokens / 4))),
    exclude: true
  }
}
