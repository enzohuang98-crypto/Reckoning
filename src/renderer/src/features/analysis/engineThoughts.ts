import type { EngineAnalysisProgressPayload } from '@shared/types/ipc'

/** Live 分析表的一列引擎思考紀錄。 */
export interface EngineThoughtEntry {
  id: string
  phase: EngineAnalysisProgressPayload['phase']
  elapsedMs: number
  depth: number | null
  selDepth?: number | null
  nodes?: number | null
  nps?: number | null
  scoreDisplay: string | null
  scoreComparableValue?: number | null
  candidateRank?: number
  displayMove?: string
  displayPrincipalVariation: string[]
  engineName?: string
}

/** 比對兩筆思考紀錄是否相同；和上一筆相同（階段、深度、分數、主線都一樣）就不再多加一列。 */
export function thoughtSignature(entry: EngineThoughtEntry): string {
  return [
    entry.phase,
    entry.depth ?? 'none',
    entry.selDepth ?? 'none',
    entry.scoreDisplay ?? 'none',
    entry.scoreComparableValue ?? 'none',
    entry.candidateRank ?? 'unranked',
    entry.displayMove ?? 'none',
    entry.engineName ?? 'unknown',
    entry.displayPrincipalVariation.join('|')
  ].join('::')
}
