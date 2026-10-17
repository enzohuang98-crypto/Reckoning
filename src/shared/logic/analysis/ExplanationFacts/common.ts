/** 事實計算與文字輸出共用的小工具（模組內部用，不對外匯出）。 */

import type { PieceColor, PieceType } from '../../../types/BoardState'

/** 殘局棋子清單的排序（計算與輸出共用）。 */
export const INVENTORY_ORDER: PieceType[] = ['king', 'rook', 'horse', 'cannon', 'advisor', 'elephant', 'pawn']

export function opponent(color: PieceColor): PieceColor {
  return color === 'red' ? 'black' : 'red'
}
