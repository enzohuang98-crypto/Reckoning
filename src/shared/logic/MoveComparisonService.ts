/**
 * 著法比較服務 (MoveComparisonService) — SDS v0.2 §2.13
 *
 * 比較使用者走法與引擎最佳走法的評估差距，轉換為錯誤等級與可信度。
 *
 * 規則重點：
 *  - 分級採半開區間 [a, b)，使用原始 scoreDifference，不得用 UI 四捨五入值（§2.13.3）。
 *  - scoreDifference < 0 不判為錯誤（§2.13.7）。
 *  - 任一 evaluation 為 null → scoreDifference = null，不得補 0（§2.13.2）。
 *  - null / NaN / Infinity → unknown（§2.13.5）。
 *  - confidence 依 §2.13.6 規則計算，不得自行猜測。
 *
 * 視角說明（規格內部矛盾的解讀，詳見 CLAUDE.md）：
 * §2.13.2 的 normalizeScore 假設輸入為「紅方視角」原始分數；但 §2.15.8 與
 * 附錄 A.3 規定 PikafishAdapter 輸出的所有 evaluation 欄位已統一為
 * 「原局面行棋方視角」。本系統採後者：compareMove 收到的 evaluation
 * 已是行棋方視角（高 = 對行棋方好），差值直接相減即可。
 * normalizeScore 仍依規格實作並匯出，供「紅方視角輸入」的呼叫端使用。
 */

import type { EngineAnalysis } from '../types/EngineAnalysis'
import type {
  ConfidenceLevel,
  MistakeLevel,
  MoveComparisonResult
} from '../types/MoveComparisonResult'
import type { PieceColor } from '../types/BoardState'

/**
 * 評估分數正規化（§2.13.2）：把「紅方視角」分數轉為「對目前行棋方有利」方向。
 * 只接受有效數字，不處理 null。
 */
export function normalizeScore(rawScore: number, sideToMove: PieceColor): number {
  return sideToMove === 'red' ? rawScore : -rawScore
}

/** 錯誤分級（§2.13.5 純函式；閾值不得修改） */
export function classifyMistakeLevel(scoreDifference: number | null): MistakeLevel {
  if (
    scoreDifference === null ||
    Number.isNaN(scoreDifference) ||
    !Number.isFinite(scoreDifference)
  ) {
    return 'unknown'
  }
  if (scoreDifference < 0.31) return 'acceptable_or_tiny_inaccuracy'
  if (scoreDifference < 0.81) return 'inaccuracy'
  if (scoreDifference < 1.51) return 'mistake'
  if (scoreDifference < 3.01) return 'serious_mistake'
  return 'major_blunder'
}

/** confidence 計算輸入（§2.13.6 所列七項 + 強制 low 條件所需欄位） */
export interface ConfidenceInput {
  depth: number | null
  /** 使用者設定的最低深度（movetime 模式下可不提供，該項不計） */
  minDepth?: number
  candidateMoveCount: number
  principalVariationLength: number
  evaluationAfterUserMove: number | null
  evaluationAfterBestMove: number | null
  scoreDifference: number | null
  engineBestMove: string
  /** 額外不確定原因（如二次分析失敗），會一併列入 reasons */
  extraReasons?: string[]
}

/** confidence 與不確定原因（§2.13.6） */
export function computeConfidence(input: ConfidenceInput): {
  confidence: ConfidenceLevel
  uncertaintyReasons: string[]
} {
  const reasons: string[] = []

  if (input.depth === null) reasons.push('引擎深度資料缺失')
  else if (input.minDepth !== undefined && input.depth < input.minDepth) {
    reasons.push(`引擎深度 ${input.depth} 低於設定的最低深度 ${input.minDepth}`)
  }
  if (input.candidateMoveCount < 2) reasons.push('候選著法少於 2 個')
  if (input.principalVariationLength === 0) reasons.push('主要變例 (PV) 為空')
  if (input.evaluationAfterUserMove === null) reasons.push('使用者著法評估缺失')
  if (input.evaluationAfterBestMove === null) reasons.push('最佳著法評估缺失')
  if (input.scoreDifference === null) reasons.push('評估差距無法計算')
  if (input.extraReasons) reasons.push(...input.extraReasons)

  // 強制 low（§2.13.6）：任一成立即直接 low
  const forcedLow =
    input.evaluationAfterUserMove === null ||
    input.evaluationAfterBestMove === null ||
    input.scoreDifference === null ||
    input.engineBestMove.length === 0 ||
    (input.principalVariationLength === 0 && input.candidateMoveCount < 2)

  let confidence: ConfidenceLevel
  if (forcedLow || reasons.length >= 2) confidence = 'low'
  else if (reasons.length === 1) confidence = 'medium'
  else confidence = 'high'

  return { confidence, uncertaintyReasons: reasons }
}

/** §2.15.7 二次分析失敗時的不確定原因（規格指定文字） */
export const SEPARATE_EVAL_FAILED_REASON =
  'User move was not included in MultiPV candidates, and separate user move evaluation failed.'

/**
 * 由 EngineAnalysis 建立完整 MoveComparisonResult。
 * 未提供 userMove 時回傳 unknown / low（result payload 仍需 moveComparison）。
 */
export function compareMove(
  analysis: EngineAnalysis,
  options?: { minDepth?: number }
): MoveComparisonResult {
  const userMove = analysis.userMove ?? ''
  const evalUser = analysis.evaluationAfterUserMove
  const evalBest = analysis.evaluationAfterBestMove

  // evaluation 已為原局面行棋方視角（§2.15.8），直接相減；
  // 任一為 null 時必須為 null（§2.13.2）
  const scoreDifference: number | null =
    evalBest === null || evalUser === null ? null : evalBest - evalUser

  const extraReasons: string[] = []
  if (!userMove) {
    extraReasons.push('未提供使用者著法')
  } else if (analysis.userMoveEvaluationSource === 'unavailable') {
    extraReasons.push(SEPARATE_EVAL_FAILED_REASON)
  }

  const { confidence, uncertaintyReasons } = computeConfidence({
    depth: analysis.depth,
    minDepth: options?.minDepth,
    candidateMoveCount: analysis.candidateMoves.length,
    principalVariationLength: analysis.principalVariation.length,
    evaluationAfterUserMove: evalUser,
    evaluationAfterBestMove: evalBest,
    scoreDifference,
    engineBestMove: analysis.bestMove,
    extraReasons
  })

  return {
    positionFen: analysis.positionFen,
    sideToMove: analysis.sideToMove,
    userMove,
    engineBestMove: analysis.bestMove,
    evaluationAfterUserMove: evalUser,
    evaluationAfterBestMove: evalBest,
    scoreDifference,
    mistakeLevel: userMove ? classifyMistakeLevel(scoreDifference) : 'unknown',
    depth: analysis.depth,
    confidence,
    uncertaintyReasons
  }
}
