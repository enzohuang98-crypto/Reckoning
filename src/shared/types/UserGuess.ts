/**
 * 猜著模式型別 (Guess mode types)
 *
 * 使用者先猜一手，再與引擎最佳著法比較，作為訓練。
 */

import type { MoveQuality } from './MoveComparisonResult'

/** 一次猜著紀錄 */
export interface UserGuess {
  /** 唯一識別碼 */
  id: string
  /** 局面 FEN */
  fen: string
  /** 使用者猜的著法 (UCI) */
  guessMoveUci: string
  /** 引擎最佳著法 (UCI) */
  bestMoveUci: string
  /** 是否與最佳著法完全相同 */
  isCorrect: boolean
  /** 與最佳著法的厘子損失 */
  centipawnLoss: number
  /** 對應錯誤等級 */
  quality: MoveQuality
  /** 建立時間 (epoch ms) */
  createdAt: number
}

/** 猜著模式統計（用於成績面板） */
export interface GuessModeStats {
  totalGuesses: number
  correctGuesses: number
  /** 平均厘子損失 */
  averageCentipawnLoss: number
}
