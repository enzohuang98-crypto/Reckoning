import assert from 'node:assert/strict'
import {
  buildOpenRouterRequestOptions,
  MANDATORY_REASONING_EXTRA_TOKENS
} from '../../../src/main/ai/providers/openRouterRequestPolicy'
import type { AIModelCapabilities } from '../../../src/shared/types/AIProviderTypes'

const base: AIModelCapabilities = {
  supportsReasoning: true,
  supportsResponseFormat: true,
  supportsStructuredOutputs: false
}

const cases: Array<[string, Parameters<typeof buildOpenRouterRequestOptions>[0], ReturnType<typeof buildOpenRouterRequestOptions>]> = [
  ['unknown capabilities: no reasoning, json kept', { capabilities: null, responseFormat: 'json', visibleTokens: 800 }, { max_tokens: 800, response_format: { type: 'json_object' } }],
  ['unknown capabilities: text', { capabilities: null, visibleTokens: 800 }, { max_tokens: 800 }],
  ['reasoning auto → effort none', { capabilities: base, visibleTokens: 800 }, { max_tokens: 800, reasoning: { effort: 'none', exclude: true } }],
  ['reasoning off_strict → enabled false', { capabilities: base, visibleTokens: 800, reasoningMode: 'off_strict' }, { max_tokens: 800, reasoning: { enabled: false, exclude: true } }],
  ['efforts without none → enabled false', { capabilities: { ...base, reasoningEfforts: ['low', 'high'] }, visibleTokens: 800 }, { max_tokens: 800, reasoning: { enabled: false, exclude: true } }],
  ['efforts with none → effort none', { capabilities: { ...base, reasoningEfforts: ['none', 'low'] }, visibleTokens: 800 }, { max_tokens: 800, reasoning: { effort: 'none', exclude: true } }],
  ['mandatory reasoning → lowest effort + extra budget', { capabilities: { ...base, reasoningMandatory: true, reasoningEfforts: ['high', 'low', 'medium'] }, visibleTokens: 800 }, { max_tokens: 800 + MANDATORY_REASONING_EXTRA_TOKENS, reasoning: { effort: 'low', exclude: true } }],
  ['mandatory without effort list → low', { capabilities: { ...base, reasoningMandatory: true }, visibleTokens: 800 }, { max_tokens: 800 + MANDATORY_REASONING_EXTRA_TOKENS, reasoning: { effort: 'low', exclude: true } }],
  ['no reasoning support', { capabilities: { ...base, supportsReasoning: false }, visibleTokens: 800 }, { max_tokens: 800 }],
  ['max completion cap', { capabilities: { ...base, supportsReasoning: false, maxCompletionTokens: 500 }, visibleTokens: 800 }, { max_tokens: 500 }],
  ['cap applies after mandatory extra', { capabilities: { ...base, reasoningMandatory: true, maxCompletionTokens: 2_000 }, visibleTokens: 800 }, { max_tokens: 2_000, reasoning: { effort: 'low', exclude: true } }],
  ['json dropped when unsupported', { capabilities: { ...base, supportsResponseFormat: false }, responseFormat: 'json', visibleTokens: 800 }, { max_tokens: 800, reasoning: { effort: 'none', exclude: true } }],
  ['json kept when supported', { capabilities: base, responseFormat: 'json', visibleTokens: 800 }, { max_tokens: 800, reasoning: { effort: 'none', exclude: true }, response_format: { type: 'json_object' } }]
]
for (const [name, input, expected] of cases) {
  assert.deepEqual(buildOpenRouterRequestOptions(input), expected, name)
}
console.log('openRouterRequestPolicy tests passed')
