import {
  buildVariationBoardFacts,
  buildVariationCaptureLedger,
  hasAffirmedConcreteVariationRelation,
  modelFacingVariationStep,
  summarizeVariationCaptures,
  VARIATION_BOARD_FACT_MAX_PLIES,
  validateVariationBoardStatements as validate
} from '../../../src/main/ai/VariationBoardFacts'
import { START_FEN } from '../../../src/shared/types/BoardState'
import { canonicalChineseMoveNotation, chineseMoveIsMentioned, formatChineseVariation } from '../../../src/shared/logic/board/ChineseNotation'
import { parseFen } from '../../../src/shared/logic/board/fen'
import { applyUciMove, legalMoveCheck } from '../../../src/shared/logic/board/moves'
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

const rightCannonFacts = buildVariationBoardFacts(opening).steps
const leftCannonFacts = buildVariationBoardFacts(replayEvidence('E1', ['b2e2', 'b9c7'], START_FEN)).steps
check('both central cannons occupy the same absolute square despite different origins',
  rightCannonFacts[0]?.fromSquare === 'h2' && leftCannonFacts[0]?.fromSquare === 'b2' &&
  rightCannonFacts[0]?.toSquare === 'e2' && leftCannonFacts[0]?.toSquare === 'e2')
check('a developed black horse has no direct capture target on the central cannon',
  rightCannonFacts[1]?.fromSquare === 'h9' && rightCannonFacts[1]?.toSquare === 'g7' &&
  rightCannonFacts[1]?.movedPieceCaptureTargets?.length === 0)
check('the central cannon has an exact legally capturable pawn on the fixed resulting board',
  JSON.stringify(rightCannonFacts[0]?.movedPieceCaptureTargets) === JSON.stringify([{ square: 'e6', side: 'black', piece: 'pawn' }]))
check('a capture opportunity is neither a capture already made nor another actual ply',
  rightCannonFacts.length === 2 && rightCannonFacts[0]?.captured === null &&
  rightCannonFacts[1]?.side === 'black' && rightCannonFacts[1]?.move === '馬8進7')
const afterCannon = applyUciMove(parseFen(START_FEN).board, 'h2e2')
if (!afterCannon.valid) throw new Error('Opening cannon fixture must be legal')
const afterCannonSnapshot = JSON.stringify(afterCannon.board)
check('testing a hypothetical capture leaves the actual next side and board unchanged',
  legalMoveCheck(afterCannon.board.grid, 'red', 'e2e6').ok &&
  afterCannon.board.sideToMove === 'black' && JSON.stringify(afterCannon.board) === afterCannonSnapshot)
const pinnedRookFen = '3kr4/9/9/9/9/9/9/p8/4R4/4K4 w - - 0 1'
const pinnedRook = replayEvidence('E1', ['e1e2'], pinnedRookFen)
const afterPinnedRook = applyUciMove(parseFen(pinnedRookFen).board, 'e1e2')
if (!afterPinnedRook.valid) throw new Error('Pinned rook fixture must be legal')
check('a geometrically reachable enemy pawn is excluded when capture exposes the king',
  !legalMoveCheck(afterPinnedRook.board.grid, 'red', 'e2a2').ok &&
  buildVariationBoardFacts(pinnedRook).steps[0]?.movedPieceCaptureTargets?.every((target) => target.square !== 'a2') === true &&
  buildVariationBoardFacts(pinnedRook).steps[0]?.movedPieceCaptureTargets?.some((target) => target.square === 'e9' && target.piece === 'rook') === true)
const checkingRookFacts = buildVariationBoardFacts(capture).steps
check('check remains a separate fact and enemy kings are never capture targets',
  checkingRookFacts[0]?.givesCheck === true &&
  checkingRookFacts[0]?.movedPieceCaptureTargets?.every((target) => target.piece !== 'king') === true)

const horseOpportunity = replayEvidence('E2', [
  'h2e2', 'h9g7', 'h0g2', 'i9h9', 'g3g4', 'h7i7',
  'b0c2', 'c6c5', 'b2b6', 'g9e7', 'g2f4'
], START_FEN)
check('the real red horse opportunity is not mistaken for a capture already made',
  validate('紅方馬三進四雖可吃兵卻同時暴露馬腳。', [horseOpportunity]).length === 0)
check('can and able capture predicates use the same computed opportunities',
  validate('紅方馬三進四可以吃黑方卒，也能吃兵。', [horseOpportunity]).length === 0)
check('a supported cannon opportunity uses the resulting board rather than captured',
  validate('紅方炮二平五能夠吃掉黑方卒。', [opening]).length === 0)
check('a supported black cannon opportunity retains the captured target side',
  validate('黑方炮8平9可吃紅方兵。', [horseOpportunity]).length === 0)
check('king safety still restricts a rook opportunity',
  validate('紅方車五進一可吃黑方車。', [pinnedRook]).length === 0 &&
  validate('紅方車五進一可吃黑方卒。', [pinnedRook]).length > 0)
check('a denied actual capture and an affirmed opportunity can both be true',
  validate('紅方馬三進四沒有吃子但可吃黑方卒。', [horseOpportunity]).length === 0)
check('negated opportunities do not deny an actual capture',
  validate('紅方車九進八已吃黑方卒但不能吃黑方卒。', [capture]).length === 0)
check('a claimed lack of a supported opportunity is rejected',
  validate('紅方馬三進四不能吃黑方卒。', [horseOpportunity]).length > 0)
check('a denied unsupported opportunity is accepted',
  validate('紅方馬三進四不可吃黑方車，也無法吃紅方兵。', [horseOpportunity]).length === 0)
