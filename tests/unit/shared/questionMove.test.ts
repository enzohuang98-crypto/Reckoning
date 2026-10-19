import assert from 'node:assert/strict'
import { findQuestionMove } from '../../../src/shared/logic/ai/questionMove'
import { parseFen } from '../../../src/shared/logic/board/fen'

const opening = parseFen('rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNR w - - 0 1')
assert.ok(opening.valid)
if (!opening.valid) process.exit(1)

// 紅方：中文數字、繁簡與異體字都認得。
assert.equal(findQuestionMove(opening.board, '為什麼要走炮二平五？'), 'h2e2')
assert.equal(findQuestionMove(opening.board, '为什么走马八进七'), 'b0c2')
assert.equal(findQuestionMove(opening.board, '砲二平五好嗎'), 'h2e2')
assert.equal(findQuestionMove(opening.board, '象三進五可以嗎'), 'g0e2', '紅方寫成「象」也算相三進五')
// 問題裡有好幾步時取第一個合法的。
assert.equal(findQuestionMove(opening.board, '車一進九還是炮八平五？'), 'b2e2')
// 沒寫著法、不合法、或寫成對方記譜（阿拉伯數字）時不猜。
assert.equal(findQuestionMove(opening.board, '這步為什麼不好？'), undefined)
assert.equal(findQuestionMove(opening.board, '為什麼不走車一進九？'), undefined)
assert.equal(findQuestionMove(opening.board, '黑方馬2進3之後呢？'), undefined)

// 黑方：阿拉伯數字（含全形）。
const blackToMove = parseFen('rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C2C4/9/RNBAKABNR b - - 1 1')
assert.ok(blackToMove.valid)
if (blackToMove.valid) {
  assert.equal(findQuestionMove(blackToMove.board, '馬8進7的原因？'), 'h9g7')
  assert.equal(findQuestionMove(blackToMove.board, '马２进３呢'), 'b9c7')
  assert.equal(findQuestionMove(blackToMove.board, '馬八進七'), undefined, '黑方要用阿拉伯數字')
}

console.log('question move tests passed')
