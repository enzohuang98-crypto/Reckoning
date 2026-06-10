/**
 * 引擎分析型別 (Engine analysis types)
 *
 * Pikafish 為「本機 UCI 象棋引擎」，負責所有棋力判斷。
 * 這些型別描述引擎輸出的結構化資料；LLM 僅能根據這些資料解釋，
 * 不得自行發明不在引擎資料中的戰術。
 */

import type { PieceColor } from './BoardState'

/**
 * 引擎通訊協定。
 *  - uci：Pikafish 等（setoption name X value Y / go movetime）
 *  - ucci：象棋小蟲、象棋旋風、象棋名手、烏雲象棋等
 *    （setoption 無 name/value 關鍵字、go time、score 為裸數值）
 */
export type EngineProtocol = 'uci' | 'ucci'

/**
 * 引擎分數。UCI 引擎回報兩種分數：
 *  - cp：以「輪走方視角」計算的厘子分 (centipawn)
 *  - mate：N 步內將死（正值＝輪走方可將死，負值＝輪走方將被將死）
 */
export type EngineScore =
  | { readonly kind: 'cp'; readonly value: number }
  | { readonly kind: 'mate'; readonly value: number }

/**
 * 將 mate 分數視為極大值時使用的基準（厘子）。
 * 用於 MoveComparisonService 的差值比較，避免 mate 與 cp 混算。
 */
export const MATE_SCORE_VALUE = 100000

/**
 * 將 EngineScore 正規化為厘子數值（mate 視為極大值）。
 * mate in N 的絕對值越小代表越快將死，給予越高的分數。
 */
export function scoreToCentipawns(
  score: EngineScore,
  mateBase: number = MATE_SCORE_VALUE
): number {
  if (score.kind === 'cp') return score.value
  // mate：步數越少分數越高；保留正負號代表是我方或對方將死
  const magnitude = mateBase - Math.min(Math.abs(score.value), mateBase - 1)
  return score.value >= 0 ? magnitude : -magnitude
}

/**
 * 分數視角翻轉（輪走方 ↔ 對手）。
 * 評估「走完某著法後」的局面時，引擎回報的是對手視角，需取負還原為走子方視角。
 */
export function negateScore(score: EngineScore): EngineScore {
  return score.kind === 'cp'
    ? { kind: 'cp', value: -score.value }
    : { kind: 'mate', value: -score.value }
}

/** 可讀化引擎分數（給 UI / prompt 用） */
export function formatScore(score: EngineScore): string {
  if (score.kind === 'mate') {
    return score.value >= 0 ? `將死 (M${score.value})` : `被將死 (M${Math.abs(score.value)})`
  }
  const pawns = (score.value / 100).toFixed(2)
  return score.value > 0 ? `+${pawns}` : pawns
}

/** 單一候選著法線 (UCI multipv 一行) */
export interface EngineLine {
  /** multipv 序號，1 為最佳 */
  multipv: number
  /** 搜尋深度 */
  depth: number
  /** 選擇性搜尋深度 (seldepth) */
  selDepth?: number
  /** 此線分數（輪走方視角） */
  score: EngineScore
  /** 搜尋節點數 */
  nodes?: number
  /** 每秒節點數 */
  nps?: number
  /** 思考時間 (ms) */
  timeMs?: number
  /** 主要變例 (principal variation)，UCI 著法陣列，如 ['h2e2','h9g7'] */
  pv: string[]
  /** 此線的第一步（= pv[0]） */
  bestMoveUci: string
}

/** 一次完整的引擎分析結果 */
export interface EngineAnalysis {
  /** 被分析的局面 FEN */
  fen: string
  /** 輪走方 */
  sideToMove: PieceColor
  /** 最終達到的搜尋深度 */
  depth: number
  /** 引擎建議的最佳著法 (UCI) */
  bestMoveUci: string
  /** 最佳線 */
  bestLine: EngineLine
  /** 所有候選線，依強到弱排序 (multipv) */
  lines: EngineLine[]
  /** 最佳線分數（輪走方視角） */
  score: EngineScore
  /** 引擎名稱，例如 'Pikafish' */
  engineName: string
  /** 完成時間 (epoch ms) */
  computedAt: number
}

/** 引擎分析請求參數 */
export interface EngineAnalysisRequest {
  fen: string
  /** 目標搜尋深度（與 movetimeMs 擇一） */
  depth?: number
  /** 目標思考時間 (ms) */
  movetimeMs?: number
  /** multipv 數量（要幾條候選線） */
  multiPv?: number
  /**
   * 在 fen 之後先走的著法（UCI），分析的是走完這些著法後的局面。
   * 對應引擎指令 position fen <fen> moves <m1> <m2> ...（UCI/UCCI 皆支援）。
   * 注意：此時引擎回報的分數視角是「走完後的輪走方」。
   */
  movesUci?: string[]
}

/** 單一著法評估請求（猜著模式精確 loss 用） */
export interface EvaluateMoveRequest {
  /** 原局面 FEN */
  fen: string
  /** 要評估的著法 (UCI)，必須是原局面輪走方的著法 */
  moveUci: string
  /** 目標搜尋深度（與 movetimeMs 擇一）；建議與原分析相同以利公平比較 */
  depth?: number
  /** 目標思考時間 (ms) */
  movetimeMs?: number
}

/** 單一著法評估結果 */
export interface MoveEvaluation {
  /** 原局面 FEN */
  fen: string
  /** 被評估的著法 (UCI) */
  moveUci: string
  /** 走完該著法後的局面分數，已換算回「原局面輪走方」視角 */
  score: EngineScore
  /** 走完該著法即無合法著法（將死或困斃對手）時為 true，score 以 mate 表示 */
  terminatesGame: boolean
  /** 實際達到的搜尋深度（terminatesGame 時為 0） */
  depth: number
  /** 引擎名稱 */
  engineName: string
}
