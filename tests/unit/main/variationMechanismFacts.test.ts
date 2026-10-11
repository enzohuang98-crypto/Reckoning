import assert from 'node:assert/strict'
import { buildVariationMechanismFacts } from '../../../src/main/ai/VariationMechanismFacts'
import { formatChineseVariation } from '../../../src/shared/logic/board/ChineseNotation'
import { createEmptyGrid, parseFen, pieceFromCode, serializeFen } from '../../../src/shared/logic/board/fen'
import { applyUciMove } from '../../../src/shared/logic/board/moves'
import { START_FEN, type PieceColor } from '../../../src/shared/types/BoardState'
import type { HarnessEvidence } from '../../../src/shared/types/Harness'

let passed = 0
let failed = 0
function test(name: string, run: () => void): void {
  try { run(); passed++; console.log(`  ✓ ${name}`) }
  catch (error) { failed++; console.error(`  ✗ ${name}: ${error instanceof Error ? error.message : String(error)}`) }
}

function position(pieces: Record<string, string>, side: PieceColor = 'red'): string {
  const grid = createEmptyGrid()
  for (const [square, code] of Object.entries(pieces)) {
    grid[9 - Number(square[1])][square.charCodeAt(0) - 97] = pieceFromCode(code)
  }
  return serializeFen(grid, side)
}

function evidence(moves: string[], fen = START_FEN, id = 'E1'): HarnessEvidence {
  const parsed = parseFen(fen)
  assert.ok(parsed.valid, 'fixture FEN must parse')
  return {
    id, engineId: 'fixture', engineName: 'Fixture', purpose: 'Mechanism facts',
    positionFen: fen, depth: 12, score: null,
    displayPrincipalVariation: formatChineseVariation(parsed.board, moves),
    analysis: { principalVariation: moves, candidateMoves: [] }
  } as HarnessEvidence
}

function facts(moves: string[], fen = START_FEN) {
  const result = buildVariationMechanismFacts(evidence(moves, fen))
  assert.equal(result.warning, null, 'positive fixture must replay legally')
  assert.equal(result.steps.length, moves.length)
  return result
}

const openingMoves = ['b2e2', 'b9c7', 'b0c2', 'a9b9', 'a0b0', 'c6c5', 'b0b6']
const lanePosition = position({ e0: 'K', f9: 'k', b0: 'R', b2: 'C', a9: 'r' })
const laneMoves = ['b2e2', 'a9a8', 'b0b6']

test('moving the opening horse frees the real rook destination without relocating the rook early', () => {
  const result = facts(openingMoves)
  assert.deepEqual(result.steps[2].futureMoveLegalityChanges, [{
    futurePly: 5, move: '車九平八', side: 'red', piece: 'rook',
    fromSquare: 'a0', toSquare: 'b0', beforeLegal: false, afterLegal: true,
    beforeConstraint: '終點 b0 已有己方棋子。', afterConstraint: null
  }])
  assert.equal(result.steps[0].futureMoveLegalityChanges.some(change => change.futurePly === 7), false,
    'the cannon must not borrow a future b0 origin for a rook still at a0')
})

test('a cannon vacates a vertical lane only when the future rook already occupies that origin', () => {
  const step = facts(laneMoves, lanePosition).steps[0]
  assert.equal(step.fromSquare, 'b2')
  assert.equal(step.toSquare, 'e2')
  assert.deepEqual(step.futureMoveLegalityChanges, [{
    futurePly: 3, move: '車八進六', side: 'red', piece: 'rook',
    fromSquare: 'b0', toSquare: 'b6', beforeLegal: false, afterLegal: true,
    beforeConstraint: '車的路徑上有棋子阻擋。', afterConstraint: null
  }])
})

test('an already open rook lane is checked but never reported as newly opened', () => {
  const fen = position({ e0: 'K', f9: 'k', b0: 'R', c2: 'C', a9: 'r' })
  const step = facts(['c2e2', 'a9a8', 'b0b6'], fen).steps[0]
  assert.deepEqual(step.coverage.futurePliesChecked, [3])
  assert.deepEqual(step.futureMoveLegalityChanges, [])
})

test('a new obstruction reports true to false even when intervening real play later removes it', () => {
  const fen = position({ e0: 'K', f9: 'k', b0: 'R', c2: 'C', a9: 'r' })
  const step = facts(['c2b2', 'a9a8', 'b2e2', 'a8a9', 'b0b6'], fen).steps[0]
  assert.deepEqual(step.futureMoveLegalityChanges.map(change => [change.futurePly, change.beforeLegal, change.afterLegal]),
    [[5, true, false]])
  assert.deepEqual(step.coverage.futurePliesChecked, [5])
})

