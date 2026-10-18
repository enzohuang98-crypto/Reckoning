/**
 * 關鍵著法檢查的規劃（純函式）：決定解說前要另外問引擎哪幾個「如果…」，以及怎麼把引擎回傳的
 * 續著截成合法、夠短的假設線。實際送引擎的是 main 的 PikafishAdapter.probeIdeas。
 *
 * 引擎主線假設雙方都下最好的棋，所以「對手想做什麼」「對手照樣走會怎樣」「這步威脅什麼」
 * 這些棋手講棋時最常用的理由，主線上都看不到；這裡把它們變成三個固定的問題，每盤都問。
 */

import type { BoardState, PieceColor } from '../../types/BoardState'
import type { IdeaProbes } from '../../types/EngineAnalysis'
import { parseFen, serializeFen } from '../board/fen'
import { applyUciMove, isKingInCheck } from '../board/moves'

export type IdeaProbeKind = keyof IdeaProbes

/** 每條假設線最多保留幾手：夠看到關鍵的那一手與對方的回應，又不會把事實表撐太長。 */
export const IDEA_PROBE_MAX_PLIES: Record<IdeaProbeKind, number> = {
  opponentThreat: 3,
  sameReply: 5,
  bestThreat: 3
}

export interface PlannedIdeaProbe {
  kind: IdeaProbeKind
  /** 送引擎的起始局面。 */
  startFen: string
  /** 起始局面之後先走的著法（照樣應著是「首選＋對手的應著」，其他為空）。 */
  prefix: string[]
}

function opponentOf(side: PieceColor): PieceColor {
  return side === 'red' ? 'black' : 'red'
}

/**
 * 「這手先不走」：同一個盤面改由對手走。輪走方正被將軍時不能跳過（對手會直接吃將），回傳 null。
 */
export function nullMoveFen(board: BoardState): string | null {
  if (isKingInCheck(board.grid, board.sideToMove)) return null
  return serializeFen(board.grid, opponentOf(board.sideToMove))
}

/** 從起始局面依序套用著法，遇到第一個不合法（或無法解析）的著法就停，只留合法的前段。 */
export function legalPrefix(startFen: string, moves: readonly string[]): string[] {
  const parsed = parseFen(startFen)
  if (!parsed.valid) return []
  let board = parsed.board
  const kept: string[] = []
  for (const move of moves) {
    const applied = applyUciMove(board, move)
    if (!applied.valid) break
    kept.push(move)
    board = applied.board
  }
  return kept
}

/**
 * 依目前局面、引擎首選與（可選的）棋手著法線，列出要問引擎的假設情況。
 * - 對手的威脅：輪走方沒有被將軍時才問。
 * - 照樣應著：棋手線上有對手的應著、首選線的應著不同，而且這個應著在首選之後仍合法時才問。
 * - 首選的威脅：首選沒有將軍時才問（被將軍的一方不能「不理會」）。
 */
export function planIdeaProbes(input: {
  positionFen: string
  bestMove: string
  bestLine?: readonly string[]
  userLine?: readonly string[]
}): PlannedIdeaProbe[] {
  const parsed = parseFen(input.positionFen)
  if (!parsed.valid) return []
  const board = parsed.board
  const planned: PlannedIdeaProbe[] = []

  const threatFen = nullMoveFen(board)
  if (threatFen) planned.push({ kind: 'opponentThreat', startFen: threatFen, prefix: [] })

  const afterBest = applyUciMove(board, input.bestMove)
  if (!afterBest.valid) return planned

  const userMove = input.userLine?.[0]
  const reply = input.userLine?.[1]
  const bestReply = input.bestLine?.[0] === input.bestMove ? input.bestLine?.[1] : undefined
  if (
    userMove &&
    reply &&
    userMove !== input.bestMove &&
    reply !== bestReply &&
    legalPrefix(input.positionFen, [input.bestMove, reply]).length === 2
  ) {
    planned.push({
      kind: 'sameReply',
      startFen: board.fen,
      prefix: [input.bestMove, reply]
    })
  }

  const bestThreatFen = nullMoveFen(afterBest.board)
  if (bestThreatFen) planned.push({ kind: 'bestThreat', startFen: bestThreatFen, prefix: [] })

  return planned
}

/**
 * 把引擎回傳的續著接在前段後面，只留合法且不超過上限的部分。
 * 引擎沒有接出任何一手（只剩前段）時回傳 null：這個「如果」沒有可說的內容。
 */
export function completeIdeaProbe(
  probe: PlannedIdeaProbe,
  engineLine: readonly string[]
): { startFen: string; moves: string[] } | null {
  const moves = legalPrefix(probe.startFen, [...probe.prefix, ...engineLine]).slice(
    0,
    IDEA_PROBE_MAX_PLIES[probe.kind]
  )
  return moves.length > probe.prefix.length ? { startFen: probe.startFen, moves } : null
}
