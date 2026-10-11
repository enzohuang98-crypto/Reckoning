import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { normalizeSettings } from '../../src/shared/logic/validation/ValidationUtils'
import { DEFAULT_SETTINGS } from '../../src/shared/types/Settings'
import { loadSettings, saveSettings } from '../../src/renderer/src/storage/localSettings'

const read = (path: string): string => readFileSync(resolve(path), 'utf8')

const browserSecurity = read('src/main/security/BrowserSecurity.ts')
const analysisCss = read('src/renderer/src/styles/analysis.css')
const coachView = read('src/renderer/src/features/analysis/CoachView.tsx')
const guessPanel = read('src/renderer/src/features/guessing/GuessModePanel.tsx')
const workspace = read('src/renderer/src/features/workspace/AnalysisWorkspace.tsx')
const settingsNavigation = read('src/renderer/src/features/settings/SettingsNavigation.tsx')
const settingsPage = read('src/renderer/src/pages/SettingsPage.tsx')

assert.match(browserSecurity, /webContents\.on\('context-menu'/)
assert.match(browserSecurity, /role:\s*'copy'/)
assert.match(browserSecurity, /role:\s*'cut'/)
assert.match(browserSecurity, /role:\s*'paste'/)

assert.match(
  analysisCss,
  /\.live-analysis-table\s+(?:th|td)[\s\S]*?-webkit-user-select:\s*text;[\s\S]*?user-select:\s*text;/
)

assert.doesNotMatch(guessPanel, /MISTAKE_LEVEL_LABELS/)
assert.doesNotMatch(guessPanel, /className=\{`guess-result/)
assert.doesNotMatch(coachView, /實戰步與 AI 首選比較/)
assert.doesNotMatch(guessPanel, /先想再看答案/)
assert.doesNotMatch(guessPanel, /guess-steps/)
assert.doesNotMatch(guessPanel, /1 選著法|2 提交猜著|3 深度分析/)
assert.match(guessPanel, /你的走法/)
assert.match(guessPanel, /你選這一步的原因/)
assert.doesNotMatch(guessPanel, /placeholder="為什麼想走這步？（選填）"[\s\S]{0,160}disabled=/)
assert.match(
  workspace,
  /onSubmitGuess=\{\(guess\)\s*=>\s*\{[\s\S]*?setSubmittedGuess\(guess\)[\s\S]*?setGuessSelectionActive\(false\)/
)
assert.doesNotMatch(workspace, /setSubmittedGuess\(guess\)[\s\S]{0,100}setActiveView\('coach'\)/)
assert.doesNotMatch(coachView, /coach-ready-card|引擎證據已準備完成|產生完整 AI 解說/)
assert.match(guessPanel, /submissionId:\s*crypto\.randomUUID\(\)/)
assert.match(guessPanel, /重試 AI 解說/)

assert.doesNotMatch(settingsNavigation, /解說品質/)
assert.doesNotMatch(settingsNavigation, /id:\s*'harness'/)
assert.doesNotMatch(settingsPage, /HarnessSettingsSection/)

const normalized = normalizeSettings(
  {
    ...DEFAULT_SETTINGS,
    harnessAnswerMode: 'focused',
    harnessAutoRun: false,
    harnessReuseEvidence: false
  },
  DEFAULT_SETTINGS
)
assert.equal(normalized.harnessAnswerMode, 'research')
assert.equal(normalized.harnessAutoRun, false)
assert.equal(normalized.harnessReuseEvidence, true)

// Product defaults are asserted independently of the normalizer. Legacy
// custom budgets must not survive load, save, migration or a simulated reopen.
const expectedAnalysis = {
  rootAnalysisMovetimeMs: 3000, userMoveEvalMovetimeMs: 1000, multiPv: 3,
  crossEngineEnabled: false, harnessAnswerMode: 'research', harnessAutoRun: false,
  harnessReuseEvidence: true, harnessEngineTimeMs: 20000, harnessMaxEngineRounds: 3,
  harnessResearchMaxModelCalls: 6, harnessResearchMaxOutputTokens: 10000,
  harnessFocusedMaxModelCalls: 4, harnessFocusedMaxOutputTokens: 4000
}
const custom = {
  ...DEFAULT_SETTINGS, rootAnalysisMovetimeMs: 60000, userMoveEvalMovetimeMs: 8000,
  multiPv: 20, crossEngineEnabled: true, harnessAnswerMode: 'focused' as const,
  harnessAutoRun: true, harnessReuseEvidence: false, harnessEngineTimeMs: 90000,
  harnessMaxEngineRounds: 8, harnessResearchMaxModelCalls: 12,
  harnessResearchMaxOutputTokens: 40000, harnessFocusedMaxModelCalls: 9,
  harnessFocusedMaxOutputTokens: 16000, aiProvider: 'openrouter' as const,
  aiModel: 'nvidia/nemotron-3-super-120b-a12b:free', userLevel: 'advanced' as const,
  language: 'en' as const
}
function checkSettings(value: ReturnType<typeof loadSettings>): void {
  for (const [key, expected] of Object.entries(expectedAnalysis)) {
    assert.equal(value[key as keyof typeof expectedAnalysis], expected, key)
  }
  assert.equal(value.aiProvider, 'openrouter')
  assert.equal(value.aiModel, custom.aiModel)
  assert.equal(value.userLevel, 'advanced')
  assert.equal(value.language, 'en')
}
const stored = new Map<string, string>()
const originalStorage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage')
Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
  getItem: (key: string) => stored.get(key) ?? null,
  setItem: (key: string, value: string) => stored.set(key, value)
} })
try {
  stored.set('xiangqi.settings', JSON.stringify(custom))
  checkSettings(loadSettings())
  assert.equal(saveSettings(custom).ok, true)
  checkSettings(loadSettings())
  // The old modern schema must retain its selected model, rather than being
  // misread as a v1 schema and replaced with a different provider.
  stored.set('xiangqi.settings', JSON.stringify({ ...custom, version: 3 }))
  checkSettings(loadSettings())
  checkSettings(loadSettings())
  stored.set('xiangqi.settings', JSON.stringify({
    activeProvider: 'openrouter', selectedModels: { openrouter: custom.aiModel },
    engineMultiPv: 20, userLevel: 'advanced', language: 'en', version: 1
  }))
  checkSettings(loadSettings())
  checkSettings(loadSettings())
  const poisoned = normalizeSettings({ ...custom, apiKey: 'synthetic-credential-marker' }, DEFAULT_SETTINGS)
  assert.equal('apiKey' in poisoned, false, 'unknown credential fields must never enter local settings')
  assert.equal(saveSettings(poisoned).ok, true)
  assert.doesNotMatch(stored.get('xiangqi.settings')!, /synthetic-credential-marker|apiKey/)
} finally {
  if (originalStorage) Object.defineProperty(globalThis, 'localStorage', originalStorage)
  else Reflect.deleteProperty(globalThis, 'localStorage')
}

const app = read('src/renderer/src/App.tsx')
assert.doesNotMatch(app, /LicensePage|licenseState|api\.license|ENFORCE_LICENSE/)
assert.match(app, /isSetupCompleted/)
assert.match(app, /dataRecoveryRequired/)
assert.doesNotMatch(read('src/preload/index.ts'), /license:\s*\{|LICENSE_STATUS|LICENSE_ACTIVATE/)
assert.doesNotMatch(read('src/main/index.ts'), /LicenseService|registerLicenseHandlers/)

console.log('Simplified analysis experience checks passed')
