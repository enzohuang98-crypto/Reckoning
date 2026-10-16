import assert from 'node:assert/strict'
import {
  normalizeSettings,
  REMOVED_HARNESS_SETTING_KEYS
} from '../../../src/shared/logic/validation/ValidationUtils'
import { DEFAULT_SETTINGS } from '../../../src/shared/types/Settings'
import { validateGenerateExplanationPayload } from '../../../src/main/security/InputValidation'
import { FIXED_HARNESS_OPTIONS } from '../../../src/main/ai/prepareExplanationExecution'

// P4-4：v4 設定中使用者可調的 Harness 參數一律丟棄，其他設定保留。
const legacyV4 = {
  ...DEFAULT_SETTINGS,
  aiProvider: 'openrouter',
  aiModel: 'vendor/model:free',
  userLevel: 'basic',
  version: 4,
  harnessAnswerMode: 'focused',
  harnessAutoRun: true,
  harnessReuseEvidence: false,
  harnessEngineTimeMs: 60_000,
  harnessMaxEngineRounds: 7,
  harnessResearchMaxModelCalls: 10,
  harnessResearchMaxOutputTokens: 20_000,
  harnessFocusedMaxModelCalls: 10,
  harnessFocusedMaxOutputTokens: 20_000
}
const normalized = normalizeSettings(legacyV4, DEFAULT_SETTINGS)
assert.equal(REMOVED_HARNESS_SETTING_KEYS.length, 9)
for (const key of REMOVED_HARNESS_SETTING_KEYS) {
  assert.equal(key in normalized, false, `${key} 應被移除`)
}
assert.equal(normalized.aiProvider, 'openrouter')
assert.equal(normalized.aiModel, 'vendor/model:free')
assert.equal(normalized.userLevel, 'basic')
assert.equal(normalized.version, DEFAULT_SETTINGS.version)
assert.equal(DEFAULT_SETTINGS.version, 5)

// renderer 傳來的模式／預算／證據重用（含超出範圍的舊值）不再被接受，也不會讓請求失敗。
const validated = validateGenerateExplanationPayload({
  requestId: 'req-settings',
  analysisId: 'analysis-1',
  provider: 'openrouter',
  model: 'vendor/model:free',
  userLevel: 'basic',
  explanationStyle: 'long_analytical',
  language: 'zh-TW',
  answerMode: 'focused',
  budget: { engineTimeMs: 1, maxEngineRounds: 99, maxModelCalls: 99, maxOutputTokens: 99_999 },
  reuseEvidence: false
}) as unknown as Record<string, unknown>
assert.equal('answerMode' in validated, false)
assert.equal('budget' in validated, false)
assert.equal('reuseEvidence' in validated, false)

// main 的固定值等於移除前設定頁的預設值，v1 回滾路徑行為不變。
assert.deepEqual(FIXED_HARNESS_OPTIONS, {
  answerMode: 'research',
  budget: { engineTimeMs: 20_000, maxEngineRounds: 3, maxModelCalls: 6, maxOutputTokens: 10_000 },
  reuseEvidence: true
})
assert.ok(Object.isFrozen(FIXED_HARNESS_OPTIONS) && Object.isFrozen(FIXED_HARNESS_OPTIONS.budget))

console.log('settings normalization tests passed')
