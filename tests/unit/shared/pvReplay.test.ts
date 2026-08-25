import assert from 'node:assert/strict'
import { parseFen } from '../../../src/shared/logic/board/fen'
import { START_FEN } from '../../../src/shared/types/BoardState'
import { buildPvReplay } from '../../../src/shared/logic/board/PvReplay'

const parsed = parseFen(START_FEN)
assert.equal(parsed.valid, true)
if (!parsed.valid) throw new Error(parsed.message)

const replay = buildPvReplay(parsed.board, ['h2e2', 'h9g7'], ['炮二平五', '馬８進７'])
assert.equal(replay.boards.length, 3)
assert.equal(replay.steps.length, 2)
assert.equal(replay.steps[0].uci, 'h2e2')
assert.equal(replay.steps[0].display, '炮二平五')
assert.equal(replay.warning, null)
assert.notEqual(replay.boards[0].fen, replay.boards[1].fen)
assert.notEqual(replay.boards[1].fen, replay.boards[2].fen)

const truncated = buildPvReplay(parsed.board, ['h2e2', 'bad'], ['炮二平五', '非法'])
assert.equal(truncated.boards.length, 2)
assert.equal(truncated.steps.length, 1)
assert.match(truncated.warning ?? '', /第 2 手/)

const empty = buildPvReplay(parsed.board, [], [])
assert.deepEqual(empty.boards.map((board) => board.fen), [parsed.board.fen])
assert.equal(empty.warning, null)

console.log('PV 重播测试：通过')
