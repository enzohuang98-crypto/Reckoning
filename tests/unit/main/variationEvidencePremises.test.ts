import assert from 'node:assert/strict'
import { buildVariationEvidencePremises, validatePremiseReferences } from '../../../src/main/ai/VariationEvidencePremises'
import { buildVariationMechanismFacts } from '../../../src/main/ai/VariationMechanismFacts'
import { formatChineseVariation } from '../../../src/shared/logic/board/ChineseNotation'
import { parseFen } from '../../../src/shared/logic/board/fen'
import { START_FEN } from '../../../src/shared/types/BoardState'
import type { HarnessEvidence } from '../../../src/shared/types/Harness'

let passed = 0
let failed = 0
function test(name: string, run: () => void): void {
  try { run(); passed++; console.log(`  ✓ ${name}`) }
  catch (error) { failed++; console.error(`  ✗ ${name}: ${error instanceof Error ? error.message : String(error)}`) }
}

function evidence(moves: string[], id = 'E1', fen = START_FEN): HarnessEvidence {
  const parsed = parseFen(fen)
  assert.ok(parsed.valid)
  return { id, engineId: 'fixture', engineName: 'Fixture', purpose: 'Premise presentation', positionFen: fen,
    depth: 12, score: null, displayPrincipalVariation: formatChineseVariation(parsed.board, moves),
    analysis: { principalVariation: moves, candidateMoves: [] } } as HarnessEvidence
}

const bestEvidence = evidence(['b2e2', 'b9c7', 'b0c2', 'a9b9', 'a0b0', 'c6c5', 'b0b6'])
const userEvidence = evidence(['h2e2', 'h9g7', 'h0g2', 'i9h9', 'g3g4', 'h7i7', 'b0c2', 'c6c5', 'b2b6', 'g9e7', 'g2f4'], 'E2')

test('all legal moves retain ordinary observations and stable unique evidence-scoped IDs', () => {
  const first = buildVariationEvidencePremises(bestEvidence)
  const second = buildVariationEvidencePremises(bestEvidence)
  assert.deepEqual(first, second)
  assert.deepEqual(first.items.filter(item => item.kind === 'move_observation').map(item => [item.ply, item.moves]),
    bestEvidence.displayPrincipalVariation.map((move, index) => [index + 1, [move]]))
  const other = buildVariationEvidencePremises(userEvidence)
  const ids = [...first.items, ...other.items].map(item => item.id)
  assert.equal(new Set(ids).size, ids.length)
  assert.ok(first.items.every(item => item.id.startsWith('E1:') && item.evidenceId === 'E1'))
  assert.ok(other.items.every(item => item.id.startsWith('E2:') && item.evidenceId === 'E2'))
})

test('the opening horse and rook observations expose the actual useful computed relations', () => {
  const result = buildVariationEvidencePremises(bestEvidence)
  const release = result.items.find(item => item.kind === 'future_move_legality_change' && item.ply === 3)
  assert.ok(release)
  assert.deepEqual(release.relatedPlies, [3, 5])
  assert.deepEqual(release.moves, ['馬八進七', '車九平八'])
  assert.match(release.text, /不合法變合法/)
  assert.match(release.text, /固定盤面/)
  assert.match(release.text, /尚未移動/)
  const rookCapture = result.items.find(item => item.kind === 'capture_opportunity_added' && item.ply === 5)
  assert.ok(rookCapture)
  assert.match(rookCapture.text, /黑方.*炮.*b7/)
  const advancedRook = result.items.filter(item => item.kind === 'capture_opportunity_added' && item.ply === 7)
  assert.ok(advancedRook.some(item => item.text.includes('a6')))
  assert.ok(advancedRook.some(item => item.text.includes('e6')))
})

test('the actual line exposes pawn-to-horse legality and real capture targets without inventing rook threats', () => {
  const result = buildVariationEvidencePremises(userEvidence)
  const release = result.items.find(item => item.kind === 'future_move_legality_change' && item.ply === 5 && item.relatedPlies.includes(11))
  assert.ok(release)
  assert.deepEqual(release.moves, ['兵三進一', '馬三進四'])
  assert.match(release.text, /走前棋規檢查：蹩馬腿/)
  const horseTargets = result.items.filter(item => item.kind === 'capture_opportunity_added' && item.ply === 11)
  assert.ok(horseTargets.some(item => item.text.includes('e6')))
  assert.ok(horseTargets.some(item => item.text.includes('g6')))
  assert.equal(result.items.some(item => item.kind === 'capture_opportunity_added' && item.ply === 4), false)
  const blackRelease = result.items.find(item => item.kind === 'future_move_legality_change' && item.ply === 2)
  assert.deepEqual(blackRelease?.moves, ['馬8進7', '車9平8'])
})

