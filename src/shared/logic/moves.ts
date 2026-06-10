/**
 * 著法邏輯 (moves)
 *
 * UCI 著法座標解析與基本檢查。純函式，main / renderer 共用。
 *
 * 座標慣例（Pikafish / UCI 象棋）：
 *   - file a-i = 直線（紅方左起），對應 grid 欄 0-8
 *   - rank 0-9 = 橫線（紅方底線為 0），對應 grid 列 9-0（grid 列 0 為黑方底線）
 *   例：起始局面紅炮在 b2 / h2，即 grid[7][1] / grid[7][7]。
 *
 * 目前提供「基本檢查」：座標格式、起點有輪走方棋子、終點非己方棋子。
 * 完整走子規則驗證（兵種走法、王不見王）為後續 Stage 擴充。
 */

import { BOARD_COLS, BOARD_ROWS, type BoardGrid, type PieceColor } from '../types/BoardState'

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

/**
 * 基本著法檢查：格式、起點為輪走方棋子、終點非己方棋子、起訖不同。
 * 不含兵種走法規則；通過此檢查仍可能是非法著法。
 */
export function basicMoveCheck(
  grid: BoardGrid,
  sideToMove: PieceColor,
  move: string
): MoveCheckResult {
  const coords = parseUciMove(move)
  if (!coords) {
    return { ok: false, message: '著法格式錯誤，請輸入如 h2e2 的 UCI 著法。' }
  }
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
  return { ok: true }
}
