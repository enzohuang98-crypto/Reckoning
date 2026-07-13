import type { AIProviderId } from '../../types/AIProviderTypes'

export interface DetectedApiKey {
  provider: AIProviderId
  normalizedKey: string
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
    return normalizedKey
      ? { provider: preferredProvider, normalizedKey }
      : null
  }
  if (normalizedKey.startsWith('sk-ant-')) {
    return { provider: 'anthropic', normalizedKey }
  }
  if (normalizedKey.startsWith('AIza')) {
    return { provider: 'gemini', normalizedKey }
  }
  if (normalizedKey.startsWith('sk-')) {
    return { provider: 'openai', normalizedKey }
  }
  return null
}
