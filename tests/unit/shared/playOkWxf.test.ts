import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { parseFen } from '../../../src/shared/logic/board/fen'
import {
  parseGameRecord,
  parsePlayOkWxf
} from '../../../src/shared/logic/board/PlayOkWxf'
import { START_FEN, type BoardState } from '../../../src/shared/types/BoardState'

function board(fen: string): BoardState {
  const parsed = parseFen(fen)
  assert.equal(parsed.valid, true, `測試 FEN 無效：${fen}`)
  if (!parsed.valid) throw new Error(parsed.message)
  return parsed.board
}

const standardWxf = `FORMAT WXF
GAME 1487abc-test
START{
C2.5 H8+7 H2+3 H2+3
}END`

{
  const parsed = parseGameRecord(standardWxf)
  assert.equal(parsed.valid, true)
  if (parsed.valid) {
    assert.equal(parsed.format, 'wxf')
    assert.deepEqual(parsed.moves, ['h2e2', 'h9g7', 'h0g2', 'b9c7'])
    assert.deepEqual(parsed.displayMoves, ['C2.5', 'H8+7', 'H2+3', 'H2+3'])
    assert.equal(parsed.positions.length, 5)
    assert.equal(parsed.positions[0].fen, START_FEN)
    assert.equal(parsed.positions[1].sideToMove, 'black')
  }
}

{
  const parsed = parseGameRecord('h2e2 H9G7 h0g2 b9c7')
  assert.equal(parsed.valid, true)
  if (parsed.valid) {
    assert.equal(parsed.format, 'uci')
    assert.deepEqual(parsed.moves, ['h2e2', 'h9g7', 'h0g2', 'b9c7'])
    assert.deepEqual(parsed.displayMoves, parsed.moves)
    assert.equal(parsed.positions.length, 5)
  }
}

const twoCannons = board(
  '3k5/9/9/9/4C4/9/9/4C4/9/4K4 w - - 0 1'
)
const twoRooks = board(
  '3k5/9/9/9/4R4/9/9/4R4/9/4K4 w - - 0 1'
)

const disambiguated: Array<[string, BoardState, string]> = [
  ['C+-2', twoCannons, 'e5e3'],
  ['C++3', twoCannons, 'e5e8'],
  ['R++3', twoRooks, 'e5e8'],
  ['R+.9', twoRooks, 'e5a5']
]

for (const [token, start, expected] of disambiguated) {
  const parsed = parsePlayOkWxf(`FORMAT WXF START{${token}}END`, start)
  assert.equal(parsed.valid, true, token)
  if (parsed.valid) {
    assert.deepEqual(parsed.moves, [expected], token)
    assert.deepEqual(parsed.displayMoves, [token], token)
    assert.equal(parsed.positions[0].fen, start.fen, token)
  }
}

{
  const parsed = parsePlayOkWxf('FORMAT WXF START{C5+1}END', twoCannons)
  assert.equal(parsed.valid, false)
  if (!parsed.valid) {
    assert.equal(parsed.halfMove, 1)
    assert.equal(parsed.token, 'C5+1')
    assert.match(parsed.message, /第 1 半回合/)
    assert.match(parsed.message, /token "C5\+1"/)
    assert.match(parsed.message, /無法唯一判定/)
  }
}

{
  const parsed = parseGameRecord('h2e2 bad-token')
  assert.equal(parsed.valid, false)
  if (!parsed.valid) {
    assert.equal(parsed.halfMove, 2)
    assert.equal(parsed.token, 'bad-token')
    assert.match(parsed.message, /第 2 半回合/)
    assert.match(parsed.message, /token "bad-token"/)
  }
}

{
  const parsed = parsePlayOkWxf('FORMAT WXF START{H8+8}END')
  assert.equal(parsed.valid, false)
  if (!parsed.valid) {
    assert.equal(parsed.halfMove, 1)
    assert.equal(parsed.token, 'H8+8')
  }
}

const realPlayOkSamples: Array<[string, number, string, string]> = [
  ['xq272174077.wxf', 153, 'P3+1', 'R6.2'],
  ['xq275996662.wxf', 118, 'A6+5', 'r2.3']
]

for (const [fixture, halfMoves, firstDisplay, lastDisplay] of realPlayOkSamples) {
  const input = readFileSync(
    new URL(`../../fixtures/playok/${fixture}`, import.meta.url),
    'utf8'
  )
  const parsed = parsePlayOkWxf(input)
  assert.equal(parsed.valid, true, fixture)
  if (parsed.valid) {
    assert.equal(parsed.moves.length, halfMoves, fixture)
    assert.equal(parsed.positions.length, halfMoves + 1, fixture)
    assert.equal(parsed.positions[0].fen, START_FEN, fixture)
    assert.equal(parsed.displayMoves[0], firstDisplay, fixture)
    assert.equal(parsed.displayMoves.at(-1), lastDisplay, fixture)
  }
}

console.log('PlayOK WXF tests passed')
