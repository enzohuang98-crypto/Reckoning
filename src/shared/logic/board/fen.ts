/**
 * FEN 解析與序列化 (FEN parsing & serialization)
 *
 * 純函式，無副作用，可同時用於 main 與 renderer。
 * 採用 Pikafish / UCI 的象棋 FEN 慣例。
 */

import {
  BOARD_COLS,
  BOARD_ROWS,
  type BoardGrid,
  type BoardState,
  type FenValidationResult,
  type Piece,
  type PieceCode,
  type PieceColor,
  type PieceType
} from '../../types/BoardState'

const CODE_TO_TYPE: Record<string, PieceType> = {
  k: 'king',
  a: 'advisor',
  b: 'elephant',
  n: 'horse',
  r: 'rook',
  c: 'cannon',
  p: 'pawn'
}

/** 將 FEN 字母轉為 Piece（非法字母回傳 null） */
export function pieceFromCode(code: string): Piece | null {
  const lower = code.toLowerCase()
  const type = CODE_TO_TYPE[lower]
  if (!type) return null
  const color: PieceColor = code === lower ? 'black' : 'red'
  return { type, color, code: code as PieceCode }
}

/** 建立全空棋盤格陣列 */
export function createEmptyGrid(): BoardGrid {
  return Array.from({ length: BOARD_ROWS }, () =>
    Array.from({ length: BOARD_COLS }, () => null as Piece | null)
  )
}

/**
 * 解析 FEN 字串為 BoardState。
 * 回傳 valid:false 與訊息，而非 throw，方便 UI 顯示。
 */
export function parseFen(fen: string): FenValidationResult {
  const trimmed = fen.trim()
  if (!trimmed) {
    return { valid: false, message: 'FEN 不可為空' }
  }

  const parts = trimmed.split(/\s+/)
  if (parts.length > 6) {
    return { valid: false, message: `FEN 欄位過多（最多 6 個，實際 ${parts.length} 個）` }
  }
  const placement = parts[0]
  const sideField = parts[1] ?? 'w'
  const halfmoveField = parts[4] ?? '0'
  const fullmoveField = parts[5] ?? '1'

  const rows = placement.split('/')
  if (rows.length !== BOARD_ROWS) {
    return {
      valid: false,
      message: `局面必須有 ${BOARD_ROWS} 列，實際為 ${rows.length} 列`
    }
  }

  const grid = createEmptyGrid()

  for (let r = 0; r < BOARD_ROWS; r++) {
    const rowStr = rows[r]
    let col = 0
    for (const ch of rowStr) {
      if (ch >= '1' && ch <= '9') {
        col += Number(ch)
        if (col > BOARD_COLS) {
          return { valid: false, message: `第 ${r + 1} 列格數超過 ${BOARD_COLS}` }
        }
      } else {
        const piece = pieceFromCode(ch)
        if (!piece) {
          return { valid: false, message: `第 ${r + 1} 列含非法棋子字母 '${ch}'` }
        }
        if (col >= BOARD_COLS) {
          return { valid: false, message: `第 ${r + 1} 列格數超過 ${BOARD_COLS}` }
        }
        grid[r][col] = piece
        col += 1
      }
    }
    if (col !== BOARD_COLS) {
      return {
        valid: false,
        message: `第 ${r + 1} 列格數為 ${col}，應為 ${BOARD_COLS}`
      }
    }
  }

  if (sideField !== 'w' && sideField !== 'b') {
    return { valid: false, message: `輪走方必須為 'w' 或 'b'，實際為 '${sideField}'` }
  }
  const sideToMove: PieceColor = sideField === 'w' ? 'red' : 'black'

  // 基本合法性：雙方各需恰有一個將/帥
  const kings = countKings(grid)
  if (kings.red !== 1 || kings.black !== 1) {
    return {
      valid: false,
      message: `雙方各需一個將/帥（紅 ${kings.red}、黑 ${kings.black}）`
    }
  }

  const halfmoveClock = Number(halfmoveField)
  if (!Number.isSafeInteger(halfmoveClock) || halfmoveClock < 0) {
    return { valid: false, message: `半回合計數必須是非負整數，實際為 '${halfmoveField}'` }
  }
  const fullmoveNumber = Number(fullmoveField)
  if (!Number.isSafeInteger(fullmoveNumber) || fullmoveNumber < 1) {
    return { valid: false, message: `回合數必須是大於 0 的整數，實際為 '${fullmoveField}'` }
  }

  const board: BoardState = {
    grid,
    sideToMove,
    fen: serializeFen(grid, sideToMove, halfmoveClock, fullmoveNumber),
    halfmoveClock,
    fullmoveNumber
  }
  return { valid: true, board }
}

function countKings(grid: BoardGrid): { red: number; black: number } {
  let red = 0
  let black = 0
  for (const row of grid) {
    for (const cell of row) {
      if (cell?.type === 'king') {
        if (cell.color === 'red') red++
        else black++
      }
    }
  }
  return { red, black }
}

/** 將棋盤格陣列序列化為 FEN 字串 */
export function serializeFen(
  grid: BoardGrid,
  sideToMove: PieceColor,
  halfmoveClock = 0,
  fullmoveNumber = 1
): string {
  const rows: string[] = []
  for (let r = 0; r < BOARD_ROWS; r++) {
    let rowStr = ''
    let empty = 0
    for (let c = 0; c < BOARD_COLS; c++) {
      const cell = grid[r][c]
      if (!cell) {
        empty += 1
      } else {
        if (empty > 0) {
          rowStr += String(empty)
          empty = 0
        }
        rowStr += cell.code
      }
    }
    if (empty > 0) rowStr += String(empty)
    rows.push(rowStr)
  }
  const side = sideToMove === 'red' ? 'w' : 'b'
  return `${rows.join('/')} ${side} - - ${halfmoveClock} ${fullmoveNumber}`
}

/** 從 BoardState 重新序列化 FEN（在編輯棋盤後使用） */
export function boardToFen(board: BoardState): string {
  return serializeFen(
    board.grid,
    board.sideToMove,
    board.halfmoveClock,
    board.fullmoveNumber
  )
}
