import {
  buildVariationBoardFacts,
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

console.log(`\nVariation board statements: ${passed} passed, ${failed} failed`)
if (failed) process.exitCode = 1
