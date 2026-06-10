/**
 * 著法比較結果型別 (Move comparison types)
 *
 * MoveComparisonService 比較「實際走的著法」與「引擎最佳著法」的分數差，
 * 給出錯誤分級與信心值。錯誤分級採用半開區間，並支援負分（mate 正規化後）處理。
 */

import type { EngineScore } from './EngineAnalysis'

/** 錯誤等級 */
export type MoveQuality = 'Blunder' | 'Mistake' | 'Inaccuracy' | 'OK'

/**
 * 錯誤分級的厘子門檻（半開區間，以厘子損失 centipawnLoss 判斷）：
 *  - OK         : loss ≤ 50
 *  - Inaccuracy : 50  < loss ≤ 150
 *  - Mistake    : 150 < loss ≤ 300
 *  - Blunder    : loss > 300
 */
export const MOVE_QUALITY_THRESHOLDS = {
  inaccuracy: 50,
  mistake: 150,
  blunder: 300
} as const

/** 各等級的顯示中文標籤 */
export const MOVE_QUALITY_LABELS: Record<MoveQuality, string> = {
  Blunder: '大漏著',
  Mistake: '錯著',
  Inaccuracy: '不精確',
  OK: '良好'
}

/** 著法比較結果 */
export interface MoveComparisonResult {
  /** 實際走的著法 (UCI) */
  playedMoveUci: string
  /** 引擎最佳著法 (UCI) */
  bestMoveUci: string
  /** 最佳著法分數（輪走方視角，mate 已正規化為厘子） */
  bestScoreCp: number
  /** 實際著法分數（輪走方視角，mate 已正規化為厘子） */
  playedScoreCp: number
  /** 厘子損失 = bestScoreCp - playedScoreCp，理論上 ≥ 0 */
  centipawnLoss: number
  /** 錯誤等級 */
  quality: MoveQuality
  /** 信心值 0..1（差距越極端、越接近門檻中心，信心越高） */
  confidence: number
  /** 是否涉及 mate 分數（特殊處理） */
  isMateRelated: boolean
  /** 原始實際著法分數 */
  playedScore: EngineScore
  /** 原始最佳著法分數 */
  bestScore: EngineScore
}
