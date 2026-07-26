/** OpenAI endpoint and request-option rules shared by normal use and key testing. */

import { isOpenAIProModel } from '@shared/types/AIProviderTypes'

const GPT_5_MODEL_PATTERN = /^gpt-5(?:\.|-)/
const GPT_5_6_MODEL_PATTERN = /^gpt-5\.6(?:-|$)/
const O_SERIES_MODEL_PATTERN = /^o\d+(?:-|$)/
const CHAT_JSON_MODEL_PATTERN =
  /^(?:gpt-5(?:\.|-)|o3(?:-|$)|gpt-4\.1(?:-|$)|gpt-4o-mini(?:-|$))/

export function usesOpenAIResponsesApi(model: string): boolean {
  return GPT_5_6_MODEL_PATTERN.test(model) || isOpenAIProModel(model)
}

export function openAIResponsesOptions(
  model: string
): { reasoning: { effort: 'none' } } | Record<string, never> {
  return GPT_5_6_MODEL_PATTERN.test(model)
    ? { reasoning: { effort: 'none' } }
    : {}
}

export function openAIChatSamplingOptions(
  model: string
): { reasoning_effort: 'none' } | { temperature: number } | Record<string, never> {
  if (GPT_5_MODEL_PATTERN.test(model)) return { reasoning_effort: 'none' }
  if (O_SERIES_MODEL_PATTERN.test(model)) return {}
  return { temperature: 0.3 }
}

export function supportsOpenAIChatJsonMode(model: string): boolean {
  return CHAT_JSON_MODEL_PATTERN.test(model) && !usesOpenAIResponsesApi(model)
}
