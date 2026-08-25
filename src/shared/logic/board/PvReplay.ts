import type { BoardState } from '../../types/BoardState'
import { applyUciMove } from './moves'

export interface PvReplayStep {
  uci: string
  display: string
}

export interface PvReplay {
  boards: BoardState[]
  steps: PvReplayStep[]
  warning: string | null
}

export function buildPvReplay(
  initialBoard: BoardState,
  principalVariation: readonly string[],
  displayPrincipalVariation: readonly string[] = []
): PvReplay {
  const boards = [initialBoard]
  const steps: PvReplayStep[] = []
  let current = initialBoard

  for (let index = 0; index < principalVariation.length; index++) {
    const uci = principalVariation[index]
    const result = applyUciMove(current, uci)
    if (!result.valid) {
      return {
        boards,
        steps,
        warning: `引擎主線第 ${index + 1} 手无法播放：${result.message}`
      }
    }
    current = result.board
    boards.push(current)
    steps.push({ uci, display: displayPrincipalVariation[index] ?? uci })
  }

  return { boards, steps, warning: null }
}
