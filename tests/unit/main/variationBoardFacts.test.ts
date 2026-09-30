import {
  buildVariationBoardFacts,
  summarizeVariationCaptures,
  VARIATION_BOARD_FACT_MAX_PLIES,
  validateVariationBoardStatements as validate
} from '../../../src/main/ai/VariationBoardFacts'
import { START_FEN } from '../../../src/shared/types/BoardState'
import { canonicalChineseMoveNotation, chineseMoveIsMentioned, formatChineseVariation } from '../../../src/shared/logic/board/ChineseNotation'
import { parseFen } from '../../../src/shared/logic/board/fen'
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

check('black file notation normalizes only its mixed destination', canonicalChineseMoveNotation('馬8進七') === '馬8進7')
check('red file notation normalizes only its mixed destination', canonicalChineseMoveNotation('馬八進7') === '馬八進七')
check('red and black file identities do not collapse', canonicalChineseMoveNotation('馬八進七') !== canonicalChineseMoveNotation('馬8進7'))
check('fullwidth and simplified spelling normalize deterministically', canonicalChineseMoveNotation('马８进７') === '馬8進7')
check('prefix moves retain the destination convention that distinguishes sides', canonicalChineseMoveNotation('后马进７') === '後馬進7' && canonicalChineseMoveNotation('後馬進7') !== canonicalChineseMoveNotation('後馬進七'))
check('a recognized mixed spelling satisfies mention checks', chineseMoveIsMentioned('對手可走马８进七。', '馬8進7'))
check('another side notation cannot satisfy mention checks', !chineseMoveIsMentioned('對手可走馬八進7。', '馬8進7'))
check('non-notation fixture labels retain literal matching', chineseMoveIsMentioned('Reply is Black horse.', 'Black horse'))
check('extra prose is not accepted as a canonical move', canonicalChineseMoveNotation('馬8進7吃車') === null)

check('the opening cannon belongs to Red, not Black', validate('黑方炮二平五立即在中路吃掉紅方車。', [opening]).length > 0)
check('the opening horse belongs to Black and does not check or capture', validate('紅方以馬8進7跳馬將軍並吃掉黑方炮。', [opening]).length > 0)
check('correct opening side and deployment remain acceptable', validate('紅方炮二平五建立中炮，黑方以馬8進7發展右翼馬。', [opening]).length === 0)
check('mixed destination numerals still bind to the same black horse fact', validate('黑方以馬8進七發展右翼馬。', [opening]).length === 0)
check('mixed destination numerals still bind to the same red cannon fact', validate('紅方炮二平5建立中炮。', [opening]).length === 0)
check('fullwidth numerals and simplified move characters bind to the same fact', validate('黑方马８进７沒有吃子也沒有將軍。', [opening]).length === 0)
check('a red horse with a mixed destination binds to its actual red ply', validate('紅方馬二進3沒有吃子。', [evidence(['h2e2', 'h9g7', 'h0g2'], ['炮二平五', '馬8進7', '馬二進三'])]).length === 0)
check('mixed notation does not waive the actual side', validate('紅方馬8進七沒有吃子。', [opening]).length > 0)
check('fullwidth notation does not make a fabricated capture valid', validate('黑方马８进７吃掉紅方車。', [opening]).length > 0)
check('red file notation cannot borrow facts from a black-file cited move', validate('黑方馬八進7沒有吃子。', [opening]).length > 0)
check('mixed notation cannot borrow a fact from an uncited variation', validate('黑方馬8進七沒有吃子。', [capture]).length > 0)
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

