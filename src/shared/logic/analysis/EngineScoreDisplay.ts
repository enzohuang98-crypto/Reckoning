import type { EngineScore } from '../../types/EngineAnalysis'

export function formatCentipawnDisplay(cp: number): string {
  const rounded = Math.round(cp)
  if (rounded > 0) return `+${rounded} cp`
  return `${rounded} cp`
}

export function formatEngineScoreDisplay(score: EngineScore): string {
  return score.type === 'cp' ? formatCentipawnDisplay(score.cp) : score.displayText
}
