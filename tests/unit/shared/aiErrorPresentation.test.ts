import assert from 'node:assert/strict'
import {
  aiErrorDiagnosticsText,
  presentAiError,
  type AiErrorInput
} from '../../../src/shared/logic/ai/aiErrorPresentation'
import type { AICredentialDiagnostic } from '../../../src/shared/types/AIProviderTypes'

function diagnostic(
  category: AICredentialDiagnostic['category'],
  extra: Partial<AICredentialDiagnostic> = {}
): AICredentialDiagnostic {
  return { stage: 'generation', category, retryable: false, message: 'x', ...extra }
}

const rows: Array<[string, AiErrorInput, string, string[]]> = [
  ['missing key', { code: 'missing_api_key' }, '尚未設定 AI 金鑰', ['open_settings']],
  ['daily quota', { code: 'rate_limited', diagnostic: diagnostic('rate_limited', { httpStatus: 429, quota: 'daily' }) }, '今天的免費額度用完了', ['open_settings']],
  ['minute quota', { code: 'rate_limited', diagnostic: diagnostic('rate_limited', { httpStatus: 429, quota: 'minute', retryAfterMs: 30_000 }) }, '請求太頻繁', ['retry']],
  ['5xx', { code: 'provider_error', diagnostic: diagnostic('provider_unavailable', { httpStatus: 502 }) }, '這個模型暫時無法回應', ['retry', 'change_model']],
  ['403', { code: 'provider_error', diagnostic: diagnostic('permission', { httpStatus: 403 }) }, '此模型不開放這類使用', ['change_model']],
  ['404', { code: 'provider_error', diagnostic: diagnostic('model_unavailable', { httpStatus: 404 }) }, '模型已下架或不在免費清單', ['change_model']],
  ['network', { code: 'network_error', diagnostic: diagnostic('network') }, '網路連線失敗', ['retry']],
  ['timeout', { code: 'provider_error', failureReason: 'model_timeout' }, '模型太慢，超過時間', ['retry', 'change_model']],
  ['empty', { code: 'provider_error', diagnostic: diagnostic('generation_incomplete', { reason: 'empty_content' }) }, '模型沒有給出完整答案', ['retry', 'change_model']],
  ['truncated', { code: 'provider_error', diagnostic: diagnostic('generation_incomplete', { reason: 'output_truncated' }) }, '模型沒有給出完整答案', ['retry', 'change_model']],
  ['format', { code: 'provider_error', diagnostic: diagnostic('response_format') }, '模型沒有給出完整答案', ['retry', 'change_model']],
  ['quality', { code: 'provider_error', failureReason: 'quality_validation_failed' }, '回答未通過檢查', ['retry']],
  ['expired', { code: 'analysis_session_not_found' }, '分析已過期', ['reanalyze']],
  ['invalid request', { code: 'invalid_request' }, '程式發生錯誤', ['retry']],
  ['unknown', { code: 'unknown_error' }, '程式發生錯誤', ['retry']],
  ['401', { code: 'provider_error', diagnostic: diagnostic('authentication', { httpStatus: 401 }) }, 'AI 金鑰無效', ['open_settings']],
  ['402', { code: 'provider_error', diagnostic: diagnostic('billing', { httpStatus: 402 }) }, '帳戶額度不足', ['open_settings']]
]

for (const [name, input, title, actions] of rows) {
  const presentation = presentAiError(input)
  assert.ok(presentation, name)
  assert.equal(presentation.title, title, name)
  assert.deepEqual(presentation.actions, actions, name)
  assert.ok(presentation.detail.length > 0, name)
}

assert.equal(presentAiError({ code: 'cancelled' }), null)
const minute = presentAiError(rows[2][1])!
assert.equal(minute.waitSeconds, 30)
assert.match(minute.detail, /30 秒/)
assert.match(presentAiError(rows[1][1])!.detail, /50 次/)
assert.match(presentAiError(rows[1][1])!.detail, /現行政策/)
// 沒有 Retry-After 時仍給出合理等待秒數。
assert.equal(presentAiError({ code: 'rate_limited' })!.waitSeconds, 20)

const copied = aiErrorDiagnosticsText({
  code: 'provider_error',
  message: 'provider said sk-or-v1-secret',
  diagnostic: diagnostic('provider_unavailable', { httpStatus: 503, message: 'raw provider text' }),
  model: 'vendor/model:free'
})
assert.deepEqual(JSON.parse(copied), {
  code: 'provider_error',
  failureReason: null,
  category: 'provider_unavailable',
  httpStatus: 503,
  reason: null,
  quota: null,
  model: 'vendor/model:free'
})
assert.equal(copied.includes('sk-or'), false)
assert.equal(copied.includes('raw provider text'), false)
console.log('aiErrorPresentation tests passed')
