/**
 * 著法邏輯 (moves)
 *
 * UCI 著法座標解析、完整走子合法性驗證、著法套用。純函式，main / renderer 共用。
 *
 * 座標慣例（Pikafish / UCI 象棋）：
 *   - file a-i = 直線（紅方左起），對應 grid 欄 0-8
 *   - rank 0-9 = 橫線（紅方底線為 0），對應 grid 列 9-0（grid 列 0 為黑方底線）
 *   例：起始局面紅炮在 b2 / h2，即 grid[7][1] / grid[7][7]。
 *
 * 合法性驗證分三層：
 *   1. basicMoveCheck — 格式、起點為輪走方棋子、終點非己方棋子
 *   2. 兵種走法（含蹩馬腿、塞象眼、炮架、過河兵、九宮限制）
 *   3. 走後狀態 — 己方不可被將軍（送將）、王不見王
 */

import {
  BOARD_COLS,
  BOARD_ROWS,
  type BoardGrid,
  type BoardState,
  type Piece,
  type PieceColor
} from '../types/BoardState'
import { serializeFen } from './fen'

/** UCI 著法的格座標（grid 列/欄） */
export interface MoveCoords {
  fromRow: number
  fromCol: number
  toRow: number
  toCol: number
}

const UCI_MOVE_PATTERN = /^[a-i]\d[a-i]\d$/

/** UCI 著法格式是否正確（不檢查合法性） */
export function isUciMoveFormat(move: string): boolean {
  return UCI_MOVE_PATTERN.test(move)
}

/** 將 UCI 著法解析為 grid 座標；格式錯誤回 null */
export function parseUciMove(move: string): MoveCoords | null {
  if (!UCI_MOVE_PATTERN.test(move)) return null
  const fileToCol = (ch: string): number => ch.charCodeAt(0) - 'a'.charCodeAt(0)
  const rankToRow = (ch: string): number => BOARD_ROWS - 1 - Number(ch)
  const coords: MoveCoords = {
    fromCol: fileToCol(move[0]),
    fromRow: rankToRow(move[1]),
    toCol: fileToCol(move[2]),
    toRow: rankToRow(move[3])
  }
  if (
    coords.fromCol >= BOARD_COLS ||
    coords.toCol >= BOARD_COLS ||
    coords.fromRow < 0 ||
    coords.toRow < 0
  ) {
    return null
  }
  return coords
}

/** 基本著法檢查結果 */
export type MoveCheckResult = { ok: true } | { ok: false; message: string }

/** 基本檢查（含起點棋子）的內部結果 */
type BasicsResult = { ok: true; piece: Piece } | { ok: false; message: string }

/** 基本檢查核心：起訖不同、起點為輪走方棋子、終點非己方棋子（座標已解析） */
function checkBasicsAt(
  grid: BoardGrid,
  sideToMove: PieceColor,
  coords: MoveCoords,
  move: string
): BasicsResult {
  if (coords.fromRow === coords.toRow && coords.fromCol === coords.toCol) {
    return { ok: false, message: '起點與終點相同。' }
  }
  const piece = grid[coords.fromRow][coords.fromCol]
  if (!piece) {
    return { ok: false, message: `起點 ${move.slice(0, 2)} 沒有棋子。` }
  }
  if (piece.color !== sideToMove) {
    return {
      ok: false,
      message: `起點 ${move.slice(0, 2)} 是${piece.color === 'red' ? '紅' : '黑'}方棋子，現在輪${
        sideToMove === 'red' ? '紅' : '黑'
      }方走。`
    }
  }
  const target = grid[coords.toRow][coords.toCol]
  if (target && target.color === sideToMove) {
    return { ok: false, message: `終點 ${move.slice(2, 4)} 已有己方棋子。` }
  }
  if (target && target.type === 'king') {
    return { ok: false, message: '不可直接吃將/帥（將死即結束對局）。' }
  }
  return { ok: true, piece }
}

const FORMAT_ERROR: { ok: false; message: string } = {
  ok: false,
  message: '著法格式錯誤，請輸入如 h2e2 的 UCI 著法。'
}

/**
 * 基本著法檢查：格式、起點為輪走方棋子、終點非己方棋子、起訖不同。
 * 不含兵種走法規則；通過此檢查仍可能是非法著法（完整驗證用 legalMoveCheck）。
 */
export function basicMoveCheck(
  grid: BoardGrid,
  sideToMove: PieceColor,
  move: string
): MoveCheckResult {
  const coords = parseUciMove(move)
  if (!coords) return FORMAT_ERROR
  const basics = checkBasicsAt(grid, sideToMove, coords, move)
  return basics.ok ? { ok: true } : basics
}

/* ---------- 兵種走法 ---------- */

/** 是否在九宮內（紅方 row 7-9、黑方 row 0-2，col 3-5） */
function inPalace(color: PieceColor, row: number, col: number): boolean {
  if (col < 3 || col > 5) return false
  return color === 'red' ? row >= 7 : row <= 2
}

