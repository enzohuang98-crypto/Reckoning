import assert from 'node:assert/strict'
import { normalizeSettings } from '../../../src/shared/logic/validation/ValidationUtils'
import { DEFAULT_SETTINGS } from '../../../src/shared/types/Settings'
import { validateGenerateExplanationPayload } from '../../../src/main/security/InputValidation'

const legacy = normalizeSettings({ ...DEFAULT_SETTINGS, harnessMaxEngineRounds: 7 }, DEFAULT_SETTINGS)
assert.equal(legacy.harnessMaxEngineRounds, 3)
assert.equal(
  normalizeSettings({ ...DEFAULT_SETTINGS, harnessMaxEngineRounds: 0 }, DEFAULT_SETTINGS).harnessMaxEngineRounds,
  1
)
assert.equal(
  normalizeSettings({ ...DEFAULT_SETTINGS, harnessMaxEngineRounds: 2 }, DEFAULT_SETTINGS).harnessMaxEngineRounds,
  2
)
assert.ok(DEFAULT_SETTINGS.harnessMaxEngineRounds >= 1 && DEFAULT_SETTINGS.harnessMaxEngineRounds <= 3)

// 正規化後的設定組出的預算必須能通過 main 的 IPC 驗證。
const validated = validateGenerateExplanationPayload({
  requestId: 'req-settings',
  analysisId: 'analysis-1',
  provider: 'openrouter',
  model: 'vendor/model:free',
  userLevel: 'basic',
  explanationStyle: 'long_analytical',
  language: 'zh-TW',
  budget: {
    engineTimeMs: legacy.harnessEngineTimeMs,
    maxEngineRounds: legacy.harnessMaxEngineRounds,
    maxModelCalls: legacy.harnessResearchMaxModelCalls,
    maxOutputTokens: legacy.harnessResearchMaxOutputTokens
  }
})
assert.equal(validated.budget?.maxEngineRounds, 3)
console.log('settings normalization tests passed')