function rotateSquare(square: string): string {
  return String.fromCharCode(105 - (square.charCodeAt(0) - 97)) + String(9 - Number(square[1]))
}
function rotateMove(move: string): string { return rotateSquare(move.slice(0, 2)) + rotateSquare(move.slice(2)) }

test('rotating the board and swapping sides preserves owner-relative wings and the legal change', () => {
  const fen = position({ e9: 'k', d0: 'K', h9: 'r', h7: 'c', i0: 'R' }, 'black')
  const step = facts(laneMoves.map(rotateMove), fen).steps[0]
  assert.equal(step.side, 'black')
  assert.equal(step.fromSquare, 'h7')
  assert.equal(step.fromFile, 8)
  assert.equal(step.fromWing, 'left')
  assert.equal(step.toFile, 5)
  assert.equal(step.toWing, 'center')
  assert.deepEqual(step.futureMoveLegalityChanges.map(change => [change.side, change.fromSquare, change.beforeLegal, change.afterLegal]),
    [['black', 'h9', false, true]])
})

test('the same physical wing belongs to opposite owner-relative wings', () => {
  const result = facts(['h2e2', 'h9g7', 'h0g2', 'i9h9', 'g3g4', 'h7i7'])
  assert.deepEqual(result.steps.map(step => [step.side, step.fromFile, step.fromWing, step.toWing]), [
    ['red', 2, 'right', 'center'], ['black', 8, 'left', 'left'],
    ['red', 2, 'right', 'right'], ['black', 9, 'left', 'left'],
    ['red', 3, 'right', 'right'], ['black', 8, 'left', 'left']
  ])
})

test('opening an opponent rook route is not mislabeled as a same-side future mechanism', () => {
  const fen = position({ e0: 'K', f9: 'k', b0: 'R', b2: 'C', b9: 'r' })
  const step = facts(['b2e2', 'b9b0', 'e0e1'], fen).steps[0]
  assert.deepEqual(step.coverage.futureOwnPliesConsidered, [3])
  assert.deepEqual(step.futureMoveLegalityChanges, [])
})

test('only this variation can supply future moves, even when another variation has the same position', () => {
  const first = evidence(laneMoves, lanePosition, 'best')
  const second = evidence(['b2e2', 'a9a8', 'e0d0'], lanePosition, 'user')
  const firstResult = buildVariationMechanismFacts(first)
  const secondResult = buildVariationMechanismFacts(second)
  assert.equal(firstResult.evidenceId, 'best')
  assert.equal(secondResult.evidenceId, 'user')
  assert.equal(firstResult.steps[0].futureMoveLegalityChanges[0].move, '車八進六')
  assert.deepEqual(secondResult.steps[0].futureMoveLegalityChanges, [])
})

test('the actual-move evidence selects its own UCI line instead of the root analysis line', () => {
  const item = evidence(openingMoves)
  item.move = 'h2e2'
  item.analysis.userMove = 'h2e2'
  item.analysis.userMovePrincipalVariation = ['h2e2', 'h9g7', 'h0g2']
  const parsed = parseFen(START_FEN)
  assert.ok(parsed.valid)
  item.displayPrincipalVariation = formatChineseVariation(parsed.board, item.analysis.userMovePrincipalVariation)
  const result = buildVariationMechanismFacts(item)
  assert.equal(result.steps[0].move, '炮二平五')
  assert.equal(result.scope.sourcePlies, 3)
  assert.deepEqual(result.steps[0].futureMoveLegalityChanges, [])
})

test('clearing a geometric path cannot release a rook still pinned to its king', () => {
  const fen = position({ e0: 'K', f9: 'k', e1: 'R', d1: 'C', e8: 'r' })
  const step = facts(['d1d2', 'e8f8', 'e1a1'], fen).steps[0]
  assert.deepEqual(step.coverage.futurePliesChecked, [3])
  assert.deepEqual(step.futureMoveLegalityChanges, [])
})

test('kings-facing legality is retained when a blocking cannon moves away', () => {
  const fen = position({ e0: 'K', e9: 'k', e4: 'R', d4: 'C' })
  const step = facts(['d4d5', 'e9f9', 'e4a4'], fen).steps[0]
  assert.deepEqual(step.coverage.futurePliesChecked, [3])
  assert.deepEqual(step.futureMoveLegalityChanges, [])
})

