import { parseFen } from '@shared/logic/board/fen'
import { legalMoveCheck } from '@shared/logic/board/moves'
import type { BoardState, PieceColor } from '@shared/types/BoardState'

export type BoardQuestionLanguage = 'zh-TW' | 'zh-CN' | 'en'

export interface BoardQuestionFacts {
  facts: string[]
  directAnswer?: string
}

const FILES = 'abcdefghi'

function includesAny(value: string, patterns: readonly RegExp[]): boolean {
  return patterns.some((pattern) => pattern.test(value))
}

function sideName(side: PieceColor, language: BoardQuestionLanguage): string {
  if (language === 'en') return side === 'red' ? 'Red' : 'Black'
  if (language === 'zh-CN') return side === 'red' ? '红方' : '黑方'
  return side === 'red' ? '紅方' : '黑方'
}

function pawnName(side: PieceColor, language: BoardQuestionLanguage): string {
  if (language === 'en') return `${sideName(side, language)} pawn`
  return `${sideName(side, language)}${side === 'red' ? '兵' : '卒'}`
}

function invalidFenFact(language: BoardQuestionLanguage, message: string): string {
  if (language === 'en') return `The FEN is invalid, so no board answer can be determined (${message}).`
  if (language === 'zh-CN') return `FEN 无效，无法根据棋盘确定答案（${message}）。`
  return `FEN 無效，無法根據棋盤確定答案（${message}）。`
}

function unsupportedFact(language: BoardQuestionLanguage): string {
  if (language === 'en') return 'This helper only answers deterministic side-to-move and pawn movement questions.'
  if (language === 'zh-CN') return '此辅助器只回答可由当前棋盘和兵卒规则确定的轮走方及兵卒走法问题。'
  return '此輔助器只回答可由目前棋盤與兵卒規則確定的輪走方及兵卒走法問題。'
}

function rowToRank(row: number): number {
  return 9 - row
}

function square(row: number, col: number): string {
  return `${FILES[col]}${rowToRank(row)}`
}

function uci(fromRow: number, fromCol: number, toRow: number, toCol: number): string {
  return `${square(fromRow, fromCol)}${square(toRow, toCol)}`
}

function crossedRiver(side: PieceColor, row: number): boolean {
  return side === 'red' ? row <= 4 : row >= 5
}

function forwardRow(side: PieceColor, row: number): number {
  return side === 'red' ? row - 1 : row + 1
}

function detectStrategicOrUnrelated(question: string): boolean {
  return includesAny(question, [
    /為什麼|為何|为什么|为何|建議|建议|推薦|推荐|最佳|策略|戰略|战略|取勝|取胜|優勢|优势|攻勢|攻势|分析|引擎|人工智慧|[炮砲馬马車车象相仕士]|天氣|天气/i,
    /why|suggest|recommend|best|strategy|strategic|win|advantage|engine|analysis|should/i
  ])
}

function detectsSideToMove(question: string): boolean {
  return includesAny(question, [
    /輪到(?:誰|哪一方|哪方)|轮到(?:谁|哪一方|哪方)|哪一方走|哪方走|誰走|谁走|走子方|轮走方/i,
    /side\s*-?\s*to\s*move|whose\s+turn|who\s+(?:is\s+to\s+)?move(?:s)?(?:\s+next)?|which\s+side\s+moves/i
  ])
}

function detectsPawn(question: string): boolean {
  return /兵|卒|pawn/i.test(question)
}

function detectsCrossing(question: string): boolean {
  return /過河|过河|渡河|cross(?:ed|es|ing)?\s+the\s+river|river/i.test(question)
}

function detectsSideways(question: string): boolean {
  return /橫走|横走|橫行|横行|平走|橫向|横向|sideways|horizont(?:al|ally)|left\s*(?:or|and)\s*right/i.test(
    question
  )
}

function detectsRetreat(question: string): boolean {
  return /後退|后退|退一步|backward|backwards|retreat/i.test(question)
}

