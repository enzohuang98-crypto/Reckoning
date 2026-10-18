import assert from 'node:assert/strict'
import {
  checkAnswer,
  extractMentionedMoves,
  normalizeMoveText,
  type AnswerCheckInput
} from '../../../src/shared/logic/ai/AnswerCheck'
import { buildExplanationFacts } from '../../../src/shared/logic/analysis/ExplanationFacts'
import { START_FEN } from '../../../src/shared/types/BoardState'
import { openingAnalysis, openingComparison } from '../../support/explainFixtures'

const analysis = openingAnalysis()
const facts = buildExplanationFacts(analysis, openingComparison(analysis))
// 另一個有吃子與將軍的局面：炮二進七吃馬，車9平8吃回。
const tradeFacts = buildExplanationFacts(
  openingAnalysis({
    bestMove: 'h2h9',
    displayBestMove: '炮二進七',
    principalVariation: ['h2h9', 'i9h9'],
    userMove: 'h2e2',
    userMovePrincipalVariation: ['h2e2', 'h9g7'],
    candidateMoves: []
  })
)

const GOOD_MOVE =
  '**結論**：馬八進七比炮二平五慢一步，沒有立刻對中卒施壓。\n**這步的問題**：炮二平五走後可以吃黑卒，而馬八進七沒有這個威脅。\n**首選想做什麼**：炮二平五讓炮進入中路。\n**對手怎麼利用**：黑方馬8進7後中卒有保護。\n**下次怎麼想**：先看有沒有能立刻施壓的著法。'

function check(text: string, extra: Partial<AnswerCheckInput> = {}) {
  return checkAnswer({ text, mode: 'move', language: 'zh-TW', facts, ...extra })
}
function codes(text: string, extra: Partial<AnswerCheckInput> = {}): string[] {
  return check(text, extra).hardErrors.map((error) => error.code)
}

assert.deepEqual(codes(GOOD_MOVE), [], 'a grounded answer passes')

// H1 太短
assert.ok(codes('好。', { mode: 'question' }).includes('H1'))
assert.ok(!codes('炮二平五先佔中路，對中卒施壓。', { mode: 'question' }).includes('H1'))
// H2 截斷
assert.ok(codes(GOOD_MOVE, { finishReason: 'length' }).includes('H2'))
assert.ok(!codes(GOOD_MOVE, { finishReason: 'stop' }).includes('H2'))
// H3 外洩
for (const leak of ['走 h2e2 比較好，這是炮二平五。', '{"answer":"炮二平五"}', '根據 E1 證據，炮二平五較好。', '<think>想一下</think>炮二平五較好。', '這個 FEN 顯示炮二平五較好。', '```\n炮二平五\n```']) {
  assert.ok(codes(leak, { mode: 'question' }).includes('H3'), leak)
}
assert.ok(!codes('炮二平五先佔中路，這是 2 號重點。', { mode: 'question' }).includes('H3'))
for (const leak of ['根據事實表，炮二平五佔中。', '棋手未提供想法，所以只看引擎。', 'According to the fact table, 炮二平五 is best.']) {
  assert.ok(codes(leak, { mode: 'question' }).includes('H3'), leak)
}
assert.ok(!codes('炮二平五先佔中路，引擎資料沒有顯示更好的走法。', { mode: 'question' }).includes('H3'))
// H4 不存在的著法
const invented = check('**結論**：應該走車一平二。**這步的問題**：馬八進七太慢。', {})
assert.ok(invented.hardErrors.some((error) => error.code === 'H4' && error.message.includes('車一平二')))
assert.ok(!codes('照你想的走兵三進一會怎樣？引擎沒有顯示這條線。', { mode: 'question', userText: '如果我走兵三進一呢？' }).includes('H4'), 'moves the player wrote may be quoted')
// 簡體與異體字不誤判。
assert.deepEqual(codes('**结论**：马八进七比炮二平五慢。**这步的问题**：黑方马8进7之后中卒有保护。', { language: 'zh-CN' }), [])
assert.equal(normalizeMoveText('车９进１'), '車9進1')
assert.deepEqual(extractMentionedMoves('前车进二，后马退三，炮２平５').map((item) => item.move), ['前車進二', '後馬退三', '炮2平5'])
// H5 吃子／將軍矛盾
const fakeCapture = check('炮二平五吃掉中卒，黑方很被動。', { mode: 'question' })
assert.ok(fakeCapture.hardErrors.some((error) => error.code === 'H5' && error.message.includes('沒有吃子')))
assert.ok(codes('炮二平五將軍，黑方必須應將。', { mode: 'question' }).includes('H5'))
assert.ok(!codes('炮二平五之後可以吃中卒。', { mode: 'question' }).includes('H5'), 'hedged capture is fine')
// 威脅的講法（要吃、去吃、追吃、再吃、捉、下一手吃）是意圖，不是說這步吃子；真的說它吃掉還是擋下。
for (const threat of ['炮二平五要吃中卒。', '炮二平五去吃中卒。', '炮二平五追吃中卒。', '炮二平五再吃中卒。', '炮二平五捉住中卒，下一手吃。', '炮二平五下一手吃中卒。']) {
  assert.ok(!codes(threat, { mode: 'question' }).includes('H5'), threat)
}
assert.ok(codes('炮二平五吃掉中卒。', { mode: 'question' }).includes('H5'), 'a real false capture claim is still caught')
assert.ok(!codes('炮二平五沒有吃子，但威脅中卒。', { mode: 'question' }).includes('H5'))
assert.ok(!codes('炮二平五，接著黑方吃不到東西。', { mode: 'question' }).includes('H5'), 'window stops at the clause break')
assert.ok(!codes('炮二進七吃馬，車9平8吃回炮。', { mode: 'question', facts: tradeFacts }).includes('H5'), 'real captures pass')
// H6 一鍵解說缺段落
assert.ok(codes('馬八進七比炮二平五慢一步，因為沒有立刻威脅中卒。').includes('H6'))
assert.ok(!codes('**結論**：炮二平五就是首選。**這步好在哪**：炮進入中路。').includes('H6'))
assert.ok(!codes('馬八進七比炮二平五慢，沒有威脅中卒。', { mode: 'question' }).includes('H6'))
// H7 輪走方
assert.ok(codes('目前輪到黑方走，炮二平五不是重點。', { mode: 'question' }).includes('H7'))
assert.ok(!codes('炮二平五之後輪到黑方應對，馬8進7保護中卒。', { mode: 'question' }).includes('H7'), 'narrated turns are not checked')
assert.ok(codes("Currently it is Black's move.", { mode: 'question', language: 'en' }).includes('H7'))

// 軟警告不擋答案。
const soft = check(`${GOOD_MOVE}因為分數較高所以炮二平五必然更好，總體而言如此。`)
assert.deepEqual(soft.hardErrors, [])
assert.deepEqual(soft.softWarnings.map((warning) => warning.code).sort(), ['S1', 'S3', 'S4'])
assert.ok(check('炮二平五先佔中路。'.repeat(60), { mode: 'question' }).softWarnings.some((warning) => warning.code === 'S2'))
assert.equal(START_FEN.length > 0, true)
console.log('answerCheck tests passed')