test('resolving check changes future legality without inventing a geometric lane explanation', () => {
  const fen = position({ e0: 'K', f9: 'k', e1: 'R', d1: 'C', a0: 'r' })
  const step = facts(['d1d0', 'a0a1', 'e1f1'], fen).steps[0]
  assert.deepEqual(step.futureMoveLegalityChanges.map(change => [change.move, change.beforeLegal, change.afterLegal]),
    [['車五平四', false, true]])
  assert.match(step.futureMoveLegalityChanges[0].beforeConstraint ?? '', /被將軍/)
  assert.equal(step.futureMoveLegalityChanges[0].afterConstraint, null)
  assert.equal(/馬腿/.test(step.futureMoveLegalityChanges[0].beforeConstraint ?? ''), false)
})

test('advancing the actual horse-leg pawn exposes the existing checker reason rather than a guessed strategic purpose', () => {
  const result = facts(['h2e2', 'h9g7', 'h0g2', 'i9h9', 'g3g4', 'h7i7', 'b0c2', 'c6c5', 'b2b6', 'g9e7', 'g2f4'])
  const change = result.steps[4].futureMoveLegalityChanges.find(item => item.futurePly === 11)
  assert.ok(change)
  assert.equal(change.beforeLegal, false)
  assert.equal(change.afterLegal, true)
  assert.equal(change.beforeConstraint, '蹩馬腿：馬腿位置有棋子。')
  assert.equal(change.afterConstraint, null)
})

test('moved-piece capture opportunities compare different before and after targets', () => {
  const fen = position({ e0: 'K', f9: 'k', a1: 'R', a5: 'p', b5: 'p' })
  const step = facts(['a1b1'], fen).steps[0]
  assert.deepEqual(step.captureOpportunities.added, [{ square: 'b5', side: 'black', piece: 'pawn' }])
  assert.deepEqual(step.captureOpportunities.removed, [{ square: 'a5', side: 'black', piece: 'pawn' }])
  assert.equal(step.actualCapture, null)
})

test('a real capture is separate from removed and newly available capture opportunities', () => {
  const fen = position({ e0: 'K', f9: 'k', a1: 'R', a5: 'p', b5: 'p' })
  const step = facts(['a1a5'], fen).steps[0]
  assert.deepEqual(step.actualCapture, { square: 'a5', side: 'black', piece: 'pawn' })
  assert.deepEqual(step.captureOpportunities.removed, [{ square: 'a5', side: 'black', piece: 'pawn' }])
  assert.deepEqual(step.captureOpportunities.added, [{ square: 'b5', side: 'black', piece: 'pawn' }])
})

test('persistent targets are not new opportunities and pinned captures are excluded', () => {
  const fen = position({ e0: 'K', f9: 'k', e1: 'R', e8: 'r', a2: 'p' })
  const step = facts(['e1e2'], fen).steps[0]
  assert.deepEqual(step.captureOpportunities.added, [])
  assert.deepEqual(step.captureOpportunities.removed, [])
  assert.equal(step.actualCapture, null)
})

test('a king is never emitted as a capture opportunity', () => {
  const fen = position({ e0: 'K', f9: 'k', a1: 'R' })
  const step = facts(['a1f1'], fen).steps[0]
  assert.deepEqual(step.captureOpportunities.added, [])
})

test('another rook replacing a captured rook cannot borrow the original piece identity', () => {
  const fen = position({ e0: 'K', f9: 'k', a0: 'R', b0: 'R', d2: 'C', b9: 'r' })
  const step = facts(['d2e2', 'b9b0', 'a0b0', 'f9f8', 'b0b6'], fen).steps[0]
  assert.deepEqual(step.coverage.futurePliesChecked, [3])
  assert.deepEqual(step.futureMoveLegalityChanges, [])
})

test('a piece that moves away and returns is not treated as an unmoved future piece', () => {
  const fen = position({ e0: 'K', f9: 'k', b0: 'R', c2: 'C' })
  const step = facts(['c2e2', 'f9f8', 'b0a0', 'f8f9', 'a0b0', 'f9f8', 'b0b6'], fen).steps[0]
  assert.deepEqual(step.coverage.futureOwnPliesConsidered, [3, 5, 7])
  assert.deepEqual(step.coverage.futurePliesChecked, [3])
})

