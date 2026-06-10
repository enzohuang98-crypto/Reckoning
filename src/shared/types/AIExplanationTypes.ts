/**
 * AI 解釋請求/回應型別 (AI explanation request/response types)
 */

import type { PieceColor } from './BoardState'
import type { EngineAnalysis } from './EngineAnalysis'
import type { MoveComparisonResult } from './MoveComparisonResult'
import type { AIProviderId, TokenUsage } from './AIProviderTypes'

/** 解釋語言 */
export type ExplanationLanguage = 'zh-TW' | 'zh-CN' | 'en'

/**
 * AI 解釋請求。
 * engineAnalysis 為唯一事實來源；LLM 不得發明不在其中的戰術。
 */
export interface AIExplanationRequest {
  /** 局面 FEN */
  fen: string
  /** 輪走方 */
  sideToMove: PieceColor
  /** 結構化引擎資料（唯一事實來源） */
  engineAnalysis: EngineAnalysis
  /** 若是針對某一步的講評，附上比較結果 */
  comparison?: MoveComparisonResult
  /** 使用者實際走的著法 (UCI)，選用 */
  playedMoveUci?: string
  /** 解釋語言，預設 zh-TW */
  language?: ExplanationLanguage
  /** 指定 Provider */
  provider: AIProviderId
  /** 指定模型 */
  model: string
}

/** AI 解釋回應 */
export interface AIExplanationResponse {
  /** 解釋文字 */
  text: string
  /** 使用的 Provider */
  provider: AIProviderId
  /** 使用的模型 */
  model: string
  /** Token 用量（若 Provider 有回報） */
  usage?: TokenUsage
  /** 估算成本 (USD) */
  costUsd?: number
  /** 產生時間 (epoch ms) */
  createdAt: number
  /**
   * 護欄旗標：此解釋僅依據引擎結構化資料產生。
   * 永遠為 true，作為設計契約的明示標記。
   */
  groundedOnEngineData: true
}
