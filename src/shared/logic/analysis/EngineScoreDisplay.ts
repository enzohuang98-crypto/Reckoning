import type { EngineScore } from '../../types/EngineAnalysis'

export function formatCentipawnDisplay(cp: number): string {
  return String(Math.round(cp))
}

export function formatEngineScoreDisplay(score: EngineScore): string {
  return score.type === 'cp' ? formatCentipawnDisplay(score.cp) : score.displayText
}
