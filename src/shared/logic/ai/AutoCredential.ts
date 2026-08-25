import type { AIProviderId } from '../../types/AIProviderTypes'

export const AUTO_MODEL_PRIORITY: Record<Exclude<AIProviderId, 'openai-compatible'>, readonly string[]> = {
  openai: [
    'gpt-5.6-sol',
    'gpt-5.6-terra',
    'gpt-5.5',
    'gpt-5.4',
    'gpt-5.2',
    'gpt-4.1'
  ],
  anthropic: [
    'claude-sonnet-5',
    'claude-opus-5',
    'claude-opus-4-8',
    'claude-sonnet-4-6',
    'claude-haiku-4-5'
  ],
  gemini: [
    'gemini-3.7-flash',
    'gemini-3.6-flash',
    'gemini-3.5-flash',
    'gemini-2.5-pro',
    'gemini-2.5-flash'
  ]
}

function normalizeListedModel(model: string): string {
  return model.startsWith('models/') ? model.slice('models/'.length) : model
}

export function selectAutomaticModel(
  provider: Exclude<AIProviderId, 'openai-compatible'>,
  availableModels: readonly string[]
): string | null {
  const available = new Set(availableModels.map(normalizeListedModel))
  return AUTO_MODEL_PRIORITY[provider].find((model) => available.has(model)) ?? null
}
