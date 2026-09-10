import { buildBoardQuestionFacts } from '../../../src/main/ai/BoardQuestionFacts'

let passed = 0
let failed = 0

function check(name: string, condition: boolean, detail?: unknown): void {
  if (condition) {
    passed += 1
    console.log(`  ✓ ${name}`)
  } else {
    failed += 1
    console.error(`  ✗ ${name}${detail === undefined ? '' : ` — ${JSON.stringify(detail)}`}`)
  }
}

function factsText(result: ReturnType<typeof buildBoardQuestionFacts>): string {
  return result.facts.join('\n')
}

const redBeforeRiver = '4k4/9/9/9/9/6P2/9/9/9/4K4 w - - 0 1'
const redCrossed = '4k4/9/9/9/6P2/9/9/9/9/4K4 w - - 0 1'
const blackCrossed = '4k4/9/9/9/9/2p6/9/9/9/4K4 b - - 0 1'
const redCrossedBlocked = '4k4/9/9/9/4PPPP1/9/9/9/9/4K4 w - - 0 1'
const duplicateRedThirdFile = '4k4/9/9/6P2/9/6P2/9/9/9/4K4 w - - 0 1'

{
  const result = buildBoardQuestionFacts(redBeforeRiver, '現在輪到誰走？', 'zh-TW')
  check('side-to-move answers Red directly', result.directAnswer === '現在輪到紅方走。', result)
  check('side-to-move fact comes from FEN', factsText(result).includes('紅方'), result)
}

{
  const result = buildBoardQuestionFacts(blackCrossed, 'Whose turn is it?', 'en')
  check('English side-to-move answers Black directly', result.directAnswer === 'Black moves next.', result)
}

{
  const before = buildBoardQuestionFacts(redBeforeRiver, '紅方三路兵過河了嗎？', 'zh-TW')
  check('red third-file pawn before river is identified', before.directAnswer?.includes('尚未過河') === true, before)
  check('before-river movement rule is explicit', factsText(before).includes('不能橫走或後退'), before)

  const after = buildBoardQuestionFacts(redCrossed, '紅方三路兵過河了嗎？', 'zh-TW')
  check('red third-file pawn after river is identified', after.directAnswer?.includes('已過河') === true, after)
  check('red third file uses g-file coordinate', factsText(after).includes('g5'), after)
}

{
  const result = buildBoardQuestionFacts(blackCrossed, '黑方三路卒過河了嗎？', 'zh-CN')
  check('black third-file uses c-file from black perspective', factsText(result).includes('c4') && result.directAnswer?.includes('三路卒') === true, result)
  check('black river boundary is reflected', factsText(result).includes('row >= 5'), result)
}

{
  const result = buildBoardQuestionFacts(redCrossedBlocked, '紅方三路兵可以橫走嗎？', 'zh-TW')
  check('crossed pawn does not imply horizontal movement is always available', result.directAnswer?.includes('己方棋子') === true && result.directAnswer.includes('不能走到'), result)
  check('same-side occupied horizontal targets are reported', factsText(result).includes('己方棋子'), result)
}

{
  const result = buildBoardQuestionFacts(duplicateRedThirdFile, '紅方三路兵過河了嗎？', 'zh-TW')
  check('duplicate same-file pawns are enumerated', factsText(result).includes('2 枚紅方兵'), result)
  check('ambiguous duplicate does not get a direct answer', result.directAnswer === undefined, result)
  check('both positions are retained', factsText(result).includes('g6') && factsText(result).includes('g4'), result)
}

{
  const result = buildBoardQuestionFacts(redCrossed, '紅方三路兵過河了嗎？為何建議馬二進三？', 'zh-TW')
  check('mixed strategic question still returns board facts', result.facts.length > 0, result)
  check('mixed strategic question has no early direct answer', result.directAnswer === undefined, result)
}

{
  const result = buildBoardQuestionFacts('not a fen', '紅方三路兵過河了嗎？', 'zh-TW')
  check('invalid FEN never fabricates a board answer', result.directAnswer === undefined, result)
  check('invalid FEN is reported', factsText(result).includes('FEN 無效'), result)
}

{
  const result = buildBoardQuestionFacts(redCrossed, '兵可以後退嗎？', 'zh-TW')
  check('generic pawn retreat rule is directly answered', result.directAnswer === '不能，兵不能後退。', result)
}

{
  const initial = 'rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNR w - - 0 1'
  const result=buildBoardQuestionFacts(initial, '目前是開局，請說明紅方三路兵是否已過河，以及兵過河之前能否橫走。請直接回答棋規。','zh-TW')
  check('exact user question answers crossing and sideways rule', !!result.directAnswer && /三路兵尚未過河/.test(result.directAnswer) && /不能橫走/.test(result.directAnswer),result)
  const compound=buildBoardQuestionFacts(redCrossed,'紅方三路兵過河了嗎？可以後退或橫走嗎？','zh-TW')
  check('compound crossing retreat sideways all answered', !!compound.directAnswer && /已過河/.test(compound.directAnswer) && /不能後退/.test(compound.directAnswer) && /橫走/.test(compound.directAnswer),compound)
  const mixed=buildBoardQuestionFacts(initial,'兵過河後能橫走嗎，炮怎麼吃子？','zh-TW')
  check('unhandled second piece prevents partial completion', mixed.directAnswer === undefined,mixed)
  const exact=buildBoardQuestionFacts(duplicateRedThirdFile,'紅方 g4 的兵過河了嗎？','zh-TW')
  check('explicit square selects exact pawn despite same-file duplicate', !!exact.directAnswer && /尚未過河/.test(exact.directAnswer),exact)
  const otherFile=buildBoardQuestionFacts(initial,'紅方五路兵可以橫走嗎？','zh-TW')
  check('other named file is resolved instead of answering generic rule', !!otherFile.directAnswer && /五路兵尚未過河/.test(otherFile.directAnswer),otherFile)
  const notTurn=buildBoardQuestionFacts('4k4/9/9/9/4P1P2/9/9/9/9/4K4 b - - 0 1','紅方三路兵已過河，現在能橫走嗎？','zh-TW')
  check('crossed rule is distinct from current turn legality', !!notTurn.directAnswer && /已過河/.test(notTurn.directAnswer) && /輪到黑方/.test(notTurn.directAnswer),notTurn)
}

console.log(`結果：${passed} 通過，${failed} 失敗`)
if (failed > 0) process.exitCode = 1
