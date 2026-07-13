import type {
  BoardState,
  Piece,
  PieceColor,
  PieceType
} from '../../types/BoardState'
import type { EngineScore } from '../../types/EngineAnalysis'
import { applyUciMove, parseUciMove } from './moves'

const RED_NUMERALS = ['九', '八', '七', '六', '五', '四', '三', '二', '一']
const BLACK_NUMERALS = ['1', '2', '3', '4', '5', '6', '7', '8', '9']

const PIECE_NAME: Record<PieceColor, Record<PieceType, string>> = {
  red: {
    king: '帥',
    advisor: '仕',
    elephant: '相',
    horse: '馬',
    rook: '車',
    cannon: '炮',
    pawn: '兵'
  },
  black: {
    king: '將',
    advisor: '士',
    elephant: '象',
    horse: '馬',
    rook: '車',
    cannon: '炮',
    pawn: '卒'
  }
}

function numeral(color: PieceColor, colOrDistance: number, isDistance = false): string {
  if (isDistance) {
    return color === 'red'
      ? ['零', '一', '二', '三', '四', '五', '六', '七', '八', '九'][colOrDistance]
      : String(colOrDistance)
  }
  return color === 'red' ? RED_NUMERALS[colOrDistance] : BLACK_NUMERALS[colOrDistance]
}

function sameFilePrefix(
  board: BoardState,
  piece: Piece,
  row: number,
  col: number
): string | null {
  const rows: number[] = []
  for (let candidateRow = 0; candidateRow < board.grid.length; candidateRow++) {
    const candidate = board.grid[candidateRow][col]
    if (candidate?.color === piece.color && candidate.type === piece.type) {
      rows.push(candidateRow)
    }
  }
  if (rows.length < 2 || rows.length > 3) return null
  rows.sort((a, b) => (piece.color === 'red' ? a - b : b - a))
  const index = rows.indexOf(row)
  if (rows.length === 2) return ['前', '後'][index] ?? null
  return ['前', '中', '後'][index] ?? null
}

/** 將 UCI 著法轉成繁體中文象棋記譜，例如 h2e2 → 炮二平五。 */
export function formatChineseMove(board: BoardState, move: string): string | null {
  const coords = parseUciMove(move)
  if (!coords) return null
  const piece = board.grid[coords.fromRow][coords.fromCol]
  if (!piece) return null

  const name = PIECE_NAME[piece.color][piece.type]
  const prefix = sameFilePrefix(
    board,
    piece,
    coords.fromRow,
    coords.fromCol
  )
  const subject = prefix
    ? `${prefix}${name}`
    : `${name}${numeral(piece.color, coords.fromCol)}`

  if (coords.fromRow === coords.toRow) {
    return `${subject}平${numeral(piece.color, coords.toCol)}`
  }

  const forward =
    piece.color === 'red'
      ? coords.toRow < coords.fromRow
      : coords.toRow > coords.fromRow
  const action = forward ? '進' : '退'
  const diagonalPiece =
    piece.type === 'horse' ||
    piece.type === 'elephant' ||
    piece.type === 'advisor'
  const target = diagonalPiece
    ? numeral(piece.color, coords.toCol)
    : numeral(piece.color, Math.abs(coords.toRow - coords.fromRow), true)
  return `${subject}${action}${target}`
}

export function formatChineseVariation(
  board: BoardState,
  moves: string[]
): string[] {
  const result: string[] = []
  let current = board
  for (const move of moves) {
    const display = formatChineseMove(current, move)
    if (!display) {
      result.push('後續著法無法轉換')
      break
    }
    result.push(display)
    const applied = applyUciMove(current, move)
    if (!applied.valid) break
    current = applied.board
  }
  return result
}

export function formatChineseScore(score: EngineScore | null): string {
  if (score === null) return '暫無評估'
  if (score.type === 'mate') return score.displayText
  if (score.value > 0) return `行棋方優勢 ${score.value.toFixed(2)} 子`
  if (score.value < 0) return `行棋方落後 ${Math.abs(score.value).toFixed(2)} 子`
  return '局勢均衡'
}
