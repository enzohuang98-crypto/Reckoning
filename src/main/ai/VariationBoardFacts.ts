import { parseFen } from '@shared/logic/board/fen'
import { applyUciMove, isKingInCheck, parseUciMove } from '@shared/logic/board/moves'
import { formatChineseMove } from '@shared/logic/board/ChineseNotation'
import type { PieceColor, PieceType } from '@shared/types/BoardState'
import type { HarnessEvidence } from '@shared/types/Harness'

export interface VariationStepFact {
  ply: number
  move: string
  side: PieceColor
  piece: PieceType
  fromFile: number
  toFile: number
  captured: { side: PieceColor; piece: PieceType } | null
  givesCheck: boolean
}

/** Board facts only, never a strategic verdict or proof of a model's explanation. */
export function buildVariationBoardFacts(evidence: HarnessEvidence): {
  steps: VariationStepFact[]
  warning: string | null
} {
  const parsed = parseFen(evidence.positionFen)
  if (!parsed.valid) return { steps: [], warning: '證據起始局面無效，不能計算棋盤事實。' }
  const isUserLine = evidence.move !== undefined && evidence.move === evidence.analysis.userMove
  const moves = isUserLine
    ? evidence.analysis.userMovePrincipalVariation ?? []
    : evidence.analysis.principalVariation
  let board = parsed.board
  const steps: VariationStepFact[] = []
  // Match the initial writer's visible PV limit and keep repair input bounded.
  for (const [index, uci] of moves.slice(0, 12).entries()) {
    const coordinates = parseUciMove(uci)
    const display = formatChineseMove(board, uci)
    const applied = applyUciMove(board, uci)
    if (!coordinates || !display || !applied.valid) {
      return { steps, warning: `第 ${index + 1} 手未通過合法性檢查，其後沒有可計算事實。` }
    }
    if (evidence.displayPrincipalVariation[index] !== display) {
      return { steps, warning: `第 ${index + 1} 手中文記譜與本變例棋盤不一致，其後沒有可計算事實。` }
    }
    const piece = board.grid[coordinates.fromRow][coordinates.fromCol]!
    const file = (column: number): number => piece.color === 'red' ? 9 - column : column + 1
    steps.push({
      ply: index + 1,
      move: display,
      side: piece.color,
      piece: piece.type,
      fromFile: file(coordinates.fromCol),
      toFile: file(coordinates.toCol),
      captured: applied.captured
        ? { side: applied.captured.color, piece: applied.captured.type }
        : null,
      givesCheck: isKingInCheck(applied.board.grid, applied.board.sideToMove)
    })
    board = applied.board
  }
  return { steps, warning: moves.length === 0 ? '沒有 UCI 主線，不能計算棋盤事實。' : null }
}