check('a denied supported opportunity using cannot also fails',
  validate('紅方炮二平五無法吃掉黑方卒。', [opening]).length > 0)
check('a false completed capture still fails despite a real opportunity',
  validate('紅方馬三進四已經吃掉黑方卒。', [horseOpportunity]).length > 0)
check('an earlier opportunity never exempts a later completed capture assertion',
  validate('紅方馬三進四可吃黑方卒但這步已經吃掉黑方卒。', [horseOpportunity]).length > 0)
check('opportunities retain wrong-side rejection',
  validate('黑方馬三進四可吃黑方卒。', [horseOpportunity]).length > 0)
check('opportunities cannot borrow a move from an uncited variation',
  validate('紅方馬三進四可吃黑方卒。', [opening]).length > 0)
check('an opportunity with the wrong target type or side is rejected',
  validate('紅方馬三進四可吃黑方車。', [horseOpportunity]).length > 0 &&
  validate('紅方馬三進四可吃紅方兵。', [horseOpportunity]).length > 0)
check('a developed horse cannot claim an immediate cannon capture opportunity',
  validate('黑方馬8進7可吃紅方炮。', [opening]).length > 0)
check('explicit current possibilities are checked against capture targets',
  validate('紅方馬三進四當下可能吃黑方卒。', [horseOpportunity]).length === 0 &&
  validate('黑方馬8進7當下可能吃紅方炮。', [opening]).length > 0)
check('a future conditional is not asserted as a current opportunity',
  validate('紅方炮二平五後如果黑方改走其他變化，未來可能吃黑方車。', [opening]).length === 0)
check('a remote conditional cannot exempt a new current opportunity assertion',
  validate('黑方馬8進7未來可能吃子但此時可吃紅方炮。', [opening]).length > 0)
check('explicit opportunity squares must identify an actual computed target',
  validate('紅方馬三進四可吃黑方e6卒。', [horseOpportunity]).length === 0 &&
  validate('紅方馬三進四可吃黑方a6卒。', [horseOpportunity]).length > 0)
check('completed captures with explicit squares still use the actual captured square',
  validate('紅方車九進八已吃黑方a9卒。', [capture]).length === 0 &&
  validate('紅方車九進八已吃黑方e5卒。', [capture]).length > 0)
check('copular and opportunity denials retain their own target semantics',
  validate('紅方馬三進四並不是可以吃黑方車。', [horseOpportunity]).length === 0 &&
  validate('紅方馬三進四沒有機會吃黑方卒。', [horseOpportunity]).length > 0)
check('a current impossibility cannot deny a legally supported target',
  validate('紅方馬三進四當下不可能吃黑方卒。', [horseOpportunity]).length > 0)
const shiftedPawnLine = replayEvidence('E3', ['e3e4', 'e6e5', 'h2e2'], START_FEN)
check('opportunity ambiguity across cited lines cannot borrow the first matching target',
  validate('紅方炮二平五可吃黑方e6卒。', [opening, shiftedPawnLine]).some((issue) => issue.includes('不同可吃目標')))
check('the option not to capture does not assert a missing or available target',
  validate('紅方馬三進四可以不吃黑方車。', [horseOpportunity]).length === 0 &&
  validate('紅方馬三進四可以不吃黑方車但這步已吃黑方卒。', [horseOpportunity]).length > 0)
check('a current possible capture cannot exempt a coordinated already-captured predicate',
  validate('紅方馬三進四當下可能吃黑方卒並已吃黑方卒。', [horseOpportunity]).length > 0)

check('the real quoted same-actor enumeration rejects its black move assigned to Red',
  validate('紅方以「馬二進三」、「車9平8」等著法展開。', [opening, horseOpportunity]).some((issue) => issue.includes('車9平8 的走子方')))
check('quoted red moves can share an explicit red actor',
  validate('紅方以「馬二進三」、「馬八進七」等著法展開。', [horseOpportunity]).length === 0)
check('quoted black moves can share an explicit black actor',
  validate('黑方以「馬8進7」、「車9平8」等著法展開。', [horseOpportunity]).length === 0)
check('an explicit black actor cannot perform the red member of its list',
  validate('黑方以「馬8進7」、「馬二進三」等著法展開。', [horseOpportunity]).some((issue) => issue.includes('馬二進三 的走子方')))
check('an unquoted same-actor enumeration retains side checks for later members',
  validate('紅方走馬二進三、車9平8。', [horseOpportunity]).length > 0)
check('alternate quote styles retain the same bounded actor enumeration',
  validate('紅方以“馬二進三”、“車9平8”展開。', [horseOpportunity]).length > 0 &&
  validate('黑方以『馬8進7』、『車9平8』展開。', [horseOpportunity]).length === 0)
check('an explicitly named next actor replaces the first actor locally',
  validate('紅方以「馬二進三」、黑方以「車9平8」、「炮8平9」展開。', [horseOpportunity]).length === 0 &&
  validate('紅方以「馬二進三」、黑方以「車9平8」、「馬八進七」展開。', [horseOpportunity]).length > 0)
check('a comparison of two sides is not treated as a same-actor move list',
  validate('紅方比較「馬二進三」、「車9平8」的部署。', [horseOpportunity]).length === 0 &&
  validate('比較紅方的「馬二進三」與黑方的「車9平8」。', [horseOpportunity]).length === 0)
check('an actor is not inherited through narrative or comparison text between moves',
  validate('紅方以「馬二進三」發展並對照「車9平8」的應對。', [horseOpportunity]).length === 0)
check('a quoted actor list cannot borrow moves from an uncited line',
  validate('红方以「馬二進三」、「馬八進七」展開。', [replayEvidence('E1', ['b2e2', 'b9c7', 'b0c2'], START_FEN)]).length > 0)
