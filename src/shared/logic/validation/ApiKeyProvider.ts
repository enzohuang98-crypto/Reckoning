import type { AIProviderId } from '../../types/AIProviderTypes'

export interface DetectedApiKey {
  provider: AIProviderId
  normalizedKey: string
}

/**
 * 官方 Provider 已知的金鑰前綴；openai-compatible 沒有固定格式
 * （DeepSeek/Kimi/xAI/Ollama/LM Studio 等各自不同），故不設限制。
 * openai 用負向前瞻排除 sk-ant-，避免誤放行貼錯欄位的 Anthropic 金鑰。
 */
const GEMINI_KEY_PATTERN = /^(?:AIza|AQ\.)/

const PROVIDER_KEY_PATTERNS: Partial<Record<AIProviderId, RegExp>> = {
  anthropic: /^sk-ant-/,
  gemini: GEMINI_KEY_PATTERN,
  openrouter: /^sk-or-v1-/,
  openai: /^sk-(?!(?:ant-|or-v1-))/
}

/**
 * 依官方常見金鑰前綴辨識 Provider。
 * 金鑰本身不會離開呼叫端；此函式只回傳 Provider 與 trim 後的字串。
 */
export function detectApiKeyProvider(
  value: string,
  preferredProvider?: AIProviderId
): DetectedApiKey | null {
  const normalizedKey = value.trim()
  if (preferredProvider) {
    if (!normalizedKey) return null
    const pattern = PROVIDER_KEY_PATTERNS[preferredProvider]
    if (pattern && !pattern.test(normalizedKey)) return null
    return { provider: preferredProvider, normalizedKey }
  }
  if (normalizedKey.startsWith('sk-ant-')) {
    return { provider: 'anthropic', normalizedKey }
  }
  if (GEMINI_KEY_PATTERN.test(normalizedKey)) {
    return { provider: 'gemini', normalizedKey }
  }
  if (normalizedKey.startsWith('sk-or-v1-')) {
    return { provider: 'openrouter', normalizedKey }
  }
  if (normalizedKey.startsWith('sk-')) {
    return { provider: 'openai', normalizedKey }
  }
  return null
}