test('an illegal tail is never used for either step facts or future mechanisms', () => {
  const item = evidence(['b2e2', 'a9a8', 'b0b6', 'e0e1', 'b6b9'], lanePosition)
  const result = buildVariationMechanismFacts(item)
  assert.equal(result.scope.sourcePlies, 5)
  assert.equal(result.scope.replayedPlies, 3)
  assert.equal(result.steps.length, 3)
  assert.match(result.warning ?? '', /4/)
  assert.equal(result.truncated, true)
  assert.ok(result.steps.every(step => step.coverage.futureOwnPliesConsidered.every(ply => ply <= 3)))
})

test('a wrong display label stops replay before the mismatched ply and invalidates its future use', () => {
  const item = evidence(laneMoves, lanePosition)
  item.displayPrincipalVariation[2] = '車二進六'
  const result = buildVariationMechanismFacts(item)
  assert.equal(result.scope.replayedPlies, 2)
  assert.match(result.warning ?? '', /中文/)
  assert.deepEqual(result.steps[0].futureMoveLegalityChanges, [])
})

test('the full parser-bounded PV is replayed while future lookahead and omissions stay explicit', () => {
  const fen = position({ e0: 'K', f9: 'k', a0: 'R', i9: 'r' })
  const cycle = ['a0a1', 'i9i8', 'a1a0', 'i8i9']
  const item = evidence(Array.from({ length: 65 }, () => cycle).flat(), fen)
  const result = buildVariationMechanismFacts(item)
  assert.equal(result.scope.sourcePlies, 260)
  assert.equal(result.scope.maxSourcePlies, 256)
  assert.equal(result.scope.replayedPlies, 256)
  assert.equal(result.steps.at(-1)?.ply, 256)
  assert.equal(result.truncated, true)
  assert.match(result.warning ?? '', /256/)
  assert.deepEqual(result.steps[0].coverage.futureOwnPliesConsidered, [3, 5, 7, 9])
  assert.equal(result.steps[0].coverage.omittedFutureOwnPlies, 123)
  assert.equal(result.scope.maxFutureOwnPlies, 4)
  assert.equal(result.scope.maxLegalityChangesPerStep, 2)
  assert.equal(result.scope.maxCaptureChangesPerKind, 8)
  assert.equal(result.scope.wingPerspective, 'piece_owner')
  assert.equal(result.scope.captureOpportunityMeaning, 'fixed_board_same_side_to_move')
})

test('a change-record cap reports omitted real legality changes rather than suppressing them silently', () => {
  // Red is in check along the bottom rank. Interposing the cannon makes several
  // otherwise unrelated real future moves legal on this fixed board.
  const fen = position({ e0: 'K', f9: 'k', d1: 'C', a0: 'r', a2: 'R', b2: 'N', i2: 'R' })
  const result = facts(['d1d0', 'a0b0', 'a2a3', 'b0a0', 'b2c4', 'a0b0', 'i2i3'], fen)
  const step = result.steps[0]
  assert.equal(step.futureMoveLegalityChanges.length, 2)
  assert.deepEqual(step.coverage.futurePliesChecked, [3, 5, 7])
  assert.equal(step.coverage.omittedLegalityChanges, 1)
  assert.equal(result.truncated, true)
})

test('invalid or absent evidence returns no inferred mechanisms', () => {
  const empty = buildVariationMechanismFacts(evidence([]))
  assert.deepEqual(empty.steps, [])
  assert.ok(empty.warning)
  const invalid = buildVariationMechanismFacts({ ...evidence([]), positionFen: 'invalid' })
  assert.deepEqual(invalid.steps, [])
  assert.ok(invalid.warning)
})

test('board replay preserves actual piece identity and the input evidence is unchanged', () => {
  const parsed = parseFen(lanePosition)
  assert.ok(parsed.valid)
  const rook = parsed.board.grid[9][1]
  const moved = applyUciMove(parsed.board, 'b2e2')
  assert.ok(moved.valid)
  assert.equal(moved.board.grid[9][1], rook)
  const item = evidence(laneMoves, lanePosition)
  const snapshot = JSON.stringify(item)
  buildVariationMechanismFacts(item)
  assert.equal(JSON.stringify(item), snapshot)
})

console.log(`Variation mechanism facts: ${passed} passed, ${failed} failed`)
if (failed) process.exitCode = 1