check('quoted lists preserve ambiguity of repeated move identities across evidence',
  validate('紅方以「炮二平五」、「車九進八」吃掉黑方卒。', [opening, capture, { ...noCapture, id: 'E3' }]).some((issue) => issue.includes('不同吃子結果')))
check('a literal list explicitly used for comparison does not assign its moves to the comparing side',
  validate('紅方以「車9平8」、「馬二進三」作比較。', [horseOpportunity]).length === 0 &&
  validate('紅方以「馬二進三」、「車9平8」進行對照。', [horseOpportunity]).length === 0)
check('later comparison prose does not exempt an earlier wrong-side action list',
  validate('紅方以「馬二進三」、「車9平8」展開並比較後續計畫。', [horseOpportunity]).length > 0)

const rookExchange = replayEvidence('E2', [
  'h2e2', 'h9g7', 'h0g2', 'i9h9', 'i0h0', 'g6g5', 'h0h6', 'c6c5',
  'b2c2', 'c9e7', 'b0a2', 'b9d8', 'a0b0', 'h7i7', 'h6h9', 'g7h9'
], START_FEN)
check('a real rook exchange establishes a concrete relation without tactical glossary terms',
  hasAffirmedConcreteVariationRelation('紅方車二進三吃黑車，接著黑方馬7退8吃紅車，雙方各少一車。', [rookExchange]))
check('a short explicit actor cannot assign a red capture to Black',
  !hasAffirmedConcreteVariationRelation('黑車二進三吃黑車。', [rookExchange]))
check('asking about a capture does not affirm that it occurred',
  !hasAffirmedConcreteVariationRelation('紅方車九進八吃黑卒嗎？', [capture]) &&
  !hasAffirmedConcreteVariationRelation('紅方車九進八可否吃黑卒？', [capture]))
const concreteRelation = hasAffirmedConcreteVariationRelation
check('a completed capture uses captured rather than a different post-move target',
  concreteRelation('紅方車二進三吃黑車。', [rookExchange]) &&
  !concreteRelation('紅方車二進三吃黑象。', [rookExchange]))
check('short target-side spelling cannot change the captured side',
  !concreteRelation('紅方車二進三吃紅車。', [rookExchange]) &&
  !concreteRelation('車九進八吃紅兵。', [capture]))
check('an uncited variation cannot establish a concrete exchange relation',
  !concreteRelation('紅方車二進三吃黑車。', [opening]) &&
  !concreteRelation('紅方車二進三吃黑車。', []))
check('a named legal current target establishes an opportunity without asserting a capture',
  concreteRelation('紅方馬三進四當下可吃黑方e6卒。', [horseOpportunity]) &&
  concreteRelation('紅方炮二平五可以吃黑卒。', [opening]) &&
  concreteRelation('黑方炮8平9能吃紅兵。', [horseOpportunity]))
check('wrong current target type side or square cannot establish concreteness',
  !concreteRelation('紅方馬三進四可吃黑車。', [horseOpportunity]) &&
  !concreteRelation('紅方馬三進四可吃紅兵。', [horseOpportunity]) &&
  !concreteRelation('紅方馬三進四可吃黑方e5卒。', [horseOpportunity]))
check('king safety restrictions also veto a concrete opportunity',
  !concreteRelation('紅方車五進一可吃黑卒。', [pinnedRook]) &&
  concreteRelation('紅方車五進一可吃黑車。', [pinnedRook]))
check('an actual check establishes a relation independently of capturing',
  concreteRelation('紅方車九進八將軍。', [capture]) &&
  !concreteRelation('紅方炮二平五將軍。', [opening]))
check('vague possibilities and remote conditions do not establish an affirmed relation',
  !concreteRelation('紅方馬三進四可能吃黑卒。', [horseOpportunity]) &&
  !concreteRelation('如果紅方車九進八吃黑卒，將來可能將軍。', [capture]) &&
  !concreteRelation('無法確認紅方車九進八是否吃黑卒。', [capture]))
check('hedged present captures or checks are not positive proof even on a matching board',
  !concreteRelation('紅方車九進八未必吃黑卒。', [capture]) &&
  !concreteRelation('紅方車九進八似乎將軍。', [capture]))
check('explicit current possibilities are concretely checked but bare unnamed targets are not',
  concreteRelation('紅方馬三進四當下可能吃黑卒。', [horseOpportunity]) &&
  !concreteRelation('紅方馬三進四可吃子。', [horseOpportunity]) &&
  !concreteRelation('紅方車九進八吃子。', [capture]))
check('a truthful denial alone does not establish an affirmative mechanism',
  !concreteRelation('紅方炮二平五沒有吃子也沒有將軍。', [opening]) &&
  !concreteRelation('紅方馬三進四不能吃黑車。', [horseOpportunity]) &&
  !concreteRelation('紅方車九進八沒有吃黑車。', [capture]))
check('legal move mentions and tactical vocabulary alone are not replay-confirmed relations',
  !concreteRelation('紅方炮二平五控制中路，黑方馬8進7發展。', [opening]) &&
  !concreteRelation('牽制、肋道、抽將形成多點壓力。', [opening]) &&
  !concreteRelation('炮二平五、馬8進7。', [opening]))
check('a true relation never exempts a separate false capture or wrong-side assertion',
  !concreteRelation('紅方車二進三吃黑車，但這步吃黑象。', [rookExchange]) &&
  !concreteRelation('紅方車二進三吃黑車。紅方馬7退8吃紅車。', [rookExchange]) &&
  !concreteRelation('紅方馬三進四可吃黑卒但已吃黑卒。', [horseOpportunity]))