function detectsMovement(question: string): boolean {
  return includesAny(question, [
    /怎麼走|怎么走|如何走|走法|能走|可以走|可否|規則|规则|move|movement|moves|legal|target/i
  ])
}

function isExplicitRed(question: string): boolean {
  return /紅方|红方|紅兵|红兵|red/i.test(question)
}

function isExplicitBlack(question: string): boolean {
  return /黑方|黑兵|black|卒/i.test(question)
}

function detectThirdFile(question: string, side: PieceColor): boolean {
  const third = /三路|第三路|third\s*-?\s*file|3(?:rd)?\s*-?\s*file|file\s*(?:no\.?\s*)?3/i.test(
    question
  )
  if (!third) return false
  return side === 'red' ? isExplicitRed(question) : isExplicitBlack(question)
}

function detectNamedPawnSide(question: string, board: BoardState): PieceColor | undefined {
  if (isExplicitRed(question) && !isExplicitBlack(question)) return 'red'
  if (isExplicitBlack(question) && !isExplicitRed(question)) return 'black'

  // A bare "third-file pawn" is accepted only when the board makes the side
  // unambiguous. This avoids silently selecting a pawn from the wrong side.
  const candidates = (['red', 'black'] as const).filter((side) =>
    detectThirdFile(question, side)
  )
  if (candidates.length === 1) return candidates[0]
  const coordinate = /\b([a-i])([0-9])\b/i.exec(question)
  if (coordinate) {
    const col = FILES.indexOf(coordinate[1].toLowerCase())
    const row = 9 - Number(coordinate[2])
    const piece = col >= 0 ? board.grid[row]?.[col] : undefined
    if (piece?.type === 'pawn') return piece.color
  }
  return undefined
}

function namedPawnColumn(question: string, side: PieceColor): number | undefined {
  const numbered = /(?:第)?([一二三四五六七八九1-9])路/.exec(question)
  const english = /(?:file\s*(?:no\.?\s*)?([1-9])|([1-9])(?:st|nd|rd|th)?\s*-?\s*file)/i.exec(question)
  const label = numbered?.[1] ?? english?.[1] ?? english?.[2]
  const number = label ? ('一二三四五六七八九'.includes(label) ? '一二三四五六七八九'.indexOf(label) + 1 : Number(label)) : undefined
  if (number !== undefined) return side === 'red' ? 9 - number : number - 1
  if (detectThirdFile(question, side)) return side === 'red' ? 6 : 2
  const coordinate = /\b([a-i])[0-9]\b/i.exec(question)
  return coordinate ? FILES.indexOf(coordinate[1].toLowerCase()) : undefined
}

function listPawns(board: BoardState, side: PieceColor, col: number) {
  const pawns: Array<{ row: number; col: number }> = []
  for (let row = 0; row < 10; row++) {
    const piece = board.grid[row][col]
    if (piece?.type === 'pawn' && piece.color === side) pawns.push({ row, col })
  }
  return pawns
}

function movementRuleFact(
  side: PieceColor,
  crossed: boolean,
  language: BoardQuestionLanguage
): string {
  if (language === 'en') {
    return crossed
      ? `${sideName(side, language)} pawn has crossed the river: it may move one step forward or one square horizontally, but never backward. A horizontal target still must be empty or occupied by an opposing piece and pass full legality checks.`
      : `${sideName(side, language)} pawn is before the river: it may move one step forward only and cannot move horizontally or backward.`
  }
  if (language === 'zh-CN') {
    return crossed
      ? `${pawnName(side, language)}已过河：仍可向前一格，也可横走一格，但不能后退。横走目标必须为空格或敌方棋子，并且仍要通过完整合法性检查。`
      : `${pawnName(side, language)}尚未过河：只能向前一格，不能横走或后退。`
  }
  return crossed
    ? `${pawnName(side, language)}已過河：仍可向前一格，也可橫走一格，但不能後退。橫走目標必須是空格或敵方棋子，且仍要通過完整合法性檢查。`
    : `${pawnName(side, language)}尚未過河：只能向前一格，不能橫走或後退。`
}

