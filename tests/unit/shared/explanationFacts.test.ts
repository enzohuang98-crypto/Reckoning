import assert from 'node:assert/strict'
import {
  buildExplanationFacts,
  buildLineFacts,
  factMoveEvents,
  factMoveSet,
  formatFactsForPrompt,
  MAX_FACTS_PROMPT_CHARS,
  summarizeLine
} from '../../../src/shared/logic/analysis/ExplanationFacts'
import { convertCpScore } from '../../../src/main/engine/EngineOutputParser'
import { compareMove } from '../../../src/shared/logic/analysis/MoveComparisonService'
import { START_FEN } from '../../../src/shared/types/BoardState'
import type { EngineAnalysis } from '../../../src/shared/types/EngineAnalysis'

// 初始局面：炮二平五製造對中卒的新威脅（無保護），黑方用阿拉伯數字記譜。
const central = buildLineFacts(START_FEN, ['h2e2', 'h9g7', 'b0c2', 'b9c7'])
assert.deepEqual(central.plies.map((ply) => ply.move), ['炮二平五', '馬8進7', '馬八進七', '馬2進3'])
assert.deepEqual(central.plies[0].descriptors, ['enters_center'])
assert.deepEqual(central.plies[0].threats, [{ piece: 'pawn', side: 'black', file: 5, protected: false }])
assert.deepEqual(central.plies[1].descriptors, ['horse_develops'])
assert.equal(central.plies[1].side, 'black')
assert.equal(central.plies.every((ply) => ply.captured === null && !ply.givesCheck), true)
assert.equal(central.endsWith, null)

// 吃子與吃回。
const trade = buildLineFacts(START_FEN, ['h2h9', 'i9h9'])
assert.equal(trade.plies[0].move, '炮二進七')
assert.equal(trade.plies[0].captured, 'horse')
assert.equal(trade.plies[1].captured, 'cannon')
assert.deepEqual(trade.captures, { red: ['horse'], black: ['cannon'] })

// 將死：車一進八將軍，黑將無處可走。
const mate = buildLineFacts('3k5/R8/9/9/9/9/9/9/8R/4K4 w - - 0 1', ['i1i9'])
assert.equal(mate.plies[0].givesCheck, true)
assert.equal(mate.endsWith, 'checkmate')
// 困斃：沒有被將軍但無子可動（象棋判負）。
const stalemate = buildLineFacts('3k5/9/R8/9/9/9/9/9/9/4K4 w - - 0 1', ['a7a8'])
assert.equal(stalemate.plies[0].move, '車九進一')
assert.equal(stalemate.plies[0].givesCheck, false)
assert.equal(stalemate.endsWith, 'stalemate')

// 非法主線：在無法重播處截斷並附說明。
const broken = buildLineFacts(START_FEN, ['h2e2', 'h2e2', 'h9g7'])
assert.equal(broken.plies.length, 1)
assert.match(broken.warning ?? '', /第 2 手無法在棋盤上重播/)
assert.equal(broken.endsWith, null)
assert.equal(buildLineFacts(START_FEN, Array(20).fill('h2e2')).plies.length, 1)

// 兵過河、出車、將帥移動描述。
const pawnCross = buildLineFacts('4k4/9/9/9/9/4P4/9/9/9/R2K5 w - - 0 1', ['e4e5', 'e9e8', 'a0a5', 'e8e9', 'd0d1'])
assert.deepEqual(pawnCross.plies[0].descriptors, ['pawn_crosses_river'])
assert.deepEqual(pawnCross.plies[1].descriptors, ['king_moves'])
assert.deepEqual(pawnCross.plies[2].descriptors, ['rook_develops'])
assert.deepEqual(pawnCross.plies[4].descriptors, ['king_moves'])

// 保護判斷要把將／帥算進去：黑士在將旁邊，被車吃下後將可以吃回。
const kingGuard = buildLineFacts('4k4/4a4/9/9/9/9/9/9/9/R4K3 w - - 0 1', ['a0e0'])
assert.deepEqual(kingGuard.plies[0].threats, [{ piece: 'advisor', side: 'black', file: 5, protected: true }])

function analysis(): EngineAnalysis {
  const best = convertCpScore(42, 'score cp 42')
  const user = convertCpScore(7, 'score cp 7', 'candidate_move')
  return {
    positionFen: START_FEN,
    sideToMove: 'red',
    userMove: 'b0c2',
    displayUserMove: '馬八進七',
    bestMove: 'h2e2',
    displayBestMove: '炮二平五',
    scoreAfterUserMove: user,
    scoreAfterBestMove: best,
    evaluationAfterUserMove: user.comparableValue,
    evaluationAfterBestMove: best.comparableValue,
    userMoveEvaluationSource: 'candidate_move',
    userMovePrincipalVariation: ['b0c2', 'h9g7', 'h2e2', 'b9c7'],
    depth: 16,
    candidateMoves: [
      { move: 'h2e2', displayMove: '炮二平五', score: best, evaluation: best.comparableValue, depth: 16, principalVariation: ['h2e2', 'h9g7'] },
      { move: 'b0c2', displayMove: '馬八進七', score: user, evaluation: user.comparableValue, depth: 16, principalVariation: ['b0c2'] },
      { move: 'c3c4', displayMove: '兵七進一', score: user, evaluation: user.comparableValue, depth: 16, principalVariation: ['c3c4'] }
    ],
    principalVariation: ['h2e2', 'h9g7'],
    incomplete: false,
    warnings: [],
    engineName: 'Test'
  }
}

