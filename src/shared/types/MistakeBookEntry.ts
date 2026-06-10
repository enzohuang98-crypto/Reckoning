/**
 * 錯題本條目型別 (Mistake book entry types)
 */

import type { PieceColor } from './BoardState'
import type { MoveComparisonResult } from './MoveComparisonResult'
import type { AIExplanationResponse } from './AIExplanationTypes'

/** 錯題本單一條目 */
export interface MistakeBookEntry {
  /** 唯一識別碼 */
  id: string
  /** 建立時間 (epoch ms) */
  createdAt: number
  /** 局面 FEN */
  fen: string
  /** 輪走方 */
  sideToMove: PieceColor
  /** 使用者實際走的著法 (UCI) */
  playedMoveUci: string
  /** 引擎最佳著法 (UCI) */
  bestMoveUci: string
  /** 著法比較結果（含錯誤等級） */
  comparison: MoveComparisonResult
  /** AI 解釋（選用，可稍後產生） */
  explanation?: AIExplanationResponse
  /** 使用者筆記 */
  note?: string
  /** 標籤，例如 ['中局', '炮']，便於分類複習 */
  tags: string[]
}

/** 錯題本（localStorage 儲存的整體結構） */
export interface MistakeBook {
  entries: MistakeBookEntry[]
  /** schema 版本，便於日後遷移 */
  version: number
}