function crossingFact(
  side: PieceColor,
  row: number,
  col: number,
  crossed: boolean,
  language: BoardQuestionLanguage
): string {
  const at = square(row, col)
  const boundary = side === 'red' ? 'row <= 4' : 'row >= 5'
  if (language === 'en') {
    return `${pawnName(side, language)} is at ${at} (grid row ${row}, column ${col}); it ${crossed ? 'has' : 'has not'} crossed the river. For ${sideName(side, language)}, crossing means ${boundary}.`
  }
  if (language === 'zh-CN') {
    return `${pawnName(side, language)}位于${at}（grid 行 ${row}、列 ${col}），${crossed ? '已经' : '尚未'}过河；${sideName(side, language)}过河判定为 ${boundary}。`
  }
  return `${pawnName(side, language)}位於${at}（grid 列 ${row}、欄 ${col}），${crossed ? '已經' : '尚未'}過河；${sideName(side, language)}過河判定為 ${boundary}。`
}

function targetFact(
  board: BoardState,
  side: PieceColor,
  fromRow: number,
  fromCol: number,
  toRow: number,
  toCol: number,
  language: BoardQuestionLanguage
): { text: string; legal: boolean } {
  const destination = square(toRow, toCol)
  const target = board.grid[toRow]?.[toCol]
  const prefix = language === 'en' ? `Target ${destination}` : `目標 ${destination}`

  if (target?.color === side) {
    return {
      text:
        language === 'en'
          ? `${prefix} is occupied by a same-side piece, so this pawn cannot move there.`
          : language === 'zh-CN'
            ? `${prefix}已有己方棋子，这枚兵不能走到这里。`
            : `${prefix}已有己方棋子，這枚兵不能走到這裡。`,
      legal: false
    }
  }

  const move = uci(fromRow, fromCol, toRow, toCol)
  // legalMoveCheck also accounts for the actual side to move and post-move
  // king safety. It is intentionally used instead of inferring legality from
  // an empty destination alone.
  const result = legalMoveCheck(board.grid, board.sideToMove, move)
  if (result.ok) {
    return {
      text:
        language === 'en'
          ? `${prefix} is currently a legal target${target ? ' (capture)' : ''}.`
          : `${prefix}目前是合法目標${target ? '（可吃子）' : ''}。`,
      legal: true
    }
  }

  const hypothetical = legalMoveCheck(board.grid, side, move)
  if (board.sideToMove !== side && hypothetical.ok) {
    return {
      text:
        language === 'en'
          ? `${prefix} fits the pawn movement rule, but it is not a move for this turn because ${sideName(board.sideToMove, language)} moves now.`
          : language === 'zh-CN'
            ? `${prefix}符合兵的走法规则，但现在轮到${sideName(board.sideToMove, language)}，这回合不能走这枚兵。`
            : `${prefix}符合兵的走法規則，但目前輪到${sideName(board.sideToMove, language)}，這回合不能走這枚兵。`,
      legal: false
    }
  }

  return {
    text:
      language === 'en'
        ? `${prefix} is not legal: ${result.message}`
        : `${prefix}目前不能走：${result.message}`,
    legal: false
  }
}

function appendSidewaysFacts(
  board: BoardState,
  side: PieceColor,
  row: number,
  col: number,
  language: BoardQuestionLanguage,
  facts: string[]
): boolean {
  if (!crossedRiver(side, row)) {
    facts.push(
      language === 'en'
        ? 'This pawn is before the river, so horizontal movement is not allowed by the pawn rule.'
        : language === 'zh-CN'
          ? '这枚兵尚未过河，按兵规则不能横走。'
          : '這枚兵尚未過河，依兵規則不能橫走。'
    )
    return false
  }

  const statuses: boolean[] = []
  for (const delta of [-1, 1]) {
    const targetCol = col + delta
    if (targetCol < 0 || targetCol >= 9) {
      facts.push(
        language === 'en'
          ? `The horizontal square on the ${delta < 0 ? 'left' : 'right'} is outside the board.`
          : `橫向${delta < 0 ? '左' : '右'}側超出棋盤，沒有可走格。`
      )
      statuses.push(false)
      continue
    }
    const status = targetFact(board, side, row, col, row, targetCol, language)
    facts.push(status.text)
    statuses.push(status.legal)
  }
  return statuses.some(Boolean)
}