/** 該列是否已過河（以「棋子所在列」判斷；紅方河界以北 row<=4、黑方 row>=5） */
function crossedRiver(color: PieceColor, row: number): boolean {
  return color === 'red' ? row <= 4 : row >= 5
}

/** 同列或同欄時，兩點之間（不含端點）的棋子數；非直線回 -1 */
function countBetween(
  grid: BoardGrid,
  fromRow: number,
  fromCol: number,
  toRow: number,
  toCol: number
): number {
  if (fromRow !== toRow && fromCol !== toCol) return -1
  let count = 0
  if (fromRow === toRow) {
    const [lo, hi] = fromCol < toCol ? [fromCol, toCol] : [toCol, fromCol]
    for (let c = lo + 1; c < hi; c++) if (grid[fromRow][c]) count++
  } else {
    const [lo, hi] = fromRow < toRow ? [fromRow, toRow] : [toRow, fromRow]
    for (let r = lo + 1; r < hi; r++) if (grid[r][fromCol]) count++
  }
  return count
}

/**
 * 兵種走法檢查（不含走後送將/王不見王）。
 * 假設已通過 basicMoveCheck（起點有 piece、終點非己方）。
 */
function pieceMoveCheck(
  grid: BoardGrid,
  piece: Piece,
  { fromRow, fromCol, toRow, toCol }: MoveCoords
): MoveCheckResult {
  const dr = toRow - fromRow
  const dc = toCol - fromCol
  const adr = Math.abs(dr)
  const adc = Math.abs(dc)
  const target = grid[toRow][toCol]

  switch (piece.type) {
    case 'king': {
      if (adr + adc !== 1) {
        return { ok: false, message: '將/帥每步只能直走一格。' }
      }
      if (!inPalace(piece.color, toRow, toCol)) {
        return { ok: false, message: '將/帥不能離開九宮。' }
      }
      return { ok: true }
    }
    case 'advisor': {
      if (adr !== 1 || adc !== 1) {
        return { ok: false, message: '士/仕每步只能斜走一格。' }
      }
      if (!inPalace(piece.color, toRow, toCol)) {
        return { ok: false, message: '士/仕不能離開九宮。' }
      }
      return { ok: true }
    }
    case 'elephant': {
      if (adr !== 2 || adc !== 2) {
        return { ok: false, message: '象/相走田字（斜走兩格）。' }
      }
      if (crossedRiver(piece.color, toRow)) {
        return { ok: false, message: '象/相不能過河。' }
      }
      if (grid[fromRow + dr / 2][fromCol + dc / 2]) {
        return { ok: false, message: '塞象眼：田字中心有棋子。' }
      }
      return { ok: true }
    }
    case 'horse': {
      if (!((adr === 2 && adc === 1) || (adr === 1 && adc === 2))) {
        return { ok: false, message: '馬走日字。' }
      }
      const legRow = adr === 2 ? fromRow + dr / 2 : fromRow
      const legCol = adc === 2 ? fromCol + dc / 2 : fromCol
      if (grid[legRow][legCol]) {
        return { ok: false, message: '蹩馬腿：馬腿位置有棋子。' }
      }
      return { ok: true }
    }
    case 'rook': {
      const between = countBetween(grid, fromRow, fromCol, toRow, toCol)
      if (between === -1) {
        return { ok: false, message: '車只能直線移動。' }
      }
      if (between > 0) {
        return { ok: false, message: '車的路徑上有棋子阻擋。' }
      }
      return { ok: true }
    }
    case 'cannon': {
      const between = countBetween(grid, fromRow, fromCol, toRow, toCol)
      if (between === -1) {
        return { ok: false, message: '炮只能直線移動。' }
      }
      if (target) {
        if (between !== 1) {
          return { ok: false, message: '炮吃子需隔恰好一個棋子（炮架）。' }
        }
      } else if (between > 0) {
        return { ok: false, message: '炮不吃子時路徑上不可有棋子。' }
      }
      return { ok: true }
    }
    case 'pawn': {
      const forward = piece.color === 'red' ? -1 : 1
      const isForward = dr === forward && dc === 0
      const isSideways = dr === 0 && adc === 1
      if (isForward) return { ok: true }
      if (isSideways) {
        if (!crossedRiver(piece.color, fromRow)) {
          return { ok: false, message: '兵/卒過河後才能橫走。' }
        }
        return { ok: true }
      }
      return { ok: false, message: '兵/卒只能往前走一格（過河後可橫走一格），不能後退。' }
    }
  }
}

/* ---------- 走後狀態檢查 ---------- */