check('ambiguous repeated moves cannot affirm capture or current-target facts',
  !concreteRelation('車九進八吃黑卒。', [capture, { ...noCapture, id: 'E2' }]) &&
  !concreteRelation('炮二平五可吃黑方e6卒。', [opening, shiftedPawnLine]))
check('non-replayable evidence cannot establish a positive relation',
  !concreteRelation('紅方車九進八吃黑卒。', [evidence([], ['車九進八'])]) &&
  !concreteRelation('紅方車九進八吃黑卒。', [{ ...capture, displayPrincipalVariation: ['車九平五'] }]))
const exchangeCapture = buildVariationBoardFacts(rookExchange).steps[14]!
check('the model-facing result separates this move capturing a rook from its later elephant target',
  modelFacingVariationStep(exchangeCapture).actualCapture === '本手吃掉黑方車。' &&
  JSON.stringify(modelFacingVariationStep(exchangeCapture).captureOpportunities) ===
    JSON.stringify([{ square: 'g9', piece: '黑方象' }]))
const projectedCannon = modelFacingVariationStep(rightCannonFacts[0]!)
check('a non-capturing deployment and its current pawn target remain visibly separate',
  projectedCannon.actualCapture === '本手未吃子。' &&
  JSON.stringify(projectedCannon.captureOpportunities) === JSON.stringify([{ square: 'e6', piece: '黑方卒' }]))
check('pawn names are translated according to the captured side',
  modelFacingVariationStep(buildVariationBoardFacts(bestPly18).steps[0]!).actualCapture === '本手吃掉紅方兵。' &&
  modelFacingVariationStep(checkingRookFacts[0]!).actualCapture === '本手吃掉黑方卒。')
check('the actual check result is explicit for both checking and non-checking moves',
  modelFacingVariationStep(checkingRookFacts[0]!).actualCheck === '本手已將軍。' &&
  projectedCannon.actualCheck === '本手未將軍。')
check('black opportunities retain their move side and the enemy pawn name',
  modelFacingVariationStep(buildVariationBoardFacts(horseOpportunity).steps[5]!).captureOpportunities.some((target) => target.piece === '紅方兵') &&
  modelFacingVariationStep(buildVariationBoardFacts(horseOpportunity).steps[5]!).side === 'black')
check('prompt translation retains move identity while replacing the ambiguous raw result fields',
  projectedCannon.ply === 1 && projectedCannon.move === '炮二平五' && projectedCannon.side === 'red' &&
  projectedCannon.fromSquare === 'h2' && projectedCannon.toSquare === 'e2' &&
  projectedCannon.fromFile === 2 && projectedCannon.toFile === 5 &&
  !('captured' in projectedCannon) && !('givesCheck' in projectedCannon) && !('movedPieceCaptureTargets' in projectedCannon))
const replayPrefix = buildVariationBoardFacts(invalidTail)
const promptPrefix = { ...replayPrefix, steps: replayPrefix.steps.map(modelFacingVariationStep) }
check('a replay warning is retained and only the verified prefix is translated',
  promptPrefix.warning?.includes('第 2 手未通過合法性檢查') === true && promptPrefix.steps.length === 1 &&
  promptPrefix.steps[0]?.actualCapture === '本手吃掉紅方兵。')
const captureFactBeforeTranslation = JSON.stringify(exchangeCapture)
modelFacingVariationStep(exchangeCapture)
check('prompt translation leaves typed replay facts unchanged for validation',
  JSON.stringify(exchangeCapture) === captureFactBeforeTranslation && exchangeCapture.captured?.piece === 'rook' &&
  exchangeCapture.movedPieceCaptureTargets[0]?.piece === 'elephant')

const repeatedPawn = replayEvidence('E3', [
  'h2e2', 'h9g7', 'h0g2', 'i9h9', 'i0h0', 'b9c7', 'c3c4', 'g6g5',
  'b0c2', 'b7b3', 'g3g4', 'g5g4', 'h0h6', 'a9a8', 'h6g6', 'g4g3',
  'c2d4', 'g3g2', 'b2g2', 'a8d8', 'd4f5', 'h7h0', 'f5g7', 'h9h7'
], START_FEN)
check('the repeated pawn fixture has distinct noncapture pawn-capture and horse-capture plies',
  JSON.stringify(buildVariationBoardFacts(repeatedPawn).steps.filter((step) => step.move === '卒7進1')
    .map((step) => [step.ply, step.captured?.piece ?? null])) ===
  JSON.stringify([[8, null], [12, 'pawn'], [16, null], [18, 'horse']]))
check('a literal immediately preceding move with an explicit after connector binds the pawn capture',
  validate('兵三進一之後，黑方卒7進1吃掉紅方兵。', [repeatedPawn]).length === 0 &&
  concreteRelation('兵三進一之後，黑方卒7進1吃掉紅方兵。', [repeatedPawn]))
check('the same preceding-move binding works within one clause and with quoted mixed notation',
  validate('紅方「兵三進一」後黑方「卒7進一」吃掉紅方兵。', [repeatedPawn]).length === 0)
check('an explicit next connector binds the horse capture using its immediately preceding move',
  validate('紅方馬七進六，接著黑方卒7進1吃掉紅方馬。', [repeatedPawn]).length === 0)
check('a literal immediately following move with a next connector binds the pawn capture',
  validate('黑方卒7進1吃掉紅方兵，接著紅方車二進六。', [repeatedPawn]).length === 0 &&
  concreteRelation('黑方卒7進1吃掉紅方兵，接著紅方車二進六。', [repeatedPawn]))
check('the following move separately binds the horse capture',
  validate('黑方卒7進1吃掉紅方馬，然後紅方炮八平三。', [repeatedPawn]).length === 0)
