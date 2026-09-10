import assert from 'node:assert/strict'
import { buildQuestionRecoveryPrompt, extractDirectQuestionText, isFocusedQuestionAnswer } from '../../../src/main/ai/QuestionAnswerQuality'

const question = '紅方三路兵過河了嗎？它現在能橫走嗎？'
assert.equal(isFocusedQuestionAnswer(question, '先看引擎首選炮二平五。可查證主線是炮二平五、馬8進7。'), false)
assert.equal(isFocusedQuestionAnswer(question, '引擎證據不足。'), false)
assert.equal(isFocusedQuestionAnswer(question, '紅方三路兵尚未過河，依兵的走法現在不能橫走，只能向前走一格。'), true)
assert.equal(isFocusedQuestionAnswer(question, '紅方三路兵尚未過河，先出馬改善子力活動。'), false)
assert.equal(isFocusedQuestionAnswer('開局中路需要注意什麼？', '今天的天氣晴朗，適合出門散步並享受陽光。'), false)
assert.equal(isFocusedQuestionAnswer('為什麼要炮二平五？', '先把馬發展出來，接著提高車的活動能力。'), false)
assert.equal(extractDirectQuestionText('{"directAnswer":"未完成'), null)
assert.equal(extractDirectQuestionText('<think>analysis</think>答案'), null)
assert.equal(extractDirectQuestionText('```json\n{"directAnswer":"紅兵未過河。"}\n```'), '紅兵未過河。')
assert.equal(extractDirectQuestionText(JSON.stringify(JSON.stringify({ directAnswer: '紅兵未過河。' }))), '紅兵未過河。')
const prompt=buildQuestionRecoveryPrompt({question,language:'zh-TW',fen:'test-fen',boardFacts:['紅兵在 g4，尚未過河'],engineFacts:'主線只有馬二進三'})
assert(prompt.includes(question) && prompt.includes('紅兵在 g4，尚未過河'))
assert(prompt.includes('只輸出給棋手閱讀的短文') && prompt.includes('不能用推薦另一手棋代替棋規'))
console.log('Question-answer relevance and recovery tests passed')
