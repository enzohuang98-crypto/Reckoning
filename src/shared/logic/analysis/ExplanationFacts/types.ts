/** 事實表的資料形狀與上限常數（純型別＋常數，不含邏輯）。 */

import type { PieceColor, PieceType } from '../../../types/BoardState'
import type { MistakeLevel } from '../../../types/MoveComparisonResult'

export const MAX_FACT_LINE_PLIES = 10
export const MAX_FACT_THREATS = 3
export const MAX_FACT_DIFFERENCES = 3
export const MAX_FACTS_PROMPT_CHARS = 1_500
/** 盤面子數不超過這個數時（殘局），事實表列出全部棋子，避免模型自己想像盤面上還有哪些子。 */
export const MAX_INVENTORY_PIECES = 12

export type PlyDescriptor =
  | 'enters_center'
  | 'rook_develops'
  | 'horse_develops'
  | 'pawn_crosses_river'
  | 'king_moves'

export interface ThreatFact {
  piece: PieceType
  side: PieceColor
  /** 目標所在的路（該方自己右手邊起算 1–9）。 */
  file: number
  /** 假設被吃下後，對方能否在同一格吃回（將/帥一步可及也算；即象棋所說的「有根」）。 */
  protected: boolean
  /** 能合法吃回的子（同一格；依子力由小到大挑一個）及其所在的路。 */
  recapturer?: { piece: PieceType; file: number }
}

export interface PlyFact {
  ply: number
  side: PieceColor
  uci: string
  move: string
  piece: PieceType
  captured: PieceType | null
  /** 被吃的子所在的路（被吃方自己右手邊起算 1–9）。 */
  capturedFile: number | null
  givesCheck: boolean
  /** 走這一手時，行棋方沒有其他合法著法（例如被將軍時只有一種應將方式）。 */
  onlyLegalMove: boolean
  threats: ThreatFact[]
  /** 這一手新製造的可吃目標（走前已存在的不重複列出），依子力價值排序，最多 3 個。 */
  descriptors: PlyDescriptor[]
}

export interface LineFacts {
  plies: PlyFact[]
  /** 線末輪走方沒有合法著法時：被將軍為將死，否則為困斃（象棋中困斃同樣判負，與西洋棋逼和不同）。 */
  endsWith: 'checkmate' | 'stalemate' | null
  /** 這條線中各方吃掉的子（依順序）。 */
  captures: Record<PieceColor, PieceType[]>
  /** 主線無法重播時的說明（之後的著法已省略）。 */
  warning?: string
  /** 列出的手數之後，主線下一手還是吃子（交換還沒結束）。 */
  capturesContinue?: boolean
}

/**
 * 給模型看的評估：一般分數換成「兵」（comparableValue，原局面行棋方視角），殺棋保留「殺 N」文字。
 * P3-9 live 中模型把原始 centipawn「42」「2000」讀成很大的差距，所以不再直接給 displayText。
 */
export type FactScore = { kind: 'pawns'; value: number } | { kind: 'mate'; text: string }

export interface MoveFact {
  uci: string
  move: string
  score?: FactScore
}

export type FactDifference =
  | { kind: 'no_captures'; plies: number }
  | {
      kind: 'first_capture'
      line: 'best' | 'user'
      ply: number
      side: PieceColor
      piece: PieceType
      captured: PieceType
      otherLineCaptureFirstAt: number | null
    }
  | { kind: 'first_check'; line: 'best' | 'user'; ply: number; side: PieceColor; otherLineCheckAt: number | null }
  | {
      kind: 'material'
      best: Record<PieceColor, PieceType[]>
      user: Record<PieceColor, PieceType[]>
    }

export interface ExplanationFacts {
  positionFen: string
  sideToMove: PieceColor
  bestMove: MoveFact
  userMove?: MoveFact
  /** 棋手的著法就是引擎首選。 */
  userIsBest: boolean
  mistakeLevel?: MistakeLevel
  /** 差距（兵）；只描述大小，不當理由。 */
  scoreGapPawns?: number
  bestLine: LineFacts
  userLine?: LineFacts
  candidates: MoveFact[]
  differences: FactDifference[]
  /** 殘局時目前盤面上的全部棋子（依子種排序）；子多時不列。 */
  inventory?: Record<PieceColor, PieceType[]>
}