// The real ply-18 alternatives both lose a black cannon to a red horse.
// A material prompt must expose that common event without inventing a verdict.
const ply18Fen = 'r1bakab1r/9/2n3c1n/p3p3p/2P3p2/1N3NP2/P3c3P/1C2B2C1/4A4/R1BAK3R b - - 1 9'
function replayEvidence(id: string, moves: string[], fen = ply18Fen): HarnessEvidence {
  return { ...evidence(moves, formatChineseVariation(parseFen(fen).board, moves), fen), id }
}
const bestPly18 = replayEvidence('E1', ['g5g4', 'c5c6', 'g4f4', 'b4d5', 'i9h9', 'd5e3'])
const actualPly18 = replayEvidence('E2', ['g7g4', 'c5c6', 'g4b4', 'f4d5', 'c7b9', 'd5e3'])
const summarize = summarizeVariationCaptures
const ply18Summary = summarize([bestPly18, actualPly18])
check('capture summaries expose the existing bounded engine PV limit', VARIATION_BOARD_FACT_MAX_PLIES === 256 && ply18Summary[0]?.includes('最多前 256 手') === true)
check('real best line identifies the pawn and red horse captures exactly', ply18Summary.includes('E1 第 1 手：黑方卒走卒7進1，吃掉紅方兵。') && ply18Summary.includes('E1 第 3 手：黑方卒走卒7平6，吃掉紅方馬。'))
check('real actual line identifies its cannon as the capturing piece', ply18Summary.includes('E2 第 1 手：黑方炮走炮7進3，吃掉紅方兵。') && ply18Summary.includes('E2 第 3 手：黑方炮走炮7平2，吃掉紅方馬。'))
check('both real lines identify the red horse capturing the black cannon', ['E1', 'E2'].every((id) => ply18Summary.includes(`${id} 第 6 手：紅方馬走馬六退五，吃掉黑方炮。`)))
check('the common cannon loss cannot be presented as exclusive to E2', ply18Summary.some((line) => line.includes('共同出現被吃黑方炮') && line.includes('E1 第 6 手') && line.includes('E2 第 6 手') && line.includes('不能據此稱為某一條變例獨有')))
check('shared capture categories include the red pawn and horse', ['兵', '馬'].every((piece) => ply18Summary.some((line) => line.includes(`共同出現被吃紅方${piece}`))))
const oneCaptureFen = capture.positionFen
const uniqueCaptureSummary = summarize([replayEvidence('E1', ['a1a9'], oneCaptureFen), replayEvidence('E2', ['a1a2'], oneCaptureFen)])
check('a genuinely single-line capture is not aggregated as shared', uniqueCaptureSummary.includes('E1 第 1 手：紅方車走車九進八，吃掉黑方卒。') && uniqueCaptureSummary.some((line) => line.startsWith('E2：') && line.includes('未觀察到吃子')) && !uniqueCaptureSummary.some((line) => line.includes('共同出現')))
check('capture categories from different starting boards are never aggregated', !summarize([bestPly18, { ...actualPly18, positionFen: ply18Fen.replace('1 9', '2 9') }]).some((line) => line.includes('共同出現')))
check('duplicate evidence IDs do not establish cross-line common captures', !summarize([bestPly18, { ...actualPly18, id: 'E1' }]).some((line) => line.includes('共同出現')))
const invalidTail = { ...bestPly18, analysis: { ...bestPly18.analysis, principalVariation: ['g5g4', 'a0a9'] } }
const invalidSummary = summarize([invalidTail])
check('illegal tails retain confirmed captures and report the replay boundary', invalidSummary.includes('E1 第 1 手：黑方卒走卒7進1，吃掉紅方兵。') && invalidSummary.some((line) => line.includes('第 2 手未通過合法性檢查')) && !invalidSummary.some((line) => line.includes('黑方炮')))
check('missing PV reports lack of facts without claiming the whole line has no captures', summarize([evidence([], [])]).some((line) => line.includes('沒有 UCI 主線')) && !summarize([evidence([], [])]).some((line) => line.includes('未觀察到吃子')))
check('bad notation cannot leak unverified capture events into summaries', !summarize([{ ...capture, displayPrincipalVariation: ['車九平五'] }]).some((line) => line.includes('吃掉')) && summarize([{ ...capture, displayPrincipalVariation: ['車九平五'] }]).some((line) => line.includes('中文記譜與本變例棋盤不一致')))
const sixteenPlies = Array.from({ length: 4 }, () => ['b0c2', 'b9c7', 'c2b0', 'c7b9']).flat()
const longLine = replayEvidence('E1', sixteenPlies, START_FEN)
check('decision analysis retains the whole provided legal variation beyond twelve plies', buildVariationBoardFacts(longLine).steps.length === 16 && summarize([longLine]).some((line) => line.includes('已重播 16 手') && line.includes('未觀察到吃子')))
const lateDecision = replayEvidence('E1', [...sixteenPlies.slice(0, 12), 'h2e2', 'h9g7'], START_FEN)
check('a correct late-line fact is not rejected because the decisive move follows ply twelve', validate('紅方炮二平五沒有吃子，黑方馬8進7沒有將軍。', [lateDecision]).length === 0)
check('a wrong side in a late-line fact is still rejected', validate('紅方馬8進7沒有將軍。', [lateDecision]).length > 0)
const oversizedLine = replayEvidence('E1', Array.from({ length: 66 }, () => ['b0c2', 'b9c7', 'c2b0', 'c7b9']).flat(), START_FEN)
check('untrusted oversized evidence remains bounded and reports the omitted tail', buildVariationBoardFacts(oversizedLine).steps.length === 256 && buildVariationBoardFacts(oversizedLine).warning !== null)
const selectedUserLine = {
  ...actualPly18,
  move: 'g7g4',
  analysis: {
    ...actualPly18.analysis,
    principalVariation: bestPly18.analysis.principalVariation,
    userMove: 'g7g4',
    userMovePrincipalVariation: actualPly18.analysis.principalVariation
  }
}
check('user-move evidence summarizes its own PV rather than the best PV', summarize([selectedUserLine]).includes('E2 第 1 手：黑方炮走炮7進3，吃掉紅方兵。') && !summarize([selectedUserLine]).some((line) => line.includes('卒7進1')))
check('an invalid starting FEN reports the replay failure without captures', summarize([{ ...capture, positionFen: 'invalid' }]).some((line) => line.includes('證據起始局面無效')) && !summarize([{ ...capture, positionFen: 'invalid' }]).some((line) => line.includes('吃掉')))
check('empty evidence has no purported capture summary', summarize([]).length === 0)

console.log(`\nVariation board statements: ${passed} passed, ${failed} failed`)
if (failed) process.exitCode = 1
