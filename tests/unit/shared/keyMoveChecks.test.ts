import assert from 'node:assert/strict'
import {
  completeIdeaProbe,
  legalPrefix,
  nullMoveFen,
  planIdeaProbes
} from '../../../src/shared/logic/analysis/ideaProbes'
import {
  buildExplanationFacts,
  factMoveSet,
  formatFactsForPrompt
} from '../../../src/shared/logic/analysis/ExplanationFacts'
import { buildEngineSummary } from '../../../src/shared/logic/ai/EngineSummary'
import { parseFen } from '../../../src/shared/logic/board/fen'
import type { EngineAnalysis, IdeaProbes } from '../../../src/shared/types/EngineAnalysis'

// 老師挑的實戰局面（紅先）：棋手走車一平四，引擎首選炮一退一。
// 老師的講法：直接車一平四，黑馬8進7吃三路兵還捉炮，紅要補退炮、丟先手；
// 先炮一退一，黑如果照樣馬8進7，紅就有車一平二捉黑砲的先手。
// 引擎主線假設黑方不會照樣走，所以這一手只會出現在「照樣應著」的假設線裡。
const FEN = 'r1bak3r/4a4/2n1bc1c1/2p1p3p/p5pn1/2P6/P3P1P1P/C1N1B1N1C/4A4/1RBAK3R w - - 0 1'
const parsed = parseFen(FEN)
assert.ok(parsed.valid)
if (!parsed.valid) process.exit(1)

const userLine = ['i0f0', 'h5g3', 'i2i1']
const bestLine = ['i2i1', 'c6c5']

// 規劃：輪走方沒被將軍 → 問對手的威脅；棋手線上的應著馬8進7和首選線不同且合法 → 問照樣應著；
// 首選沒有將軍 → 問首選的威脅。
const planned = planIdeaProbes({ positionFen: FEN, bestMove: 'i2i1', bestLine, userLine })
assert.deepEqual(planned.map((probe) => probe.kind), ['opponentThreat', 'sameReply', 'bestThreat'])
const sameReply = planned.find((probe) => probe.kind === 'sameReply')!
assert.deepEqual(sameReply.prefix, ['i2i1', 'h5g3'])
assert.equal(sameReply.startFen, parsed.board.fen)
assert.match(planned[0].startFen, / b /, '對手的威脅改由黑方先走')
assert.match(planned[2].startFen, / w /, '首選的威脅：首選之後再由紅方走')

// 首選線本來就是同一應著時不問照樣應著；棋手走的就是首選時也不問。
assert.equal(
  planIdeaProbes({ positionFen: FEN, bestMove: 'i2i1', bestLine: ['i2i1', 'h5g3'], userLine })
    .some((probe) => probe.kind === 'sameReply'),
  false
)
assert.equal(
  planIdeaProbes({ positionFen: FEN, bestMove: 'i2i1', bestLine, userLine: ['i2i1', 'h5g3'] })
    .some((probe) => probe.kind === 'sameReply'),
  false
)

// 被將軍時不能「這手先不走」。
const inCheck = parseFen('4k4/9/9/9/9/9/9/9/4r4/4K4 w - - 0 1')
assert.ok(inCheck.valid)
if (inCheck.valid) assert.equal(nullMoveFen(inCheck.board), null)

// 引擎回傳的續著只留合法前段，並截到上限；接不出任何一手時不算。
assert.deepEqual(legalPrefix(FEN, ['i2i1', 'h5g3', 'i2i1']), ['i2i1', 'h5g3'])
assert.equal(completeIdeaProbe(sameReply, ['i0h0', 'h7h6', 'b0b1', 'a9a8', 'b1b2'])?.moves.length, 5)
assert.equal(completeIdeaProbe(sameReply, ['a9a5']), null)

// 事實表：照樣應著的第 3 手車一平二製造對黑砲的威脅，標成關鍵；對手的威脅是馬8進7吃兵。
const probes: IdeaProbes = {
  opponentThreat: completeIdeaProbe(planned[0], ['h5g3', 'g2i1'])!,
  sameReply: completeIdeaProbe(sameReply, ['i0h0', 'h7h6'])!,
  bestThreat: completeIdeaProbe(planned[2], ['i0h0'])!
}
assert.ok(probes.opponentThreat && probes.sameReply && probes.bestThreat)

const analysis: EngineAnalysis = {
  positionFen: parsed.board.fen,
  sideToMove: 'red',
  userMove: 'i0f0',
  bestMove: 'i2i1',
  scoreAfterUserMove: null,
  scoreAfterBestMove: null,
  evaluationAfterUserMove: null,
  evaluationAfterBestMove: null,
  userMoveEvaluationSource: 'separate_engine_call',
  userMovePrincipalVariation: userLine,
  depth: 20,
  candidateMoves: [],
  principalVariation: bestLine,
  incomplete: false,
  warnings: [],
  engineName: 'Pikafish'
}
const facts = buildExplanationFacts(analysis, null, probes)
const ideas = facts.ideas ?? []
assert.deepEqual(ideas.map((idea) => idea.kind), ['opponentThreat', 'sameReply', 'bestThreat'])

const same = ideas.find((idea) => idea.kind === 'sameReply')!
assert.equal(same.reply, '馬8進7')
assert.equal(same.keyPly, 3)
assert.equal(same.line.plies[2].move, '車一平二')
assert.ok(same.line.plies[2].threats.some((threat) => threat.piece === 'cannon' && threat.side === 'black'))

const threat = ideas.find((idea) => idea.kind === 'opponentThreat')!
assert.equal(threat.side, 'black')
assert.equal(threat.keyPly, 1)
assert.equal(threat.line.plies[0].move, '馬8進7')
assert.equal(threat.line.plies[0].captured, 'pawn')

const text = formatFactsForPrompt(facts)
assert.match(text, /關鍵著法檢查/)
assert.match(text, /照樣應著（首選之後黑方仍照實戰線走馬8進7）/)
assert.match(text, /3\. 紅 車一平二：[^\n]*← 關鍵/)
assert.match(text, /對手的威脅（假如紅方這手先不走、讓黑方先走）/)

// 回答可以引用假設線上的著法（不算「不存在的著法」）。
assert.ok(factMoveSet(facts).has('車一平二'))

// 沒有吃子、將軍或威脅的假設線不列，避免塞進沒內容的「如果」。
const quiet = buildExplanationFacts(analysis, null, {
  sameReply: { startFen: parsed.board.fen, moves: ['i2i1', 'h5g3', 'b0b1'] }
})
assert.equal(quiet.ideas, undefined)

// 首選或局面不符的照樣應著不採用。
const mismatched = buildExplanationFacts(analysis, null, {
  sameReply: { startFen: parsed.board.fen, moves: ['i0f0', 'h5g3', 'f0f7'] }
})
assert.equal(mismatched.ideas?.some((idea) => idea.kind === 'sameReply') ?? false, false)

// AI 沒通過檢查時的引擎重點摘要也點名關鍵那一手。
const summary = buildEngineSummary(facts, '測試')
assert.match(summary, /照樣應著（首選之後黑方仍照實戰線走馬8進7）：炮一退一 馬8進7 車一平二（關鍵：車一平二）/)

console.log('key move check tests passed')
