import assert from 'node:assert/strict'
import {
  SecurityValidationError,
  validateGenerateExplanationPayload
} from '../../../src/main/security/InputValidation'

function payload(historyText: string, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    requestId: 'req-1',
    analysisId: 'analysis-1',
    provider: 'openrouter',
    model: 'vendor/model:free',
    userLevel: 'basic',
    explanationStyle: 'long_analytical',
    language: 'zh-TW',
    conversationHistory: [
      { id: 'a1', role: 'assistant', text: historyText, createdAt: '2026-10-15T00:00:00.000Z' }
    ],
    followUpQuestion: '為什麼？',
    ...extra
  }
}

const validated = validateGenerateExplanationPayload(payload('長'.repeat(5_000)))
assert.equal(validated.conversationHistory?.[0].text.length, 4_000)
assert.equal(validated.conversationHistory?.[0].text, '長'.repeat(4_000))

assert.throws(
  () => validateGenerateExplanationPayload(payload('含有\0字元')),
  SecurityValidationError
)
assert.throws(
  () => validateGenerateExplanationPayload(payload('ok', {
    conversationHistory: [{ id: 'a1', role: 'assistant', text: 42, createdAt: 'x' }]
  })),
  SecurityValidationError
)
// 新內容（本次追問）仍維持拒絕而非截斷。
assert.throws(
  () => validateGenerateExplanationPayload(payload('ok', { followUpQuestion: '問'.repeat(4_001) })),
  SecurityValidationError
)
assert.equal(validateGenerateExplanationPayload(payload('  空白  ')).conversationHistory?.[0].text, '空白')
console.log('explanation payload validation tests passed')
