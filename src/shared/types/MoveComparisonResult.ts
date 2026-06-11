/**
 * 著法比較結果型別 (Move comparison result types) — SDS v0.2 §2.6.4、§2.6.5
 *
 * MistakeLevel 為全系統共用：MoveComparisonService、MistakeBookEntry、
 * StorageService、UI 與資料庫欄位都必須使用同一組值。
 * 第一版不使用 turning_point（§2.13.4）。
 */

import type { PieceColor } from './BoardState'

/** 錯誤等級（§2.6.4） */
export type MistakeLevel =
  | 'unknown'
  | 'acceptable_or_tiny_inaccuracy'
  | 'inaccuracy'
  | 'mistake'
  | 'serious_mistake'
  | 'major_blunder'

/** 中文顯示（§2.13.3 區間表） */
export const MISTAKE_LEVEL_LABELS: Record<MistakeLevel, string> = {
  unknown: '無法判定',
  acceptable_or_tiny_inaccuracy: '可接受或輕微誤差',
  inaccuracy: '緩手／不精確',
  mistake: '明顯錯誤',
  serious_mistake: '嚴重錯誤',
  major_blunder: '重大敗著'
}

/** 可信度（§2.13.6） */
export type ConfidenceLevel = 'low' | 'medium' | 'high'

/** 比較結果（§2.6.5）。evaluation 與 scoreDifference 單位為兵/卒（cp/100）。 */
export interface MoveComparisonResult {
  positionFen: string
  sideToMove: PieceColor
  userMove: string
  engineBestMove: string
  evaluationAfterUserMove: number | null
  evaluationAfterBestMove: number | null
  /** 任一 evaluation 為 null 時必須為 null，不得補 0（§2.13.2） */
  scoreDifference: number | null
  mistakeLevel: MistakeLevel
  depth: number | null
  confidence: ConfidenceLevel
  uncertaintyReasons: string[]
}