check('the preceding noncapture identity cannot borrow the later pawn or horse capture',
  validate('兵七進一之後，黑方卒7進1吃掉紅方兵。', [repeatedPawn]).length > 0 &&
  validate('車二平三之後，黑方卒7進1吃掉紅方馬。', [repeatedPawn]).length > 0)
check('an anchored actual pawn capture cannot change its captured type side or square',
  ['紅方馬', '黑方卒', '紅方g2兵'].every((target) =>
    validate(`兵三進一之後，黑方卒7進1吃掉${target}。`, [repeatedPawn]).length > 0))
check('an anchored capture cannot be denied and a noncapture can be correctly denied',
  validate('兵三進一之後，黑方卒7進1沒有吃子。', [repeatedPawn]).length > 0 &&
  validate('兵七進一之後，黑方卒7進1沒有吃子。', [repeatedPawn]).length === 0)
check('a following anchor cannot excuse a counterfeit target',
  validate('黑方卒7進1吃掉紅方馬，接著紅方車二進六。', [repeatedPawn]).length > 0)
check('a move from a different ply is not an immediate temporal anchor',
  validate('炮2進4之後，黑方卒7進1吃掉紅方兵。', [repeatedPawn]).length > 0)
check('noun comparisons and lists do not disambiguate repeated capture outcomes',
  validate('兵三進一與黑方卒7進1吃掉紅方兵。', [repeatedPawn]).length > 0 &&
  validate('比較兵三進一、黑方卒7進1吃掉紅方兵。', [repeatedPawn]).length > 0)
check('an unanchored move and ambiguous black-step ordinal remain unresolved',
  validate('黑方卒7進1吃掉紅方兵。', [repeatedPawn]).length > 0 &&
  validate('黑方第12步卒7進1吃掉紅方兵。', [repeatedPawn]).length > 0)
check('an explicit temporal anchor must exist in the same replay even when another line has the capture',
  validate('馬8進7之後，黑方卒7進1吃掉紅方兵。', [opening, bestPly18]).length > 0 &&
  validate('黑方卒7進1吃掉紅方兵，接著黑方馬8進7。', [opening, bestPly18]).length > 0)
check('an uncited temporal anchor cannot bind a repeated move',
  validate('兵三進一之後，黑方卒7進1吃掉紅方兵。', [bestPly18]).length > 0)
check('temporal context does not cross sentence boundaries',
  validate('兵三進一之後。黑方卒7進1吃掉紅方兵。', [repeatedPawn]).length > 0)
check('temporal context preserves explicit side checks for both adjacent moves',
  validate('兵三進一之後，紅方卒7進1吃掉紅方兵。', [repeatedPawn]).length > 0 &&
  validate('黑方兵三進一之後，黑方卒7進1吃掉紅方兵。', [repeatedPawn]).length > 0)
check('conflicting preceding and following anchors cannot select whichever capture matches the assertion',
  validate('兵三進一之後，黑方卒7進1吃掉紅方兵，接著紅方炮八平三。', [repeatedPawn]).length > 0)
check('a distinct cited line with an unanchored same move cannot contaminate an exact adjacency',
  validate('兵三進一之後，黑方卒7進1吃掉紅方兵。', [repeatedPawn, bestPly18]).length === 0)
const repeatedRookFen = '3k5/9/9/9/9/p8/9/9/R8/4K4 w - - 0 1'
const repeatedRook = replayEvidence('E1', ['a1a2', 'd9d8', 'a2a3', 'd8d9', 'a3a4'], repeatedRookFen)
const alternateRook = replayEvidence('E2', ['a1a0', 'd9d8', 'a0a1', 'd8d9', 'a1a2'], repeatedRookFen)
check('adjacent move binding applies to repeated rook moves without pawn-specific rules',
  validate('黑方將4退1之後，紅方車九進一吃掉黑方卒。', [repeatedRook]).length === 0)
check('identical adjacent names with conflicting outcomes in another cited line remain ambiguous',
  validate('黑方將4退1之後，紅方車九進一吃掉黑方卒。', [repeatedRook, alternateRook]).length > 0)
const repeatedCheck = replayEvidence('E1', ['a7a8', 'h8h7', 'a8a9'],
  '3k5/7r1/R8/9/9/9/9/9/9/4K4 w - - 0 1')
check('adjacent move binding also selects a repeated move with a different check outcome',
  validate('黑方車8進1之後，紅方車九進一將軍。', [repeatedCheck]).length === 0 &&
  concreteRelation('黑方車8進1之後，紅方車九進一將軍。', [repeatedCheck]))
check('a resolved capture still cannot fabricate a check or certify hypothetical narration',
  validate('兵三進一之後，黑方卒7進1吃掉紅方兵並將軍。', [repeatedPawn]).length > 0 &&
  !concreteRelation('如果兵三進一之後，黑方卒7進1吃掉紅方兵。', [repeatedPawn]))
check('a temporal anchor also selects the correct fixed-board current opportunity',
  concreteRelation('車二平三之後，黑方卒7進1可吃紅方馬。', [repeatedPawn]) &&
  validate('兵三進一之後，黑方卒7進1可吃紅方馬。', [repeatedPawn]).length > 0 &&
  validate('車二平三之後，黑方卒7進1已吃紅方馬。', [repeatedPawn]).length > 0)
check('a local hedged chronology does not establish an affirmative capture',
  !concreteRelation('或許兵三進一之後，黑方卒7進1吃掉紅方兵。', [repeatedPawn]))
check('a remote future qualifier cannot exempt a new anchored present assertion',
  validate('未來可能有其他變化，兵三進一之後，黑方卒7進1吃掉紅方馬。', [repeatedPawn]).length > 0)
