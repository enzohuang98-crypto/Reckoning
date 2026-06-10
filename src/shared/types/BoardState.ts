/**
 * 棋盤狀態型別 (Board state types)
 *
 * 中國象棋棋盤為 10 列 (rank) x 9 行 (file)。
 * 座標系統：grid[row][col]，row 0 為 FEN 最上方 (黑方底線)，row 9 為紅方底線。
 * FEN 使用 Pikafish / UCI 慣例的棋子字母。
 */

/** 棋子顏色 */
export type PieceColor = 'red' | 'black'

/** 棋子種類 */
export type PieceType =
  | 'king' // 將/帥
  | 'advisor' // 士/仕
  | 'elephant' // 象/相
  | 'horse' // 馬/傌
  | 'rook' // 車/俥
  | 'cannon' // 炮/砲
  | 'pawn' // 卒/兵

/**
 * FEN 棋子代碼。大寫為紅方，小寫為黑方。
 * K=king A=advisor B=elephant N=horse R=rook C=cannon P=pawn
 */
export type PieceCode =
  | 'K'
  | 'A'
  | 'B'
  | 'N'
  | 'R'
  | 'C'
  | 'P'
  | 'k'
  | 'a'
  | 'b'
  | 'n'
  | 'r'
  | 'c'
  | 'p'

/** 單一棋子 */
export interface Piece {
  type: PieceType
  color: PieceColor
  /** 對應 FEN 字母，便於序列化與渲染 */
  code: PieceCode
}

/** 棋盤格子：有棋子或 null（空格） */
export type BoardCell = Piece | null

/** 棋盤格陣列：[row 0..9][col 0..8] */
export type BoardGrid = BoardCell[][]

/** 棋盤尺寸常數 */
export const BOARD_ROWS = 10
export const BOARD_COLS = 9

/** 棋盤標準開局 FEN（Pikafish/UCI 慣例） */
export const START_FEN =
  'rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNR w - - 0 1'

/** 空棋盤 FEN（用於擺棋編輯器初始狀態） */
export const EMPTY_FEN = '9/9/9/9/9/9/9/9/9/9 w - - 0 1'

/**
 * 完整棋盤狀態。
 * `fen` 為權威來源，`grid` 為解析後的方便表示。
 */
export interface BoardState {
  /** 解析後的棋盤格陣列 (10x9) */
  grid: BoardGrid
  /** 輪到走子的一方 */
  sideToMove: PieceColor
  /** 權威 FEN 字串 */
  fen: string
  /** 半回合計數（無吃子推進步數） */
  halfmoveClock: number
  /** 完整回合數，從 1 起算 */
  fullmoveNumber: number
}

/** FEN 解析錯誤 */
export interface FenValidationError {
  valid: false
  /** 人類可讀錯誤訊息 */
  message: string
}

/** FEN 解析成功 */
export interface FenValidationOk {
  valid: true
  board: BoardState
}

export type FenValidationResult = FenValidationOk | FenValidationError
