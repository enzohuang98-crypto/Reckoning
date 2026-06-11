/**
 * 錯題本條目型別 (Mistake book entry types) — SDS v0.2 §2.6.6
 *
 * 長期學習核心資料；保存當次 EngineAnalysis 方便回看引擎證據（§2.7.2）。
 */

import type { PieceColor } from './BoardState'
import type { EngineAnalysis } from './EngineAnalysis'
import type { ConfidenceLevel, MistakeLevel } from './MoveComparisonResult'

/** 錯題本單一條目（§2.6.6） */
export interface MistakeBookEntry {
  id: string
  /** ISO 字串 */
  createdAt: string
  /** ISO 字串 */
  updatedAt: string
  positionFen: string
  sideToMove: PieceColor
  userMove: string
  engineBestMove: string
  evaluationAfterUserMove: number | null
  evaluationAfterBestMove: number | null
  scoreDifference: number | null
  mistakeLevel: MistakeLevel
  confidence: ConfidenceLevel
  uncertaintyReasons: string[]
  /** AI 解釋文字；尚未生成時為空字串 */
  explanation: string
  /** 當次引擎分析（回看證據） */
  engineAnalysis: EngineAnalysis
  userNote?: string
  tags: string[]
  understood: boolean
}

/** 錯題本（localStorage 儲存的整體結構） */
export interface MistakeBook {
  entries: MistakeBookEntry[]
  /** schema 版本（v2 = SDS v0.2 形狀） */
  version: number
}