function appendForwardFact(
  board: BoardState,
  side: PieceColor,
  row: number,
  col: number,
  language: BoardQuestionLanguage,
  facts: string[]
): boolean {
  const toRow = forwardRow(side, row)
  if (toRow < 0 || toRow >= 10) {
    facts.push(language === 'en' ? 'The forward edge of the board has been reached.' : '已到達棋盤前方邊界。')
    return false
  }
  const status = targetFact(board, side, row, col, toRow, col, language)
  facts.push(status.text)
  return status.legal
}

function directSideAnswer(board: BoardState, language: BoardQuestionLanguage): string {
  const side = sideName(board.sideToMove, language)
  if (language === 'en') return `${side} moves next.`
  if (language === 'zh-CN') return `现在轮到${side}走。`
  return `現在輪到${side}走。`
}

/**
 * Answer the small, deterministic subset of board questions that can be
 * grounded in the current FEN and the shared move validator.
 */
export function buildBoardQuestionFacts(
  fen: string,
  question: string,
  language: BoardQuestionLanguage
): { facts: string[]; directAnswer?: string } {
  const parsed = parseFen(fen)
  if (!parsed.valid) return { facts: [invalidFenFact(language, parsed.message)] }

  const board = parsed.board
  const normalized = question.trim()
  const strategicOrUnrelated = detectStrategicOrUnrelated(normalized)
  const sideIntent = detectsSideToMove(normalized)
  const pawnIntent = detectsPawn(normalized)
  const crossingIntent = detectsCrossing(normalized)
  const sidewaysIntent = detectsSideways(normalized)
  const retreatIntent = detectsRetreat(normalized)
  const movementIntent = detectsMovement(normalized) || pawnIntent
  const facts: string[] = []

  if (sideIntent) {
    facts.push(
      language === 'en'
        ? `The FEN side-to-move field is ${sideName(board.sideToMove, language)}.`
        : `FEN 的輪走方欄位是${sideName(board.sideToMove, language)}。`
    )
  }

  const namedSide = pawnIntent ? detectNamedPawnSide(normalized, board) : undefined
  const namedCol = namedSide === undefined ? undefined : namedPawnColumn(normalized, namedSide)
  const namedPawns =
    namedSide !== undefined && namedCol !== undefined ? listPawns(board, namedSide, namedCol) : []
  const explicitSquare = /\b[a-i]([0-9])\b/i.exec(normalized)
  if (explicitSquare) {
    const exactRow = 9 - Number(explicitSquare[1])
    for (let index = namedPawns.length - 1; index >= 0; index--) {
      if (namedPawns[index].row !== exactRow) namedPawns.splice(index, 1)
    }
  }

  if (namedSide !== undefined && namedCol !== undefined) {
    if (namedPawns.length === 0) {
      facts.push(
        language === 'en'
          ? `There is no ${sideName(namedSide, language)} pawn on file ${FILES[namedCol]} in this position.`
          : `目前局面沒有位於${FILES[namedCol]}路的${sideName(namedSide, language)}兵。`
      )
    } else if (namedPawns.length > 1) {
      const positions = namedPawns
        .map(({ row, col }) => `${square(row, col)} (${crossedRiver(namedSide, row) ? 'crossed' : 'before river'})`)
        .join(language === 'en' ? ', ' : '、')
      facts.push(
        language === 'en'
          ? `There are ${namedPawns.length} ${sideName(namedSide, language)} pawns on file ${FILES[namedCol]}: ${positions}. Specify a square; no pawn was selected arbitrarily.`
          : `這一路有 ${namedPawns.length} 枚${sideName(namedSide, language)}兵：${positions}。請指定格位，不能任意選其中一枚。`
      )
    } else {
      const { row, col } = namedPawns[0]
      const crossed = crossedRiver(namedSide, row)
      facts.push(crossingFact(namedSide, row, col, crossed, language))
      facts.push(movementRuleFact(namedSide, crossed, language))
      if (retreatIntent) {
        facts.push(
          language === 'en'
            ? 'Backward movement is never legal for a pawn, before or after the river.'
            : '兵在過河前後都不能後退。'
        )
      }
      if (sidewaysIntent) appendSidewaysFacts(board, namedSide, row, col, language, facts)
      if (movementIntent && !crossingIntent && !sidewaysIntent && !retreatIntent) {
        appendForwardFact(board, namedSide, row, col, language, facts)
      }

      if (!strategicOrUnrelated && (crossingIntent || sidewaysIntent || retreatIntent)) {
        const prefix = sideIntent ? directSideAnswer(board, language) + ' ' : ''
        const fileNumber = namedSide === 'red' ? 9 - col : col + 1
        const label = language === 'en' ? `${sideName(namedSide, language)} pawn on ${square(row,col)}` : `${sideName(namedSide, language)}${'一二三四五六七八九'[fileNumber-1]}路${namedSide === 'red' ? '兵' : '卒'}`
        const rule = movementRuleFact(namedSide, crossed, language).replace(pawnName(namedSide, language), label)
        const detail = sidewaysIntent && crossed ? facts.filter(fact => /^(?:Target |目標 )/.test(fact)).join(' ') : ''
        return { facts, directAnswer: prefix + rule + (detail ? ' ' + detail : '') }
      }
    }
  } else if (pawnIntent && (crossingIntent || sidewaysIntent || retreatIntent || movementIntent)) {
    if (retreatIntent) {
      facts.push(language === 'en' ? 'A pawn can never move backward.' : '兵／卒永遠不能後退。')
    } else if (crossingIntent && sidewaysIntent) {
      facts.push(
        language === 'en'
          ? 'After crossing the river, a pawn may move one square horizontally, subject to occupied-target and king-safety legality checks.'
          : '兵／卒過河後可以橫走一格，但仍須檢查目標是否被占、是否造成己方被將軍。'
      )
    } else {
      facts.push(
        language === 'en'
          ? 'A pawn moves one step forward; after crossing the river it may also move one square horizontally, but never backward.'
          : '兵／卒只能向前一格；過河後才可橫走一格，任何時候都不能後退。'
      )
    }
  }

  if (facts.length === 0) facts.push(unsupportedFact(language))

  // A mixed strategic or unrelated clause receives grounded facts only. The
  // deterministic helper must not turn a partially recognized question into
  // an answer to the whole prompt.
  if (strategicOrUnrelated) return { facts }
  if (sideIntent && !pawnIntent) return { facts, directAnswer: directSideAnswer(board, language) }
  if (pawnIntent && !namedSide && crossingIntent && sidewaysIntent) {
    if (/這|这|那|this pawn|that pawn/i.test(normalized)) return { facts }
    return {
      facts,
      directAnswer:
        language === 'en'
          ? 'A pawn moves one square forward. Only after crossing the river may it also move one square horizontally, subject to target and king-safety checks. It can never move backward.'
          : language === 'zh-CN'
            ? '兵／卒每次向前一格，只有过河后才能横走一格；任何时候都不能后退，横走也须检查目标和将帅安全。'
            : '兵／卒每次向前一格，只有過河後才能橫走一格；任何時候都不能後退，橫走也須檢查目標和將帥安全。'
    }
  }
  if (pawnIntent && !namedSide && retreatIntent) {
    return {
      facts,
      directAnswer:
        language === 'en' ? 'No. A pawn cannot move backward.' : language === 'zh-CN' ? '不能，兵不能后退。' : '不能，兵不能後退。'
    }
  }
  return { facts }
}