test('black file three is its right wing, never the center or the opponent perspective', () => {
  const result = buildVariationEvidencePremises(userEvidence)
  const pawn = result.items.find(item => item.kind === 'move_observation' && item.ply === 8)
  assert.ok(pawn)
  assert.match(pawn.text, /黑方/)
  assert.match(pawn.text, /3路.*右翼/)
  assert.ok(pawn.text.includes('c6') && pawn.text.includes('c5'))
  assert.equal(pawn.text.includes('中路'), false)
  const cannonTarget = result.items.find(item => item.kind === 'capture_opportunity_added' && item.ply === 6)
  assert.ok(cannonTarget)
  assert.match(cannonTarget.text, /紅方.*1路.*右翼.*兵.*i3/)
})

test('rotating and swapping the moving side preserves its own file eight and left wing', () => {
  const item = evidence(['h7e7', 'i0i1', 'h9h3'], 'mirror', '4k2r1/9/7c1/9/9/9/9/9/9/3K4R b - - 0 1')
  const result = buildVariationEvidencePremises(item)
  assert.equal(result.warning, null)
  const move = result.items.find(premise => premise.kind === 'move_observation' && premise.ply === 1)
  assert.ok(move)
  assert.match(move.text, /黑方.*8路.*左翼/)
  assert.match(move.text, /5路.*中路/)
})

test('ordinary observations separate a real capture from capture-opportunity additions and removals', () => {
  const item = evidence(['a1a5'], 'capture', '5k3/9/9/9/pp7/9/9/9/R8/4K4 w - - 0 1')
  const result = buildVariationEvidencePremises(item)
  assert.equal(result.warning, null)
  const ordinary = result.items.find(premise => premise.kind === 'move_observation')
  const removed = result.items.find(premise => premise.kind === 'capture_opportunity_removed')
  const added = result.items.find(premise => premise.kind === 'capture_opportunity_added')
  assert.ok(ordinary && removed && added)
  assert.match(ordinary.text, /本手吃掉黑方.*卒.*a5/)
  assert.match(removed.text, /機會.*減少|減少.*機會/)
  assert.ok(removed.text.includes('a5'))
  assert.ok(added.text.includes('b5'))
  assert.equal(removed.text.includes('本手未吃子'), false)
  assert.equal(added.text.includes('本手吃掉'), false)
})

test('presentation contains observations, not forced threats, advantages or a claimed unique mechanism', () => {
  const pools = [bestEvidence, userEvidence].map(buildVariationEvidencePremises)
  assert.ok(pools.flatMap(pool => pool.items).every(item => !/必然|被迫|優勢|必勝|唯一原因/.test(item.text)))
  assert.ok(pools.every(pool => pool.scope.coverageNotice.includes('固定盤面') && pool.scope.coverageNotice.includes('不代表')))
  assert.ok(pools.every(pool => !('steps' in pool)))
})

test('presentation is smaller than the duplicate raw mechanism structures while retaining every move', () => {
  const evidenceList = [bestEvidence, userEvidence]
  const concise = evidenceList.map(buildVariationEvidencePremises)
  const raw = evidenceList.map(buildVariationMechanismFacts)
  assert.ok(JSON.stringify(concise).length < JSON.stringify(raw).length)
  assert.equal(concise.flatMap(pool => pool.items).filter(item => item.kind === 'move_observation').length, 18)
})

test('ordinary move observations are valid reference links without requiring a tactical premise', () => {
  const pool = buildVariationEvidencePremises(userEvidence)
  const move = pool.items.find(item => item.kind === 'move_observation' && item.ply === 2)!
  assert.deepEqual(validatePremiseReferences({ text: '黑方马８进７將馬由八路移到七路。', evidenceIds: ['E2'], premiseIds: [move.id] }, [pool]), [])
})

test('unknown, duplicate and wrong-line IDs are rejected independently of valid move wording', () => {
  const best = buildVariationEvidencePremises(bestEvidence)
  const user = buildVariationEvidencePremises(userEvidence)
  const id = user.items.find(item => item.kind === 'move_observation' && item.ply === 1)!.id
  assert.ok(validatePremiseReferences({ text: '炮二平五移炮至中路。', evidenceIds: ['E2'], premiseIds: ['missing'] }, [best, user]).some(error => error.includes('不存在')))
  assert.ok(validatePremiseReferences({ text: '炮二平五移炮至中路。', evidenceIds: ['E1'], premiseIds: [id] }, [best, user]).some(error => error.includes('變例')))
  assert.ok(validatePremiseReferences({ text: '炮二平五移炮至中路。', evidenceIds: ['E2'], premiseIds: [id, id] }, [best, user]).some(error => error.includes('重複')))
})

