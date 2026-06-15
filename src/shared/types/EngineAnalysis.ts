/**
 * 引擎分析型別 (Engine analysis types) — SDS v0.2 §2.6
 *
 * 本檔型別為全系統唯一真相來源（§2.6 開頭）：
 * MoveComparisonService、EngineOutputParser、PikafishAdapter、StorageService、
 * UI 與 IPC 都必須使用同一組型別。
 *
 * 重要規則：
 *  - 分數不得只存裸數字（§2.6.1）；EngineScore 保留語義、顯示文字與來源。
 *  - raw 可在 UI 與 PromptBuilder 中原樣顯示作為證據，但不得被
 *    MoveComparisonService、分級邏輯或棋理解釋使用（§2.6.1、§2.15.5）。
 *  - 不得讓 Infinity / -Infinity 進入 EngineScore（§2.14.1）。
 */

import type { PieceColor } from './BoardState'

/**
 * 引擎通訊協定（本專案擴充，SDS 之外）。
 *  - uci：Pikafish 等
 *  - ucci：象棋小蟲、象棋旋風、象棋名手、烏雲象棋等
 */
export type EngineProtocol = 'uci' | 'ucci'

/** mate 正規化基準（§2.14.3） */
export const MATE_SCORE = 30000

/** 分數來源（§2.6.1） */
export type ScoreSource = 'root_analysis' | 'candidate_move' | 'separate_engine_call'

/**
 * 引擎分數（§2.6.1）。
 * cp：一般局面 centipawn；mate：殺棋距離（負數 = 自己將被將死）。
 */
export type EngineScore =
  | {
      readonly type: 'cp'
      /** Pikafish 原始 centipawn */
      readonly cp: number
      /** 兵/卒單位 (cp / 100) */
      readonly value: number
      /** 給 MoveComparisonService 比較用 */
      readonly comparableValue: number
      /** 原始 UCI 字串；可供顯示與查核，禁止用於分級或棋理推導 */
      readonly raw: string
      /** UI 顯示文字，如 +1.20 */
      readonly displayText: string
      /** 是否經過視角反轉 */
      readonly wasInverted: boolean
      readonly source: ScoreSource
    }
  | {
      readonly type: 'mate'
      /** mate 距離；負數表示自己將被將死 */
      readonly mateIn: number
      readonly comparableValue: number
      readonly raw: string
      /** 如「殺 3」「被殺 2」「已被將死」「殺棋（終局）」 */
      readonly displayText: string
      /** mate 0 終局狀態 */
      readonly isTerminalMate: boolean
      readonly wasInverted: boolean
      readonly source: ScoreSource
    }

/** 候選著法（§2.6.2）。evaluation 由 score.comparableValue 派生。 */
export interface EngineCandidateMove {
  move: string
  displayMove?: string
  score: EngineScore | null
  /** = score === null ? null : score.comparableValue */
  evaluation: number | null
  depth: number | null
  principalVariation: string[]
  displayPrincipalVariation?: string[]
}

/** scoreAfterUserMove 的來源標示（§2.6.3） */
export type UserMoveEvaluationSource =
  | 'candidate_move'
  | 'separate_engine_call'
  | 'unavailable'

export interface EngineRawAnalysis {
  root: string[]
  userMove?: string[]
}

/**
 * 引擎分析結果（§2.6.3）。
 * 所有 evaluation 欄位皆為「原局面行棋方視角」（§2.15.8、附錄 A.3）。
 */
export interface EngineAnalysis {
  positionFen: string
  sideToMove: PieceColor
  userMove?: string
  displayUserMove?: string
  bestMove: string
  displayBestMove?: string
  scoreAfterUserMove: EngineScore | null
  scoreAfterBestMove: EngineScore | null
  /** 由 scoreAfterUserMove.comparableValue 派生（§2.14.5） */
  evaluationAfterUserMove: number | null
  /** 由 scoreAfterBestMove.comparableValue 派生（§2.14.5） */
  evaluationAfterBestMove: number | null
  userMoveEvaluationSource: UserMoveEvaluationSource
  /**
   * 使用者著法後的引擎主線。第一手固定是 userMove，後面接對手最佳回應。
   * 這是結構化資料，可供 UI 與 AI 解釋使用；不得由 rawAnalysis 反向解析。
   */
  userMovePrincipalVariation?: string[]
  displayUserMovePrincipalVariation?: string[]
  depth: number | null
  candidateMoves: EngineCandidateMove[]
  principalVariation: string[]
  displayPrincipalVariation?: string[]
  analysisTimeMs?: number
  /** 分析逾時或只取得部分資料時為 true */
  incomplete: boolean
  /** 不完整或降級原因，必須呈現給使用者 */
  warnings: string[]
  engineId?: string
  engineName: string
  /** 原始協定輸出只供使用者檢視與除錯，不參與評分或 AI prompt。 */
  rawAnalysis?: EngineRawAnalysis
}

/** 引擎分析參數（§2.16.3 analysisConfig；預設值見 Settings DEFAULT_APP_SETTINGS） */
export interface AnalysisConfig {
  rootAnalysisMovetimeMs: number
  userMoveEvalMovetimeMs: number
  multiPv: number
}
