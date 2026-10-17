import assert from 'node:assert/strict'
import {
  normalizeSettings,
  REMOVED_SETTING_KEYS
} from '../../../src/shared/logic/validation/ValidationUtils'
import { DEFAULT_SETTINGS } from '../../../src/shared/types/Settings'
import { validateGenerateExplanationPayload } from '../../../src/main/security/InputValidation'

// P4-4／P4-5：v4 設定中使用者可調的 Harness 參數與雙引擎開關一律丟棄，其他設定保留。
const legacyV4 = {
  ...DEFAULT_SETTINGS,
  aiProvider: 'openrouter',
  aiModel: 'vendor/model:free',
  userLevel: 'basic',
  version: 4,
  crossEngineEnabled: true,
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
assert.equal(REMOVED_SETTING_KEYS.length, 10)
for (const key of REMOVED_SETTING_KEYS) {
  assert.equal(key in normalized, false, `${key} 應被移除`)
}
assert.equal(normalized.aiProvider, 'openrouter')
assert.equal(normalized.aiModel, 'vendor/model:free')
assert.equal(normalized.userLevel, 'basic')
assert.equal(normalized.version, DEFAULT_SETTINGS.version)
assert.equal(DEFAULT_SETTINGS.version, 5)

// renderer 傳來的舊 Harness 模式／預算／證據重用（含超出範圍的值）不再被接受，也不會讓請求失敗。
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

console.log('settings normalization tests passed')