check('temporal context does not bridge paragraph or line boundaries in either direction',
  validate('兵三進一之後\n黑方卒7進1吃掉紅方兵。', [repeatedPawn]).length > 0 &&
  validate('黑方卒7進1吃掉紅方兵\n接著紅方車二進六。', [repeatedPawn]).length > 0)

const realCannonTrade = replayEvidence('E1', [
  'g3g4', 'h7g7', 'b2e2', 'c9e7', 'h0g2', 'g6g5', 'g4g5', 'g7g2',
  'a0a1', 'd9e8', 'a1b1', 'b7b2', 'i0h0', 'b9c7', 'e2e1', 'b2h2',
  'h0h2', 'g2g3', 'b1b7'
], START_FEN)
check('an exact Chinese global ply binds the repeated pawn capture at ply twelve',
  validate('第十二手卒7進1吃掉紅方兵。', [repeatedPawn]).length === 0)
check('a real cannon recapture cannot be presented as gaining an extra cannon',
  validate('車二進二吃掉黑方炮，淨多一炮。', [realCannonTrade]).length > 0 &&
  !concreteRelation('車二進二吃掉黑方炮，淨多一炮。', [realCannonTrade]))
check('Arabic global plies distinguish correct noncapture pawn and horse captures',
  validate('第8手黑方卒7進1沒有吃子。', [repeatedPawn]).length === 0 &&
  validate('第12手黑方卒7進1吃掉紅方兵。', [repeatedPawn]).length === 0 &&
  concreteRelation('第十八手黑方卒7進1吃掉紅方馬。', [repeatedPawn]))
check('explicit global plies preserve move side and target validation',
  validate('第14手卒7進1吃掉紅方兵。', [repeatedPawn]).length > 0 &&
  validate('第18手卒7進1吃掉紅方兵。', [repeatedPawn]).length > 0 &&
  validate('第12手紅方卒7進1吃掉紅方兵。', [repeatedPawn]).length > 0)
check('invalid global counts and side-relative round or step numbers are not guessed',
  ['第0手', '第257手', '第十二十手', '第十二回合', '黑方第12步', '黑方第12手'].every((prefix) =>
    validate(`${prefix}卒7進1吃掉紅方兵。`, [repeatedPawn]).length > 0))
check('a global ordinal cannot borrow a conflicting result from another cited replay',
  validate('第五手車九進一吃掉黑方卒。', [repeatedRook, alternateRook]).length > 0)
const tradeEvidenceBeforeLedger = JSON.stringify(realCannonTrade)
const tradeLedger = buildVariationCaptureLedger(realCannonTrade)!
check('the real ledger retains initial and current cannon counts separately from captured and lost',
  tradeLedger.initialCounts.red.cannon === 2 && tradeLedger.initialCounts.black.cannon === 2 &&
  tradeLedger.currentCounts.red.cannon === 1 && tradeLedger.currentCounts.black.cannon === 1 &&
  tradeLedger.captured.red.cannon === 1 && tradeLedger.lost.red.cannon === 1 &&
  tradeLedger.netCaptureChange.red.cannon === 0 && tradeLedger.currentCountDifference.red.cannon === 0 &&
  tradeLedger.throughPly === 19)
check('the real ledger exposes the earlier horse loss and pawn capture without assigning values',
  tradeLedger.currentCounts.red.horse === 1 && tradeLedger.currentCounts.black.horse === 2 &&
  tradeLedger.lost.red.horse === 1 && tradeLedger.captured.red.pawn === 1 &&
  tradeLedger.netCaptureChange.red.horse === -1 && tradeLedger.netCaptureChange.red.pawn === 1)
check('an immediate recapture identifies the exact preceding capturing piece on the same square',
  JSON.stringify(tradeLedger.immediateRecaptures) ===
  JSON.stringify([{ capturePly: 16, recapturePly: 17, square: 'h2' }]))
check('capture summaries supply both side ledgers and the real immediate cannon recapture',
  summarize([realCannonTrade]).some((line) => line.includes('紅方棋子帳本') && line.includes('目前')) &&
  summarize([realCannonTrade]).some((line) => line.includes('黑方棋子帳本')) &&
  summarize([realCannonTrade]).some((line) => line.includes('第 16、17 手') && line.includes('立即吃回')))
check('the whole verified real line has equal cannon counts and one fewer red horse',
  validate('紅方淨多零炮，紅方淨少一馬。', [realCannonTrade]).length === 0 &&
  validate('紅方淨多一炮。', [realCannonTrade]).length > 0 &&
  !concreteRelation('紅方淨多零炮，紅方淨少一馬。', [realCannonTrade]))
check('an exact prefix distinguishes the pre-recapture cannon deficit from the completed trade',
  validate('截至第十六手，紅方淨少一炮。', [realCannonTrade]).length === 0 &&
  validate('截至第17手，紅方淨多零炮。', [realCannonTrade]).length === 0 &&
  validate('截至第17手，紅方淨多一炮。', [realCannonTrade]).length > 0)
check('the actor of an exact capturing step supplies the side of a following numeric claim',
  validate('第16手黑方炮2平8吃掉紅方炮，淨多一炮。', [realCannonTrade]).length === 0 &&
  validate('第17手紅方車二進二吃掉黑方炮，淨多一炮。', [realCannonTrade]).length > 0)
const isolatedCannonGain = replayEvidence('E1', ['a1a4'],
  '3k5/9/9/9/9/c8/9/9/R7C/4K4 w - - 0 1')
const isolatedCannonLoss = replayEvidence('E1', ['i4i1'],
  '3k5/9/9/9/9/c7r/9/9/8C/4K4 b - - 0 1')
