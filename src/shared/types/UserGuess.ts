/**
 * 猜著模式型別 (Guess mode types) — SDS v0.2 §2.2.4 步驟 2
 *
 * 使用者先猜一手（看答案前），再與引擎最佳著法比較，作為訓練。
 */

import type { MistakeLevel } from './MoveComparisonResult'

/**
 * 送給 AI 教練的一次請求：棋手的著法（棋盤上選的或棋譜點的）、想法與問題。
 * 名稱沿用猜著時代的 SubmittedGuess，以免動到資料格式。
 */
export interface SubmittedGuess {
  submissionId: string
  move: string
  reason?: string
  /** 隨這次請求一起問的問題；沒有就做一般解說。 */
  question?: string
  /** 著法來自匯入棋譜的實戰步（不寫入猜著紀錄）。 */
  fromGame?: boolean
  submittedAt: number
}

/** 一次猜著紀錄 */
export interface UserGuess {
  /** 唯一識別碼 */
  id: string
  /** 局面 FEN */
  fen: string
  /** 使用者猜的著法 (UCI) */
  guessMoveUci: string
  /** 猜測理由（看答案前輸入，選填） */
  reason?: string
  /** 引擎最佳著法 (UCI) */
  bestMoveUci: string
  /** 是否與最佳著法完全相同 */
  isCorrect: boolean
  /** 評估差距（兵/卒單位；無法計算為 null） */
  scoreDifference: number | null
  /** 對應錯誤等級 */
  mistakeLevel: MistakeLevel
  /** 建立時間 (epoch ms) */
  createdAt: number
}
