/**
 * 棋子顯示輔助 (Piece display helpers)
 */

import type { Piece, PieceColor, PieceType } from '@shared/types/BoardState'

/** 各棋子在紅/黑方的中文字 */
const GLYPHS: Record<PieceType, Record<PieceColor, string>> = {
  king: { red: '帥', black: '將' },
  advisor: { red: '仕', black: '士' },
  elephant: { red: '相', black: '象' },
  horse: { red: '傌', black: '馬' },
  rook: { red: '俥', black: '車' },
  cannon: { red: '炮', black: '砲' },
  pawn: { red: '兵', black: '卒' }
}

export function pieceGlyph(piece: Piece): string {
  return GLYPHS[piece.type][piece.color]
}

/** 擺棋編輯器的可選棋子調色盤（依顏色） */
export const PIECE_PALETTE: Record<PieceColor, { type: PieceType; glyph: string }[]> = {
  red: (Object.keys(GLYPHS) as PieceType[]).map((type) => ({
    type,
    glyph: GLYPHS[type].red
  })),
  black: (Object.keys(GLYPHS) as PieceType[]).map((type) => ({
    type,
    glyph: GLYPHS[type].black
  }))
}

/** type+color → FEN 字母 */
const TYPE_TO_LETTER: Record<PieceType, string> = {
  king: 'k',
  advisor: 'a',
  elephant: 'b',
  horse: 'n',
  rook: 'r',
  cannon: 'c',
  pawn: 'p'
}

export function makePiece(type: PieceType, color: PieceColor): Piece {
  const lower = TYPE_TO_LETTER[type]
  const code = color === 'red' ? lower.toUpperCase() : lower
  return { type, color, code: code as Piece['code'] }
}