/** 找到指定顏色的將/帥位置；不存在回 null */
function findKing(grid: BoardGrid, color: PieceColor): { row: number; col: number } | null {
  for (let r = 0; r < BOARD_ROWS; r++) {
    for (let c = 0; c < BOARD_COLS; c++) {
      const p = grid[r][c]
      if (p && p.type === 'king' && p.color === color) return { row: r, col: c }
    }
  }
  return null
}

/** 王不見王：雙方將/帥同欄且中間無子 */
export function kingsFacing(grid: BoardGrid): boolean {
  const red = findKing(grid, 'red')
  const black = findKing(grid, 'black')
  if (!red || !black || red.col !== black.col) return false
  return countBetween(grid, red.row, red.col, black.row, black.col) === 0
}

/** 指定格是否被 byColor 方攻擊（不含王不見王，該規則由 kingsFacing 處理） */
function isSquareAttacked(
  grid: BoardGrid,
  row: number,
  col: number,
  byColor: PieceColor
): boolean {
  for (let r = 0; r < BOARD_ROWS; r++) {
    for (let c = 0; c < BOARD_COLS; c++) {
      const p = grid[r][c]
      if (!p || p.color !== byColor || p.type === 'king') continue
      const check = pieceMoveCheck(grid, p, {
        fromRow: r,
        fromCol: c,
        toRow: row,
        toCol: col
      })
      if (check.ok) return true
    }
  }
  return false
}

/** 指定顏色的將/帥是否被將軍 */
export function isKingInCheck(grid: BoardGrid, color: PieceColor): boolean {
  const king = findKing(grid, color)
  if (!king) return false
  return isSquareAttacked(grid, king.row, king.col, color === 'red' ? 'black' : 'red')
}

/** 套用著法產生新 grid（不驗證合法性；呼叫端先驗證） */
function applyMoveToGrid(grid: BoardGrid, coords: MoveCoords): BoardGrid {
  const next = grid.map((row) => row.slice())
  next[coords.toRow][coords.toCol] = next[coords.fromRow][coords.fromCol]
  next[coords.fromRow][coords.fromCol] = null
  return next
}

/** 走後狀態檢查：不送將、不違反王不見王 */
function checkAfterState(after: BoardGrid, sideToMove: PieceColor): MoveCheckResult {
  if (kingsFacing(after)) {
    return { ok: false, message: '走後將帥對臉（王不見王）。' }
  }
  if (isKingInCheck(after, sideToMove)) {
    return { ok: false, message: '走後己方將/帥被將軍（送將）。' }
  }
  return { ok: true }
}

/**
 * 完整著法合法性檢查：基本檢查 + 兵種走法 + 走後不送將、不違反王不見王。
 */
export function legalMoveCheck(
  grid: BoardGrid,
  sideToMove: PieceColor,
  move: string
): MoveCheckResult {
  const coords = parseUciMove(move)
  if (!coords) return FORMAT_ERROR
  const basics = checkBasicsAt(grid, sideToMove, coords, move)
  if (!basics.ok) return basics

  const shape = pieceMoveCheck(grid, basics.piece, coords)
  if (!shape.ok) return shape

  return checkAfterState(applyMoveToGrid(grid, coords), sideToMove)
}

/** 套用著法的結果 */
export type ApplyMoveResult =
  | { valid: true; board: BoardState; captured: Piece | null }
  | { valid: false; message: string }

/**
 * 驗證並套用一步 UCI 著法，回傳新的 BoardState（含更新後 FEN 與回合計數）。
 * 棋譜匯入與逐步檢視用。
 */
export function applyUciMove(board: BoardState, move: string): ApplyMoveResult {
  const coords = parseUciMove(move)
  if (!coords) return { valid: false, message: FORMAT_ERROR.message }
  const basics = checkBasicsAt(board.grid, board.sideToMove, coords, move)
  if (!basics.ok) return { valid: false, message: basics.message }
  const shape = pieceMoveCheck(board.grid, basics.piece, coords)
  if (!shape.ok) return { valid: false, message: shape.message }

  const moving = basics.piece
  const captured = board.grid[coords.toRow][coords.toCol]
  const grid = applyMoveToGrid(board.grid, coords)

  const afterCheck = checkAfterState(grid, board.sideToMove)
  if (!afterCheck.ok) return { valid: false, message: afterCheck.message }
  const sideToMove: PieceColor = board.sideToMove === 'red' ? 'black' : 'red'
  // 半回合計數：吃子或動兵歸零，否則 +1（與西洋棋 FEN 慣例一致）
  const halfmoveClock = captured || moving.type === 'pawn' ? 0 : board.halfmoveClock + 1
  // 黑方走完回合數 +1
  const fullmoveNumber =
    board.sideToMove === 'black' ? board.fullmoveNumber + 1 : board.fullmoveNumber

  return {
    valid: true,
    captured,
    board: {
      grid,
      sideToMove,
      halfmoveClock,
      fullmoveNumber,
      fen: serializeFen(grid, sideToMove, halfmoveClock, fullmoveNumber)
    }
  }
}
