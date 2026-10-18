import assert from 'node:assert/strict'
import { parseFen } from '../../../src/shared/logic/board/fen'
import { START_FEN } from '../../../src/shared/types/BoardState'
import { buildCoachRequest, type CoachRequestInput } from '../../../src/renderer/src/features/analysis/coachRequest'

const parsed = parseFen(START_FEN)
assert.ok(parsed.valid)
const board = parsed.board

const actualMove = {
  selectionId: 'sel-1',
  positionFen: START_FEN,
  move: 'b0c2',
  displayMove: '馬八進七',
  plyIndex: 0,
  selectedAt: 1
}

function input(overrides: Partial<CoachRequestInput>): CoachRequestInput {
  return {
    board,
    draftMove: '',
    draftReason: '',
    draftQuestion: '',
    submittedGuess: null,
    actualMove: null,
    submissionId: 'sub-1',
    now: 100,
    ...overrides
  }
}

// 什麼都沒填 → 解說目前局面；只有問題 → 直接問局面。
assert.deepEqual(buildCoachRequest(input({})), { kind: 'explain' })
assert.deepEqual(buildCoachRequest(input({ draftQuestion: '  現在該怎麼走？ ' })), {
  kind: 'question',
  question: '現在該怎麼走？'
})

// 自己選的著法：帶上想法與問題一起送出（實測：選了著法卻沒送出，AI 只好猜是哪一步）。
assert.deepEqual(
  buildCoachRequest(input({ draftMove: 'H2E2', draftReason: ' 先架中炮 ', draftQuestion: '為什麼不好？' })),
  {
    kind: 'submit',
    guess: { submissionId: 'sub-1', move: 'h2e2', reason: '先架中炮', question: '為什麼不好？', submittedAt: 100 }
  }
)

// 不合法的著法不送出。
const invalid = buildCoachRequest(input({ draftMove: 'a0a5' }))
assert.equal(invalid.kind, 'invalid')
assert.match((invalid as { message: string }).message, /^這步不合法：/)

// 沒自己選時，用棋譜點的實戰步，並標記來源（不寫入猜著紀錄）；想法照樣帶上。
assert.deepEqual(buildCoachRequest(input({ actualMove, draftReason: '先出馬' })), {
  kind: 'submit',
  guess: { submissionId: 'sub-1', move: 'b0c2', reason: '先出馬', fromGame: true, submittedAt: 100 }
})

// 自己選的著法優先於棋譜步。
const picked = buildCoachRequest(input({ actualMove, draftMove: 'h2e2' }))
assert.equal(picked.kind === 'submit' && picked.guess.move, 'h2e2')
assert.equal(picked.kind === 'submit' && picked.guess.fromGame, undefined)

// 已送出後再按：沿用同一步與原本的想法（欄位已鎖住），換成這次的問題，產生新的請求編號。
const again = buildCoachRequest(input({
  submittedGuess: { submissionId: 'old', move: 'b0c2', reason: '先出馬', fromGame: true, submittedAt: 50 },
  draftReason: '這段不會被採用',
  draftQuestion: '那我應該怎麼走？',
  submissionId: 'sub-2',
  now: 200
}))
assert.deepEqual(again, {
  kind: 'submit',
  guess: { submissionId: 'sub-2', move: 'b0c2', reason: '先出馬', question: '那我應該怎麼走？', fromGame: true, submittedAt: 200 }
})

console.log('coach request builder tests passed')