test('valid IDs cannot support visible prose that mentions none of their source moves', () => {
  const pool = buildVariationEvidencePremises(userEvidence)
  const premise = pool.items.find(item => item.kind === 'capture_opportunity_added' && item.ply === 11)!
  assert.ok(validatePremiseReferences({ text: '炮二平五帶來新的作用。', evidenceIds: ['E2'], premiseIds: [premise.id] }, [pool]).some(error => error.includes('著法')))
  assert.deepEqual(validatePremiseReferences({ text: '馬三進四後，馬出現對中卒的合法吃子機會。', evidenceIds: ['E2'], premiseIds: [premise.id] }, [pool]), [])
})

test('future legality links require both the source move and the future move in visible prose', () => {
  const pool = buildVariationEvidencePremises(bestEvidence)
  const premise = pool.items.find(item => item.kind === 'future_move_legality_change' && item.ply === 3)!
  for (const text of ['馬八進七改善車的通行。', '車九平八現在可以走。', premise.id]) {
    assert.ok(validatePremiseReferences({ text, evidenceIds: ['E1'], premiseIds: [premise.id] }, [pool]).some(error => error.includes('著法')))
  }
  assert.deepEqual(validatePremiseReferences({ text: '馬八進七前後比較，車九平八由不合法變合法。', evidenceIds: ['E1'], premiseIds: [premise.id] }, [pool]), [])
})

test('red and black notation identities are not collapsed by reference matching', () => {
  const pool = buildVariationEvidencePremises(userEvidence)
  const premise = pool.items.find(item => item.kind === 'move_observation' && item.ply === 2)!
  assert.ok(validatePremiseReferences({ text: '馬八進七發展紅馬。', evidenceIds: ['E2'], premiseIds: [premise.id] }, [pool]).length > 0)
})

test('references are bounded to four, with absence left to the caller contract', () => {
  const pool = buildVariationEvidencePremises(userEvidence)
  const moves = pool.items.filter(item => item.kind === 'move_observation').slice(0, 5)
  const text = moves.flatMap(item => item.moves).join('、')
  assert.deepEqual(validatePremiseReferences({ text, evidenceIds: ['E2'], premiseIds: moves.slice(0, 4).map(item => item.id) }, [pool]), [])
  assert.ok(validatePremiseReferences({ text, evidenceIds: ['E2'], premiseIds: moves.map(item => item.id) }, [pool]).some(error => error.includes('4')))
  assert.deepEqual(validatePremiseReferences({ text, evidenceIds: ['E2'] }, [pool]), [])
  assert.deepEqual(validatePremiseReferences({ text, evidenceIds: ['E2'], premiseIds: [] }, [pool]), [])
})

test('ambiguous duplicate premise IDs in source pools cannot silently overwrite one another', () => {
  const pool = buildVariationEvidencePremises(bestEvidence)
  const id = pool.items[0].id
  assert.ok(validatePremiseReferences({ text: '炮八平五。', evidenceIds: ['E1'], premiseIds: [id] }, [pool, pool]).some(error => error.includes('不唯一')))
})

test('the verified prefix and future lookahead remain explicit through the 256-ply source cap', () => {
  const cycle = ['a0a1', 'i9i8', 'a1a0', 'i8i9']
  const item = evidence(Array.from({ length: 65 }, () => cycle).flat(), 'long', '5k2r/9/9/9/9/9/9/9/9/R3K4 w - - 0 1')
  const result = buildVariationEvidencePremises(item)
  assert.equal(result.scope.sourcePlies, 260)
  assert.equal(result.scope.replayedPlies, 256)
  assert.equal(result.scope.omittedSourcePlies, 4)
  assert.equal(result.scope.maxFutureOwnPlies, 4)
  assert.equal(result.scope.maxLegalityChangesPerStep, 2)
  assert.equal(result.items.filter(premise => premise.kind === 'move_observation').length, 256)
  assert.ok(result.items.some(premise => premise.ply === 256))
  assert.ok(result.scope.omittedByPly.some(omission => omission.ply === 1 && omission.futureOwnPlies === 123))
  assert.equal(result.truncated, true)
  assert.match(result.warning ?? '', /256/)
})

test('invalid display tails yield no premise IDs beyond the verified prefix', () => {
  const item = evidence(bestEvidence.analysis.principalVariation)
  item.displayPrincipalVariation[2] = '馬二進三'
  const result = buildVariationEvidencePremises(item)
  assert.equal(result.scope.replayedPlies, 2)
  assert.equal(result.scope.omittedSourcePlies, 5)
  assert.ok(result.items.every(premise => premise.relatedPlies.every(ply => ply <= 2)))
  assert.ok(result.warning)
  assert.equal(result.truncated, true)
})

console.log(`Variation evidence premises: ${passed} passed, ${failed} failed`)
if (failed) process.exitCode = 1
