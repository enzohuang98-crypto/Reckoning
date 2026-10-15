import type { AIModelCapabilities } from '@shared/types/AIProviderTypes'

/** 推理無法關閉時，額外預留給思考的 tokens，避免正文被推理吃光。 */
export const MANDATORY_REASONING_EXTRA_TOKENS = 3_000

export type OpenRouterReasoningMode = 'auto' | 'off_strict'

export interface OpenRouterRequestPolicyInput {
  capabilities: AIModelCapabilities | null
  responseFormat?: 'text' | 'json'
  /** 給正式答案的可見 tokens。 */
  visibleTokens: number
  reasoningMode?: OpenRouterReasoningMode
}

export interface OpenRouterRequestOptions {
  max_tokens: number
  reasoning?: { effort?: string; enabled?: boolean; exclude: true }
  response_format?: { type: 'json_object' }
}

const EFFORT_ORDER = ['none', 'minimal', 'low', 'medium', 'high', 'xhigh']

function lowestEffort(efforts: readonly string[] | undefined): string {
  const known = (efforts ?? []).filter((effort) => EFFORT_ORDER.includes(effort))
  known.sort((left, right) => EFFORT_ORDER.indexOf(left) - EFFORT_ORDER.indexOf(right))
  return known[0] ?? 'low'
}

/**
 * 依模型能力組 OpenRouter 請求參數（純函式）。
 * - 能力未知：不帶 reasoning，避免送出模型不支援的參數。
 * - 支援推理：一律要求關閉（auto 用 effort:none；off_strict 或清單不含 none 用 enabled:false）。
 * - 推理無法關閉：用最低強度，並把 max_tokens 加上推理額度。
 * - max_tokens 不超過模型回報的輸出上限。
 */
export function buildOpenRouterRequestOptions(
  input: OpenRouterRequestPolicyInput
): OpenRouterRequestOptions {
  const capabilities = input.capabilities
  let maxTokens = Math.max(1, Math.round(input.visibleTokens))
  let reasoning: OpenRouterRequestOptions['reasoning']
  if (capabilities?.supportsReasoning) {
    if (capabilities.reasoningMandatory) {
      reasoning = { effort: lowestEffort(capabilities.reasoningEfforts), exclude: true }
      maxTokens += MANDATORY_REASONING_EXTRA_TOKENS
    } else if (
      input.reasoningMode === 'off_strict' ||
      (capabilities.reasoningEfforts !== undefined &&
        !capabilities.reasoningEfforts.includes('none'))
    ) {
      reasoning = { enabled: false, exclude: true }
    } else {
      reasoning = { effort: 'none', exclude: true }
    }
  }
  if (capabilities?.maxCompletionTokens && capabilities.maxCompletionTokens > 0) {
    maxTokens = Math.min(maxTokens, capabilities.maxCompletionTokens)
  }
  return {
    max_tokens: maxTokens,
    ...(reasoning ? { reasoning } : {}),
    ...(input.responseFormat === 'json' && capabilities?.supportsResponseFormat !== false
      ? { response_format: { type: 'json_object' as const } }
      : {})
  }
}
