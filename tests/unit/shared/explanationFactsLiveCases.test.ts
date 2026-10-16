/**
 * 用 P3-9 live 驗收的 10 個局面檢查事實表：live 回答的錯誤多半來自事實表沒寫清楚的地方，
 * 這裡逐項釘住程式算出的事實（著法與結果都用規則引擎重播，不靠手寫）。
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { buildExplanationFacts, formatFactsForPrompt } from '../../../src/shared/logic/analysis/ExplanationFacts'
import { compareMove } from '../../../src/shared/logic/analysis/MoveComparisonService'
import { checkAnswer } from '../../../src/shared/logic/ai/AnswerCheck'
import type { EngineAnalysis } from '../../../src/shared/types/EngineAnalysis'

const cases = JSON.parse(
  readFileSync(new URL('../../fixtures/explain-v2/cases.json', import.meta.url), 'utf8')
) as Array<{ id: string; analysis: EngineAnalysis }>

function factsText(id: string, language: 'zh-TW' | 'zh-CN' | 'en' = 'zh-TW'): string {
  const analysis = cases.find((item) => item.id === id)!.analysis
  const facts = buildExplanationFacts(analysis, analysis.userMove ? compareMove(analysis) : undefined)
  return formatFactsForPrompt(facts, language)
}

// 1. 評估用兵、標明視角：黑方走時 +0.10 是「以黑方來看」，不是原始的「10」。
const black = factsText('black-to-move')
assert.ok(black.includes('評估都以黑方來看，單位是兵'), black)
assert.ok(black.includes('引擎首選：馬8進7（評估 +0.10 兵）'), black)
assert.ok(black.includes('棋手著法：炮2平5（評估 -1.50 兵）'), black)
assert.equal(/評估 -?\d{2,}[）)]/.test(black), false, '不再出現原始 centipawn')
assert.ok(factsText('endgame-rook').includes('（評估 +20.00 兵）'))
// 殺棋保留「殺 N」，也不需要兵的視角說明。
const mate = factsText('check-mate-line')
assert.ok(mate.includes('（評估 殺 1）'), mate)
assert.equal(mate.includes('單位是兵'), false)
assert.ok(factsText('black-to-move', 'en').includes("All evals are from Black's point of view, in pawns"))

// 2. 每條線的吃子合計：卒兵互換、馬換炮都是「子數相同」，不再讓模型自己算成得子或虧子。
assert.ok(black.includes('列出手數內吃子合計：紅方吃掉黑卒；黑方吃掉紅兵（雙方各吃 1 子，子數相同）'), black)
const blunder = factsText('major-blunder')
assert.ok(blunder.includes('列出手數內吃子合計：紅方吃掉黑炮；黑方吃掉紅馬（雙方各吃 1 子，子數相同）'), blunder)
const capture = factsText('capture-line')
assert.ok(capture.includes('列出手數內吃子合計：紅方吃掉黑馬；黑方吃掉紅炮（雙方各吃 1 子，子數相同）'), capture)
// 沒有吃子的線不加這一行；不做子力價值換算（不出現「值」「划算」）。
assert.equal((factsText('opening-inaccuracy').match(/吃子合計/g) ?? []).length, 0)
assert.equal(/划算|值錢|價值/.test(black + blunder + capture), false)
assert.ok(factsText('major-blunder', 'en').includes('each side captured 1, equal piece count'))

// 3. 被吃與可吃的子標出是哪一路（各方自己右手邊起算），第 5 路的兵卒標「中兵／中卒」。
assert.ok(capture.includes('1. 紅 炮二進七：吃黑8路馬；未將軍；走完這步，下一手可吃：黑6路士'), capture)
assert.ok(capture.includes('2. 黑 車9平8：吃紅二路炮'), capture)
assert.ok(black.includes('2. 紅 炮五進四：吃黑5路卒（中卒）；將軍'), black)
assert.ok(black.includes('3. 黑 炮5進4：吃紅五路兵（中兵）'), black)
assert.ok(black.includes('紅九路兵') && black.includes('紅一路兵'), black)
assert.ok(blunder.includes('2. 黑 炮8進7：吃紅二路馬'), blunder)
assert.ok(blunder.includes('3. 紅 車一平二：吃黑8路炮'), blunder)
assert.ok(factsText('opening-inaccuracy', 'en').includes('Black pawn on file 5 (central pawn; cannot be recaptured)'))

// 4. 殘局列出盤面全部棋子：endgame-rook 黑方只剩一個將（live 回答曾說「黑方其他棋子混亂」）。
const endgame = factsText('endgame-rook')
assert.ok(endgame.includes('盤面上全部的棋子：紅方 帥、車；黑方 將。'), endgame)
const pawnEnding = buildExplanationFacts({
  ...cases.find((item) => item.id === 'endgame-rook')!.analysis,
  positionFen: '3k5/9/9/9/2p1p4/9/2P1P1P2/9/9/4K4 w - - 0 1'
})
assert.ok(formatFactsForPrompt(pawnEnding).includes('紅方 帥、兵×3；黑方 將、卒×2'), formatFactsForPrompt(pawnEnding))
// 子多（開局）時不列，免得事實表變長。
assert.equal(factsText('opening-inaccuracy').includes('盤面上全部的棋子'), false)
assert.ok(factsText('endgame-rook', 'en').includes('All pieces on the board: Red king, rook; Black king.'))

// 5. 「有保護」改說清楚：是「這步走完、下一手吃下去」之後對方能不能吃回（P3-9 live 把它讀成目前狀態）。
assert.ok(capture.includes('下一手可吃：黑6路士（吃下後對方能用5路將吃回）'), capture)
assert.ok(black.includes('下一手可吃：紅五路兵（中兵；吃下後對方吃不回）'), black)
assert.equal(/有保護|無保護|走後可吃/.test(capture + black), false)
assert.ok(factsText('capture-line', 'en').includes('after this move it can capture next: Black advisor on file 6 (can be recaptured by the king on file 5)'))

// 6. 唯一合法著法由規則引擎數出來：車九進九將軍後，黑方只有將5進1；
//    車九退一再將軍時，黑將可以進（將5進1）也可以退（將5退1），所以將5退1 不是唯一。
assert.ok(endgame.includes('2. 黑 將5進1：唯一合法著法；'), endgame)
assert.equal(endgame.includes('4. 黑 將5退1：唯一合法著法'), false, endgame)
assert.equal(black.includes('唯一合法著法'), false, '開局沒有唯一合法著法')
const endgameAnalysis = cases.find((item) => item.id === 'endgame-rook')!.analysis
const endgameFacts = buildExplanationFacts(endgameAnalysis)
const s3 = (text: string): boolean =>
  checkAnswer({ text, mode: 'position', language: 'zh-TW', facts: endgameFacts }).softWarnings.some((item) => item.code === 'S3')
// 說「只能／唯一」的子句提到唯一合法著法：不警告；說到其他著法被迫：照舊警告。
assert.equal(s3('車九進九將軍，黑方唯一的應法是將5進1。'), false)
assert.equal(s3('車九退一再將軍，黑方被迫將5退1。'), true)
assert.equal(s3('這條主線是必然的。'), true)

// 7. 寫出是誰吃回：中卒的保護來自第 2 手馬8進7 走到 7 路的馬（P3-9 live 兩個模型都誤歸給馬2進3）。
const opening = factsText('opening-inaccuracy')
assert.ok(opening.includes('3. 紅 炮二平五：') && opening.includes('黑5路卒（中卒；吃下後對方能用7路馬吃回）'), opening)
assert.ok(black.includes('紅九路兵（吃下後對方能用九路車吃回）'), black)
assert.ok(factsText('opening-inaccuracy', 'en').includes('can be recaptured by the horse on file 7'))

// 8. 指名某一步「被迫／只能／唯一」，但事實表沒標唯一合法著法 → 硬錯 H8（會觸發一次修正）。
const hard = (text: string): string[] =>
  checkAnswer({ text, mode: 'position', language: 'zh-TW', facts: endgameFacts }).hardErrors.map((item) => item.code)
assert.ok(hard('車九退一再將軍，迫使黑方必須將5退1。').includes('H8'))
assert.ok(hard('之後黑方只能將5退1。').includes('H8'))
assert.equal(hard('車九進九將軍，黑方只能將5進1。').includes('H8'), false, '事實表標了唯一合法著法')
assert.equal(hard('車九退一將軍後，黑將可以將5進1或將5退1。').includes('H8'), false, '兩種選擇不是被迫')
assert.equal(hard('將5退1 並非唯一的應法。').includes('H8'), false, '否定句')
assert.equal(hard('黑方只能應將。').includes('H8'), false, '沒指名著法交給軟警告')
// 「只能用某步吃回」講的是吃回方式（major-blunder 的標準答案就這樣寫），不是全盤唯一合法著法。
const blunderFacts = buildExplanationFacts(
  cases.find((item) => item.id === 'major-blunder')!.analysis,
  compareMove(cases.find((item) => item.id === 'major-blunder')!.analysis)
)
assert.equal(
  checkAnswer({ text: '黑方炮8進7吃紅馬，紅方只能車一平二吃回炮。', mode: 'question', language: 'zh-TW', facts: blunderFacts })
    .hardErrors.some((item) => item.code === 'H8'),
  false
)
// S3 遇到否定句不再誤報（P3-9 live：「並非唯一或必然」被標警告）。
assert.equal(s3('這條主線並非唯一或必然。'), false)

console.log('explanationFacts live-case tests passed')
