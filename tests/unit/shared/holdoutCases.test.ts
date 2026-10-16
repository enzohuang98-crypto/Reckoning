/**
 * P3-9 保留驗證集：題目檔要與產生工具一致（不得手改），每題都能在規則引擎上完整重播，
 * 而且涵蓋走對、各級錯誤與追問。
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { buildHoldoutCases, HOLDOUT_PATH } from '../../../tools/acceptance/build-holdout-cases'
import { buildExplanationFacts, formatFactsForPrompt } from '../../../src/shared/logic/analysis/ExplanationFacts'
import { compareMove } from '../../../src/shared/logic/analysis/MoveComparisonService'
import { loadLiveCases } from '../../../tools/acceptance/explain-v2-live'

const stored = JSON.parse(readFileSync(HOLDOUT_PATH, 'utf8'))
assert.deepEqual(stored, JSON.parse(JSON.stringify(buildHoldoutCases('holdout-v1'))), '題目檔與產生工具不一致；請重新執行 build-holdout-cases.ts')

const cases = loadLiveCases('holdout')
assert.equal(cases.length, 10)
assert.equal(new Set(cases.map((item) => item.id)).size, 10)
assert.ok(new Set(cases.map((item) => item.id.split('-')[1])).size >= 5, '題目分散在至少 5 局')
assert.ok(cases.some((item) => item.analysis.sideToMove === 'red') && cases.some((item) => item.analysis.sideToMove === 'black'))
assert.ok(cases.some((item) => item.mode === 'question'))

const levels = new Set<string>()
for (const item of cases) {
  const comparison = compareMove(item.analysis)
  const facts = buildExplanationFacts(item.analysis, comparison)
  levels.add(facts.userIsBest ? 'best' : comparison.mistakeLevel)
  assert.equal(facts.bestLine.warning, undefined, `${item.id} 首選線要能完整重播`)
  assert.equal(facts.userLine?.warning, undefined, `${item.id} 實戰線要能完整重播`)
  assert.ok(facts.bestLine.plies.length >= 4, item.id)
  assert.ok(formatFactsForPrompt(facts).length > 0)
}
for (const level of ['best', 'inaccuracy', 'mistake', 'serious_mistake', 'major_blunder']) {
  assert.ok(levels.has(level), `缺少 ${level}`)
}
// 固定調整題仍是原本的 10 題。
assert.equal(loadLiveCases().length, 10)

console.log('holdout cases tests passed')
