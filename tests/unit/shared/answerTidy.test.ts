import assert from 'node:assert/strict'
import { tidyAnswerText } from '../../../src/shared/logic/ai/AnswerTidy'
import { checkAnswer } from '../../../src/shared/logic/ai/AnswerCheck'
import { buildExplanationFacts } from '../../../src/shared/logic/analysis/ExplanationFacts'
import { openingAnalysis, openingComparison } from '../../support/explainFixtures'

const analysis = openingAnalysis()
const facts = buildExplanationFacts(analysis, openingComparison(analysis))

// 提示標籤換成「引擎資料」，意思不變，也不再觸發 H3。
assert.equal(tidyAnswerText('根據事實表，炮二平五佔中。', facts, 'zh-TW'), '根據引擎資料，炮二平五佔中。')
assert.equal(tidyAnswerText('【事實表】顯示炮二平五較好。', facts, 'zh-TW'), '引擎資料顯示炮二平五較好。')
assert.equal(tidyAnswerText('根据事实表，炮二平五占中。', facts, 'zh-CN'), '根据引擎数据，炮二平五占中。')
assert.equal(tidyAnswerText('The fact table shows 炮二平五.', facts, 'en'), 'the engine data shows 炮二平五.')
const tidied = tidyAnswerText('根據事實表，炮二平五先佔中路，對中卒施壓。', facts, 'zh-TW')
assert.equal(checkAnswer({ text: tidied, mode: 'question', language: 'zh-TW', facts }).hardErrors.length, 0)

// 黑方著法混用數字（P3-9 live：「馬8進七」）：第一個數字是阿拉伯數字 → 黑方 → 改回「馬8進7」。
assert.equal(tidyAnswerText('黑方馬8進七跳馬出動。', facts, 'zh-TW'), '黑方馬8進7跳馬出動。')
// 紅方寫成阿拉伯數字結尾：第一個數字是中文 → 紅方 → 改回「馬八進七」。
assert.equal(tidyAnswerText('紅方馬八進7。', facts, 'zh-TW'), '紅方馬八進七。')
// 簡體字形的同一步不動（AnswerCheck 本來就認得）。
assert.equal(tidyAnswerText('黑方马8进7。', facts, 'zh-CN'), '黑方马8进7。')
// 對不上事實表的著法不動，照舊由 AnswerCheck 判 H4。
assert.equal(tidyAnswerText('紅方車一進一。', facts, 'zh-TW'), '紅方車一進一。')
const invented = tidyAnswerText('紅方車一進1 比較好。', facts, 'zh-TW')
assert.ok(checkAnswer({ text: invented, mode: 'question', language: 'zh-TW', facts }).hardErrors.some((error) => error.code === 'H4'))

console.log('answer tidy tests passed')