const engine = analysis()
const facts = buildExplanationFacts(engine, compareMove(engine))
assert.equal(facts.bestMove.move, '炮二平五')
// 評估用兵（comparableValue），不用原始 centipawn 文字；殺棋保留「殺 N」。
assert.deepEqual(facts.bestMove.score, { kind: 'pawns', value: engine.scoreAfterBestMove?.comparableValue })
assert.equal(facts.userMove?.move, '馬八進七')
assert.equal(facts.userIsBest, false)
assert.equal(facts.mistakeLevel, 'inaccuracy')
assert.equal(facts.scoreGapPawns, 0.35)
assert.equal(facts.bestLine.plies.length, 2)
assert.equal(facts.userLine?.plies.length, 4)
assert.deepEqual(facts.differences, [{ kind: 'no_captures', plies: 2 }])
assert.deepEqual([...factMoveSet(facts)].sort(), ['兵七進一', '炮二平五', '馬2進3', '馬8進7', '馬八進七'].sort())
assert.deepEqual(factMoveEvents(facts).get('炮二平五'), { captures: false, checks: false })

const zh = formatFactsForPrompt(facts, 'zh-TW')
assert.match(zh, /輪到：紅方/)
assert.ok(zh.includes('引擎首選：炮二平五（評估 +0.42 兵）'), zh)
assert.ok(zh.includes('評估都以紅方來看，單位是兵；正數對紅方有利，負數對紅方不利。'), zh)
assert.match(zh, / 3\. 紅 炮二平五：炮進入中路；未吃子；未將軍；走完這步，下一手可吃：黑5路卒（中卒；吃下後對方能吃回）/, 'after 馬8進7 the central pawn is protected')
assert.match(zh, /差距：緩手／不精確（0\.35 兵）/)
assert.match(zh, / 1\. 紅 炮二平五：炮進入中路；未吃子；未將軍；走完這步，下一手可吃：黑5路卒（中卒；吃下後對方吃不回）/)
assert.match(zh, /兩線前 2 手都沒有吃子/)
assert.match(zh, /其他候選：兵七進一/)
assert.equal(/score cp|h2e2|b0c2/.test(zh), false, 'facts must not leak raw scores or UCI')
assert.ok(zh.length <= MAX_FACTS_PROMPT_CHARS)
assert.match(formatFactsForPrompt(facts, 'zh-CN'), /轮到：红方/)
assert.match(formatFactsForPrompt(facts, 'en'), /central file/)

// 走對的著法：標示與首選相同，不另列實戰線。
const correct = buildExplanationFacts({ ...engine, userMove: 'h2e2', displayUserMove: '炮二平五' })
assert.equal(correct.userIsBest, true)
assert.equal(correct.userLine, undefined)
assert.match(formatFactsForPrompt(correct), /棋手的著法就是引擎首選/)

// 黑方行棋與吃子差異。
const blackToMove = buildExplanationFacts({
  ...engine,
  positionFen: 'rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C2C4/9/RNBAKABNR b - - 1 1',
  sideToMove: 'black',
  bestMove: 'h9g7',
  principalVariation: ['h9g7', 'h0g2'],
  userMove: 'b7e7',
  userMovePrincipalVariation: ['b7e7', 'e2e6', 'e7e3'],
  candidateMoves: []
})
assert.equal(blackToMove.bestMove.move, '馬8進7')
assert.equal(blackToMove.userLine?.plies[1].captured, 'pawn')
assert.equal(blackToMove.differences[0].kind, 'first_capture')
const blackText = formatFactsForPrompt(blackToMove)
assert.match(blackText, /輪到：黑方/)
assert.match(blackText, /實戰線第 2 手紅炮吃黑卒，另一條線沒有吃子/)
assert.match(blackText, /吃子結果：首選線雙方都沒有吃子；實戰線/)

const summary = summarizeLine(trade)
assert.deepEqual(summary.moves, ['炮二進七', '車9平8'])
assert.deepEqual(summary.events, ['第 1 手紅炮吃黑馬', '第 2 手黑車吃紅炮'])
assert.match(summarizeLine(mate).events.join(''), /將死/)
assert.match(summarizeLine(stalemate).events.join(''), /困斃/)
console.log('explanationFacts tests passed')
