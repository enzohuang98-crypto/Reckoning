import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { normalizeSettings } from '../../src/shared/logic/validation/ValidationUtils'
import { DEFAULT_SETTINGS } from '../../src/shared/types/Settings'

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
  /onSubmitGuess=\{\(guess\)\s*=>\s*\{[\s\S]*?setSubmittedGuess\(guess\)[\s\S]*?setActiveView\('coach'\)/
)

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
assert.equal(normalized.harnessAutoRun, true)
assert.equal(normalized.harnessReuseEvidence, true)

console.log('Simplified analysis experience checks passed')
