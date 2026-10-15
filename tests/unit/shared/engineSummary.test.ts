import assert from 'node:assert/strict'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { buildEngineSummary } from '../../../src/shared/logic/ai/EngineSummary'
import { checkAnswer } from '../../../src/shared/logic/ai/AnswerCheck'
import { buildExplanationFacts } from '../../../src/shared/logic/analysis/ExplanationFacts'
import { buildRepairPrompt } from '../../../src/main/ai/explain/repairPrompt'
import type { ExplanationLanguage } from '../../../src/shared/types/AIExplanationTypes'
import { openingAnalysis, openingComparison } from '../../support/explainFixtures'

const SNAPSHOT = new URL('../../fixtures/explain-v2/engine-summary-snapshots.json', import.meta.url)
const analysis = openingAnalysis()
const facts = buildExplanationFacts(analysis, openingComparison(analysis))
const tradeFacts = buildExplanationFacts(openingAnalysis({
  bestMove: 'h2h9', displayBestMove: '炮二進七', principalVariation: ['h2h9', 'i9h9'],
  userMove: 'h2e2', userMovePrincipalVariation: ['h2e2', 'h9g7'], candidateMoves: []
}))
const positionFacts = buildExplanationFacts(openingAnalysis({ userMove: undefined, displayUserMove: undefined }))

const outputs: Record<string, string> = {}
for (const language of ['zh-TW', 'zh-CN', 'en'] as ExplanationLanguage[]) {
  outputs[`move-${language}`] = buildEngineSummary(facts, '回答與引擎事實不符', language)
}
outputs.trade = buildEngineSummary(tradeFacts, '模型沒有回應')
outputs.position = buildEngineSummary(positionFacts, '模型沒有回應')
if (process.env.UPDATE_SNAPSHOTS === '1' || !existsSync(SNAPSHOT)) {
  writeFileSync(SNAPSHOT, `${JSON.stringify(outputs, null, 2)}\n`)
  console.log('engine summary snapshot written')
}
assert.deepEqual(outputs, JSON.parse(readFileSync(SNAPSHOT, 'utf8')))

const zh = outputs['move-zh-TW']
assert.match(zh, /^⚠ AI 解說這次沒有通過檢查（原因：回答與引擎事實不符）。以下是引擎重點摘要（非 AI 生成）/)
assert.match(zh, /你的著法：馬八進七；引擎首選：炮二平五；差距：緩手／不精確（約 0\.35 兵）/)
assert.match(zh, /首選之後的主線：炮二平五 馬8進7/)
assert.match(zh, /重試 AI/)
assert.match(outputs.trade, /第 1 手紅炮吃黑馬；第 2 手黑車吃紅炮/)
assert.equal(outputs.position.includes('你的著法'), false)

// 摘要本身必須通過客觀檢查（不含座標、不提不存在的著法、吃子與事實一致）。
for (const [name, text] of Object.entries(outputs)) {
  const usedFacts = name === 'trade' ? tradeFacts : name === 'position' ? positionFacts : facts
  const language = (name.startsWith('move-') ? name.slice(5) : 'zh-TW') as ExplanationLanguage
  const result = checkAnswer({ text, mode: 'position', language, facts: usedFacts })
  assert.deepEqual(result.hardErrors, [], `${name}: ${JSON.stringify(result.hardErrors)}`)
}

const repair = buildRepairPrompt({
  language: 'zh-TW',
  errors: [{ code: 'H4', message: '提到的著法「車一平二」不在事實表中。' }],
  factsText: 'FACTS',
  previousAnswer: '舊'.repeat(2_500)
})
assert.match(repair, /^你上一次的回答有以下問題/)
assert.match(repair, /- 提到的著法「車一平二」不在事實表中。/)
assert.match(repair, /【事實表】\nFACTS/)
assert.ok(repair.includes(`${'舊'.repeat(2_000)}…`))
assert.ok(!repair.includes('舊'.repeat(2_001)))
assert.match(buildRepairPrompt({ language: 'en', errors: [], factsText: 'F', previousAnswer: 'x' }), /^Your previous answer/)
console.log('engine summary and repair prompt tests passed')