check('a real isolated same-type gain is accepted with Chinese and decimal counts',
  validate('紅方淨多一炮。', [isolatedCannonGain]).length === 0 &&
  validate('紅方淨多1枚炮。', [isolatedCannonGain]).length === 0 &&
  validate('紅方淨少一炮。', [isolatedCannonGain]).length > 0)
check('a real isolated same-type loss preserves side and quantity',
  validate('紅方淨少一炮，黑方淨多一炮。', [isolatedCannonLoss]).length === 0 &&
  validate('紅方淨多一炮。', [isolatedCannonLoss]).length > 0 &&
  validate('紅方淨少二炮。', [isolatedCannonLoss]).length > 0)
const initiallyExtraCannon = replayEvidence('E1', ['h0g2'], START_FEN.replace('1c5c1', '1c7'))
check('an unchanged initial cannon imbalance is not confused with zero new captures',
  validate('紅方淨多一炮。', [initiallyExtraCannon]).length === 0 &&
  buildVariationCaptureLedger(initiallyExtraCannon)?.netCaptureChange.red.cannon === 0)
check('current piece count differences are not inferred from capture deltas on unequal starting boards',
  validate('紅方淨少一兵。', [capture]).length === 0 &&
  validate('紅方淨多一兵。', [capture]).length > 0 &&
  buildVariationCaptureLedger(capture)?.netCaptureChange.red.pawn === 1)
check('an unqualified multi-line count cannot select its favourable line',
  validate('紅方淨多一炮。', [realCannonTrade, isolatedCannonGain]).length > 0 &&
  validate('紅方淨多零炮。', [realCannonTrade, { ...realCannonTrade, id: 'E2' }]).length > 0)
check('matching exact steps across same-start lines can share a count but conflicting balances cannot',
  validate('第17手車二進二吃掉黑方炮，紅方淨多零炮。', [realCannonTrade, { ...realCannonTrade, id: 'E2' }]).length === 0 &&
  validate('第5手車九進一，紅方淨多零兵。', [repeatedRook, alternateRook]).length > 0)
check('same move names on different starting boards cannot establish one material balance',
  validate('炮二平五，紅方淨多零炮。', [opening,
    replayEvidence('E2', ['h2e2'], initiallyExtraCannon.positionFen)]).length > 0)
const incompleteTrade = { ...realCannonTrade, analysis: {
  ...realCannonTrade.analysis, principalVariation: [...realCannonTrade.analysis.principalVariation.slice(0, 17), 'a0a9']
} }
check('an incomplete supplied tail cannot support an unqualified full-line net count',
  buildVariationCaptureLedger(incompleteTrade)?.throughPly === 17 &&
  buildVariationCaptureLedger(incompleteTrade)?.warning !== null &&
  validate('紅方淨多零炮。', [incompleteTrade]).length > 0)
check('an explicit verified prefix remains countable while a missing later ply fails closed',
  validate('截至第17手，紅方淨多零炮。', [incompleteTrade]).length === 0 &&
  validate('截至第18手，紅方淨多零炮。', [incompleteTrade]).length > 0 &&
  buildVariationCaptureLedger(incompleteTrade, 18) === null)
check('canonical Chinese hundreds resolve a checked prefix at the existing parser limit',
  validate('截至第二百五十六手，紅方淨多零炮。', [oversizedLine]).length === 0 &&
  validate('紅方淨多零炮。', [oversizedLine]).length > 0)
check('future numeric possibilities are not present counts and a new current claim remains checked',
  validate('未來可能紅方淨多一炮。', [realCannonTrade]).length === 0 &&
  !concreteRelation('未來可能紅方淨多一炮。', [realCannonTrade]) &&
  validate('未來可能有其他變化，紅方淨多一炮。', [realCannonTrade]).length > 0)
check('numerical denials test the current count without asserting a material gain',
  validate('紅方並非淨多一炮。', [realCannonTrade]).length === 0 &&
  validate('紅方並非淨多零炮。', [realCannonTrade]).length > 0)
check('ambiguous numerical profit wording and absent actor scopes fail closed',
  validate('紅方又淨賺一炮。', [realCannonTrade]).length > 0 &&
  validate('淨多一炮。', [isolatedCannonGain]).length > 0 &&
  validate('截至第16手，淨多一炮。', [realCannonTrade]).length > 0 &&
  validate('紅方淨多一炮。', []).length > 0)
check('an immediately coordinated conditional numeric conclusion does not assert a current balance',
  validate('如果車二進二吃掉黑方炮，淨多一炮。', [realCannonTrade]).length === 0 &&
  !concreteRelation('如果車二進二吃掉黑方炮，淨多一炮。', [realCannonTrade]))
check('ledger construction does not mutate replay facts and invalid FEN has no ledger',
  JSON.stringify(realCannonTrade) === tradeEvidenceBeforeLedger &&
  buildVariationCaptureLedger({ ...realCannonTrade, positionFen: 'invalid' }) === null)
check('a denied interpretation of the real rook exchange does not assert the quoted net gain',
  validate('沿主線走到紅方車二進三吃黑車，黑方緊接馬7退8吃紅車，雙方各少一車，不能只把第一手吃車算成紅方淨多一車。',
    [rookExchange]).length === 0)
check('negative interpretation frames apply across piece types without certifying the quoted number',
  validate('車二進二吃掉黑方炮，不能把一次吃子視為紅方淨多一炮。', [realCannonTrade]).length === 0 &&
  validate('不能稱為紅方淨多一炮。', [realCannonTrade]).length === 0 &&
  validate('不可把先前吃子算成紅方淨多一車。', [rookExchange]).length === 0)
