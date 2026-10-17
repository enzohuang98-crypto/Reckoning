/** 引擎分數 → 事實表評估（FactScore）。只用 comparableValue 或殺棋 displayText，絕不使用 EngineScore.raw。 */

import type { EngineScore } from '../../../types/EngineAnalysis'
import type { FactScore } from './types'

export function factScore(score: EngineScore | null | undefined): FactScore | undefined {
  if (!score) return undefined
  if (score.type === 'mate') return { kind: 'mate', text: score.displayText }
  return Number.isFinite(score.comparableValue)
    ? { kind: 'pawns', value: Math.round(score.comparableValue * 100) / 100 }
    : undefined
}
