/**
 * 用 P3-9 live 驗收的 10 個局面檢查事實表：live 回答的錯誤多半來自事實表沒寫清楚的地方，
 * 這裡逐項釘住程式算出的事實（著法與結果都用規則引擎重播，不靠手寫）。
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { buildExplanationFacts, formatFactsForPrompt } from '../../../src/shared/logic/analysis/ExplanationFacts'
import { compareMove } from '../../../src/shared/logic/analysis/MoveComparisonService'
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
assert.ok(capture.includes('下一手可吃：黑6路士（吃下後對方能吃回）'), capture)
assert.ok(black.includes('下一手可吃：紅五路兵（中兵；吃下後對方吃不回）'), black)
assert.equal(/有保護|無保護|走後可吃/.test(capture + black), false)
assert.ok(factsText('capture-line', 'en').includes('after this move it can capture next: Black advisor on file 6 (can be recaptured)'))

console.log('explanationFacts live-case tests passed')
