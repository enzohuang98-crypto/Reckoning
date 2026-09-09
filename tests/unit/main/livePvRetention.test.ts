import assert from 'node:assert/strict'
import { MultiPvAccumulator } from '../../../src/main/engine/EngineOutputParser'

// Real Pikafish shape at movetime expiry: a deeper bound-only single move
// follows an exact multi-move PV for the same root move.
const exact = 'info depth 23 seldepth 42 multipv 1 score cp 11 wdl 35 962 3 time 14345 pv h0g2 g9e7 i0i1 b9c7'
for (const bound of ['lowerbound', 'upperbound']) {
  const accumulator = new MultiPvAccumulator('candidate_move', 3)
  accumulator.ingestLine(exact)
  accumulator.ingestLine('info depth 24 multipv 1 score cp 7 ' + bound + ' time 15000 pv h0g2')
  const candidate = accumulator.getCandidateMoves()[0]
  assert.deepEqual(candidate.principalVariation, ['h0g2','g9e7','i0i1','b9c7'])
  assert.equal(candidate.depth, 23, 'do not mislabel retained PV with incomplete deeper depth')
  assert.equal(candidate.score?.comparableValue, 0.11)
  accumulator.ingestLine('info depth 25 multipv 1 score cp 5 pv h0g2')
  assert.deepEqual(accumulator.getCandidateMoves()[0].principalVariation, ['h0g2'], 'exact short lines remain authoritative')
  accumulator.clear()
  accumulator.ingestLine('info depth 24 multipv 1 score cp 7 ' + bound + ' pv h0g2')
  assert.deepEqual(accumulator.getCandidateMoves()[0].principalVariation, ['h0g2'], 'no cross-search retention')
}
const changedMove = new MultiPvAccumulator()
changedMove.ingestLine(exact)
changedMove.ingestLine('info depth 24 multipv 1 score cp 7 lowerbound pv b0a2')
assert.deepEqual(changedMove.getCandidateMoves()[0].principalVariation, ['b0a2'], 'never attach old continuation to a new root move')
console.log('Live PV retention tests passed')
