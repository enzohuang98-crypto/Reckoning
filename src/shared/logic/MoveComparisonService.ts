/**
 * 著法比較服務 (MoveComparisonService)
 *
 * 比較「實際著法分數」與「引擎最佳著法分數」，給出錯誤分級與信心值。
 *
 * 設計重點（依 SDS）：
 *  - 錯誤分級採半開區間。
 *  - 支援負分：分數先經 scoreToCentipawns 正規化（mate 視為極大值），
 *    因此「被將死」會得到大負值，比較仍然正確。
 *  - confidence 一併計算：著法損失離分級邊界越遠，分類越明確，信心越高；
 *    涉及 mate 的判定視為極明確。
 */

import {
  scoreToCentipawns,
  type EngineScore
} from '../types/EngineAnalysis'
import {
  MOVE_QUALITY_THRESHOLDS,
  type MoveComparisonResult,
  type MoveQuality
} from '../types/MoveComparisonResult'

/** 比較輸入 */
export interface MoveComparisonInput {
  playedMoveUci: string
  bestMoveUci: string
  /** 引擎最佳著法的分數（輪走方視角） */
  bestScore: EngineScore
  /** 實際著法的分數（輪走方視角） */
  playedScore: EngineScore
}

/** 依厘子損失給出錯誤等級（半開區間） */
export function classifyLoss(centipawnLoss: number): MoveQuality {
  const { inaccuracy, mistake, blunder } = MOVE_QUALITY_THRESHOLDS
  if (centipawnLoss > blunder) return 'Blunder'
  if (centipawnLoss > mistake) return 'Mistake'
  if (centipawnLoss > inaccuracy) return 'Inaccuracy'
  return 'OK'
}

/**
 * 計算信心值 (0..1)。
 * - 以厘子損失與最近分級邊界 (50/150/300) 的距離為基礎。
 * - 距離越遠分類越明確，信心越高。
 * - 涉及 mate 的判定視為極明確 (≥0.95)。
 */
export function computeConfidence(centipawnLoss: number, isMateRelated: boolean): number {
  const boundaries = [
    MOVE_QUALITY_THRESHOLDS.inaccuracy,
    MOVE_QUALITY_THRESHOLDS.mistake,
    MOVE_QUALITY_THRESHOLDS.blunder
  ]
  const nearest = Math.min(...boundaries.map((b) => Math.abs(centipawnLoss - b)))
  // 0.55（恰在邊界）→ 1（離邊界 ≥ 67.5cp）
  let confidence = Math.min(1, 0.55 + nearest / 150)
  if (isMateRelated) confidence = Math.max(confidence, 0.95)
  return Math.round(confidence * 100) / 100
}

/** 比較著法，產生完整 MoveComparisonResult */
export function compareMove(input: MoveComparisonInput): MoveComparisonResult {
  const bestScoreCp = scoreToCentipawns(input.bestScore)
  const playedScoreCp = scoreToCentipawns(input.playedScore)

  // 最佳著法理論上不差於實際著法；負噪音夾為 0
  const centipawnLoss = Math.max(0, bestScoreCp - playedScoreCp)

  const isMateRelated =
    input.bestScore.kind === 'mate' || input.playedScore.kind === 'mate'

  const quality = classifyLoss(centipawnLoss)
  const confidence = computeConfidence(centipawnLoss, isMateRelated)

  return {
    playedMoveUci: input.playedMoveUci,
    bestMoveUci: input.bestMoveUci,
    bestScoreCp,
    playedScoreCp,
    centipawnLoss,
    quality,
    confidence,
    isMateRelated,
    playedScore: input.playedScore,
    bestScore: input.bestScore
  }
}
