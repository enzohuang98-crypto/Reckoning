import { validateVariationBoardStatements as validate } from '../../../src/main/ai/VariationBoardFacts'
import { START_FEN } from '../../../src/shared/types/BoardState'
import type { HarnessEvidence } from '../../../src/shared/types/Harness'

let passed = 0
let failed = 0
function check(name: string, condition: boolean): void {
  if (condition) { passed += 1; console.log(`  ✓ ${name}`) }
  else { failed += 1; console.error(`  ✗ ${name}`) }
}

function evidence(moves: string[], display: string[], fen = START_FEN): HarnessEvidence {
  return {
    id: 'E1', engineId: 'fixture', engineName: 'Fixture', purpose: 'Computed facts',
    positionFen: fen, depth: 12, score: null, displayPrincipalVariation: display,
    analysis: { principalVariation: moves, candidateMoves: [] }
  } as HarnessEvidence
}

const opening = evidence(['h2e2', 'h9g7'], ['炮二平五', '馬8進7'])
const capture = evidence(['a1a9'], ['車九進八'], 'p3k4/9/9/9/4p4/9/9/9/R8/4K4 w - - 0 1')
const noCapture = evidence(['a1a9'], ['車九進八'], '4k4/9/9/9/4p4/9/9/9/R8/4K4 w - - 0 1')

check('the opening cannon belongs to Red, not Black', validate('黑方炮二平五立即在中路吃掉紅方車。', [opening]).length > 0)
check('the opening horse belongs to Black and does not check or capture', validate('紅方以馬8進7跳馬將軍並吃掉黑方炮。', [opening]).length > 0)
check('correct opening side and deployment remain acceptable', validate('紅方炮二平五建立中炮，黑方以馬8進7發展右翼馬。', [opening]).length === 0)
check('the opening moves do not capture or check', validate('炮二平五沒有吃子，馬8進7未將軍。', [opening]).length === 0)
check('an invented move cannot evade facts by being absent from the cited PV', validate('紅方車九平五吃掉黑方炮並將軍。', [opening]).length > 0)
check('a fact assertion without any replayable evidence fails closed', validate('紅方車九平五吃掉黑方炮並將軍。', []).length > 0)
check('a different valid move cannot borrow facts from an unrelated cited line', validate('黑方炮8平5吃掉紅方車。', [opening]).length > 0)
check('a copular denial of check is not an affirmative check', validate('炮二平五不是將軍。', [opening]).length === 0)
check('an explicit negated check predicate remains acceptable', validate('炮二平五並非直接將軍。', [opening]).length === 0)
check('a correct negated capture predicate does not assert a capture', validate('炮二平五並不是吃子。', [opening]).length === 0)
check('a negated check does not exempt the next affirmative check', validate('炮二平五不是將軍但這步已經將軍。', [opening]).length > 0)
check('a real check cannot be denied with a copular predicate', validate('車九進八不是將軍。', [capture]).length > 0)
check('a hypothetical later check is not an assertion about this ply', validate('炮二平五後如果對手改走另一條線，未來可能將軍或吃掉黑方車。', [opening]).length === 0)
check('bounded uncertainty is not an assertion that a capture occurred', validate('無法確認炮二平五的更遠後續是否吃掉黑方車。', [opening]).length === 0)
check('a later possibility cannot exempt an already asserted capture', validate('炮二平五已經吃掉黑方車並可能改善中路。', [opening]).length > 0)
check('a denied conclusion cannot exempt a separate affirmative check', validate('炮二平五沒有吃子但已經將軍並可能改善中路。', [opening]).length > 0)
check('uncertainty about a future line cannot exempt a present capture', validate('炮二平五的後續無法確認但這步已經吃掉黑方車。', [opening]).length > 0)
check('a hypothetical capture does not exempt a separate asserted check', validate('炮二平五未來可能吃子但這步已經將軍。', [opening]).length > 0)
check('a new coordinated present fact is checked independently', validate('炮二平五可能改善中路並已經吃掉黑方車。', [opening]).length > 0)
check('already inside a conditional premise is not a present assertion', validate('如果炮二平五已經吃掉黑方車，應重新確認棋盤。', [opening]).length === 0)
check('each capture assertion is checked instead of just the first', validate('炮二平五沒有吃子但吃掉黑方車。', [opening]).length > 0)
check('denying capture of a rook does not deny the actual pawn capture', validate('車九進八沒有吃掉黑方車。', [capture]).length === 0)
check('a replayed rook capture and check pass', validate('紅方車九進八吃掉黑方卒並將軍。', [capture]).length === 0)
check('the captured piece cannot be changed from pawn to cannon', validate('車九進八吃掉黑方炮並將軍。', [capture]).length > 0)
check('the captured side cannot be changed from Black to Red', validate('車九進八吃掉紅方兵。', [capture]).length > 0)
check('a computed capture cannot be denied', validate('車九進八沒有吃子。', [capture]).length > 0)
check('a computed check cannot be denied', validate('車九進八沒有將軍。', [capture]).length > 0)
check('the same display move with conflicting evidence is ambiguous', validate('車九進八吃掉黑方卒。', [capture, { ...noCapture, id: 'E2' }]).length > 0)
check('capture ambiguity does not erase a check fact agreed by both replays', validate('紅方車九進八將軍。', [capture, { ...noCapture, id: 'E2' }]).length === 0)
check('missing UCI facts cannot establish a specific capture', validate('炮二平五吃掉黑方車。', [evidence([], ['炮二平五'])]).length > 0)
check('an illegal line cannot establish a check', validate('馬8進7將軍。', [evidence(['h9g7'], ['馬8進7'])]).length > 0)
check('a plain strategic explanation is not independently certified or rejected', validate('炮二平五有助於中央子力協調。', [evidence([], ['炮二平五'])]).length === 0)

console.log(`\nVariation board statements: ${passed} passed, ${failed} failed`)
if (failed) process.exitCode = 1