check('an affirmative interpretation of the same capture still uses the real current counts',
  validate('車二進二吃掉黑方炮，把一次吃子算成紅方淨多一炮。', [realCannonTrade]).length > 0)
check('a denied interpretation cannot exempt a subsequent affirmative numeric claim',
  validate('不能把一次吃子算成紅方淨多一炮，但此時紅方淨多一炮。', [realCannonTrade]).length > 0 &&
  validate('不能只把吃車算成紅方淨多一車但是目前紅方淨多一車。', [rookExchange]).length > 0 &&
  validate('不能把一次吃子算成紅方淨多一炮並稱為紅方淨多一炮。', [realCannonTrade]).length > 0)
check('quoted numbers retain their local denied or affirmed interpretation',
  validate('不能稱為「紅方淨多一炮」。', [realCannonTrade]).length === 0 &&
  validate('稱為「紅方淨多一炮」。', [realCannonTrade]).length > 0)
check('a snapshot cutoff persists across numerical denial instead of reverting to the whole line',
  validate('截至第16手，紅方並非淨少一炮。', [realCannonTrade]).length > 0)
check('a snapshot cutoff takes priority over the earlier literal capturing move for current counts',
  validate('截至第17手，炮2平8已吃掉紅方炮，紅方淨少一炮。', [realCannonTrade]).length > 0)
check('an earlier historical capture and the correct current snapshot count can coexist',
  validate('截至第17手，炮2平8已吃掉紅方炮，紅方淨多零炮。', [realCannonTrade]).length === 0)
check('the snapshot is inclusive for historical captures and excludes unplayed later captures',
  validate('截至第16手，炮2平8已吃掉紅方炮，紅方淨少一炮。', [realCannonTrade]).length === 0 &&
  validate('截至第16手，車二進二已吃掉黑方炮，紅方淨少一炮。', [realCannonTrade]).length > 0 &&
  validate('截至第16手，車二進二已吃掉黑方炮。', [realCannonTrade]).length > 0)
check('snapshot numerical denials use the same inclusive cutoff on both sides',
  validate('到第十六手，黑方並非淨少一炮。', [realCannonTrade]).length === 0 &&
  validate('截至第17手，紅方並非淨少一炮。', [realCannonTrade]).length === 0 &&
  validate('截至第17手，紅方並非淨多零炮。', [realCannonTrade]).length > 0)
check('a snapshot persists through multiple historical clauses and current numerical statements',
  validate('截至第十七手，炮7進5吃掉紅方馬，炮2平8吃掉紅方炮，紅方淨少一馬，紅方淨多零炮。', [realCannonTrade]).length === 0 &&
  validate('截至第十七手，炮7進5吃掉紅方馬，炮2平8吃掉紅方炮，紅方淨少一馬，紅方淨少一炮。', [realCannonTrade]).length > 0)
check('unsupported or invalid explicit snapshot qualifiers never fall back to a favourable full-line count',
  ['截至第0手', '截至第257手', '截至第十二十手', '截至第16步', '截至第16回合', '截至16手', '截至第16手之前'].every((prefix) =>
    validate(`${prefix}，紅方淨多零炮。`, [realCannonTrade]).length > 0))
check('unknown snapshots cannot borrow a prior known capture from a truncated line',
  validate('截至第18手，炮2平8已吃掉紅方炮，紅方淨多零炮。', [incompleteTrade]).length > 0 &&
  validate('截至第17手，炮2平8已吃掉紅方炮，紅方淨多零炮。', [incompleteTrade]).length === 0)
check('an exact historical ordinal must also lie within the snapshot prefix',
  validate('截至第16手，第17手車二進二吃掉黑方炮。', [realCannonTrade]).length > 0 &&
  validate('截至第17手，第16手炮2平8吃掉紅方炮，紅方淨多零炮。', [realCannonTrade]).length === 0)
check('a later explicit cutoff updates the snapshot only for later clauses',
  validate('截至第16手，紅方淨少一炮，截至第17手，紅方淨多零炮。', [realCannonTrade]).length === 0 &&
  validate('截至第16手，紅方淨多零炮，截至第17手，紅方淨多零炮。', [realCannonTrade]).length > 0)
check('a sentence boundary ends the snapshot and does not leak an earlier deficit into a new whole-line claim',
  validate('截至第16手，紅方淨少一炮。紅方淨多零炮。', [realCannonTrade]).length === 0 &&
  validate('截至第16手，紅方淨少一炮。紅方淨少一炮。', [realCannonTrade]).length > 0)
check('every cited replay must establish the declared snapshot without choosing an available favourable line',
  validate('截至第17手，炮2平8已吃掉紅方炮，紅方淨多零炮。', [realCannonTrade, { ...incompleteTrade,
    id: 'E2', analysis: { ...incompleteTrade.analysis, principalVariation: realCannonTrade.analysis.principalVariation.slice(0, 16) } }]).length > 0)
check('snapshot counts inherit a historical actor instead of the side that moved on the cutoff ply',
  validate('截至第17手，黑方炮2平8已吃掉紅方炮，淨少一卒。', [realCannonTrade]).length === 0 &&
  validate('截至第17手，黑方炮2平8已吃掉紅方炮，淨多一卒。', [realCannonTrade]).length > 0)
check('a direct clause-leading cutoff supports current counts and their denials without requiring a comma',
  validate('截至第16手紅方淨少一炮。', [realCannonTrade]).length === 0 &&
  validate('截至第17手紅方並非淨多零炮。', [realCannonTrade]).length > 0)

console.log(`\nVariation board statements: ${passed} passed, ${failed} failed`)
if (failed) process.exitCode = 1
