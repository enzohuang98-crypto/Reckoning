import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { normalizeSettings } from '../../src/shared/logic/validation/ValidationUtils'
import { DEFAULT_SETTINGS } from '../../src/shared/types/Settings'

const read = (path: string): string => readFileSync(resolve(path), 'utf8')

const browserSecurity = read('src/main/security/BrowserSecurity.ts')
const analysisCss = read('src/renderer/src/styles/analysis.css')
const coachView = read('src/renderer/src/features/analysis/CoachView.tsx')
const guessPanel = read('src/renderer/src/features/analysis/AskCoachForm.tsx')
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
assert.match(guessPanel, /你的走法（選填）/)
assert.match(guessPanel, /你的想法（選填）/)
assert.match(guessPanel, /你的問題（選填）/)
assert.match(guessPanel, /請 AI 解說/)
assert.doesNotMatch(guessPanel, /placeholder="為什麼想走這步？（選填）"[\s\S]{0,160}disabled=/)
// 合併後只有一個送出點：表單與工具列都呼叫 askCoach，送出時一併結束選擇著法，不再切換模式。
assert.match(workspace, /const askCoach = \(\): void =>[\s\S]*?setGuessSelectionActive\(false\)[\s\S]*?setSubmittedGuess\(request\.guess\)/)
assert.match(workspace, /onAsk=\{askCoach\}/)
assert.match(workspace, /onRequestExplanation=\{askCoach\}/)
assert.doesNotMatch(workspace, /setActiveView|AnalysisInspectorTabs|GuessModePanel/)
assert.doesNotMatch(guessPanel + workspace, /提交猜著|猜著練習|猜著模式/)
assert.doesNotMatch(coachView, /coach-ready-card|引擎證據已準備完成|產生完整 AI 解說/)
assert.match(workspace, /submissionId:\s*crypto\.randomUUID\(\)/)
assert.match(guessPanel, /重試 AI 解說/)

assert.doesNotMatch(settingsNavigation, /解說品質/)
assert.doesNotMatch(settingsNavigation, /id:\s*'harness'/)
assert.doesNotMatch(settingsPage, /HarnessSettingsSection/)

// P4-4：Harness 參數不再是使用者設定；舊設定裡的值讀進來就丟棄，不能再影響解說。
const normalized = normalizeSettings(
  {
    ...DEFAULT_SETTINGS,
    harnessAnswerMode: 'focused',
    harnessAutoRun: true,
    harnessReuseEvidence: false
  },
  DEFAULT_SETTINGS
) as unknown as Record<string, unknown>
assert.equal('harnessAnswerMode' in normalized, false)
assert.equal('harnessAutoRun' in normalized, false)
assert.equal('harnessReuseEvidence' in normalized, false)

console.log('Simplified analysis experience checks passed')
