/**
 * 由引擎分析（與可選的著法比較）組出整張事實表：首選線／實戰線重播、評估、錯誤等級與差距、
 * 其他候選、兩線差異、關鍵著法檢查（引擎回答的「如果…」），以及殘局時的棋子清單。
 */

import type { BoardState, PieceColor, PieceType } from '../../../types/BoardState'
import type { EngineAnalysis, IdeaProbeLine, IdeaProbes } from '../../../types/EngineAnalysis'
import type { MoveComparisonResult } from '../../../types/MoveComparisonResult'
import { formatChineseMove } from '../../board/ChineseNotation'
import { parseFen } from '../../board/fen'
import { INVENTORY_ORDER, opponent } from './common'
import { buildLineFacts } from './lineFacts'
import { factScore } from './score'
import {
  MAX_FACT_DIFFERENCES,
  MAX_INVENTORY_PIECES,
  type ExplanationFacts,
  type FactDifference,
  type IdeaFact,
  type IdeaKind,
  type LineFacts,
  type MoveFact,
  type PlyFact
} from './types'

function boardInventory(board: BoardState): Record<PieceColor, PieceType[]> | undefined {
  const pieces: Record<PieceColor, PieceType[]> = { red: [], black: [] }
  for (const row of board.grid) for (const cell of row) if (cell) pieces[cell.color].push(cell.type)
  if (pieces.red.length + pieces.black.length > MAX_INVENTORY_PIECES) return undefined
  for (const side of ['red', 'black'] as const) {
    pieces[side].sort((left, right) => INVENTORY_ORDER.indexOf(left) - INVENTORY_ORDER.indexOf(right))
  }
  return pieces
}

function startsWith(line: readonly string[] | undefined, move: string): string[] {
  const moves = [...(line ?? [])]
  return moves[0] === move ? moves : [move, ...moves]
}

function firstCapture(line: LineFacts): PlyFact | undefined {
  return line.plies.find((ply) => ply.captured !== null)
}

function firstCheck(line: LineFacts): PlyFact | undefined {
  return line.plies.find((ply) => ply.givesCheck)
}

function sameCaptures(left: LineFacts, right: LineFacts): boolean {
  return (['red', 'black'] as const).every(
    (side) => left.captures[side].join(',') === right.captures[side].join(',')
  )
}

function buildDifferences(bestLine: LineFacts, userLine: LineFacts | undefined): FactDifference[] {
  if (!userLine) return []
  const differences: FactDifference[] = []
  const bestCapture = firstCapture(bestLine)
  const userCapture = firstCapture(userLine)
  if (!bestCapture && !userCapture) {
    differences.push({
      kind: 'no_captures',
      plies: Math.min(bestLine.plies.length, userLine.plies.length)
    })
  } else {
    const [line, capture, other] =
      bestCapture && (!userCapture || bestCapture.ply <= userCapture.ply)
        ? (['best', bestCapture, userCapture] as const)
        : (['user', userCapture!, bestCapture] as const)
    differences.push({
      kind: 'first_capture',
      line,
      ply: capture.ply,
      side: capture.side,
      piece: capture.piece,
      captured: capture.captured!,
      otherLineCaptureFirstAt: other?.ply ?? null
    })
  }
  const bestCheck = firstCheck(bestLine)
  const userCheck = firstCheck(userLine)
  if (bestCheck || userCheck) {
    const [line, check, other] =
      bestCheck && (!userCheck || bestCheck.ply <= userCheck.ply)
        ? (['best', bestCheck, userCheck] as const)
        : (['user', userCheck!, bestCheck] as const)
    differences.push({
      kind: 'first_check',
      line,
      ply: check.ply,
      side: check.side,
      otherLineCheckAt: other?.ply ?? null
    })
  }
  if (!sameCaptures(bestLine, userLine)) {
    differences.push({ kind: 'material', best: bestLine.captures, user: userLine.captures })
  }
  return differences.slice(0, MAX_FACT_DIFFERENCES)
}

/** 關鍵那一手：這條線裡「做事」的一方，從 fromPly 起第一個吃子、將軍或製造新威脅的著法。 */
function keyPlyOf(line: LineFacts, side: PieceColor, fromPly: number): number | null {
  const key = line.plies.find(
    (ply) =>
      ply.ply >= fromPly &&
      ply.side === side &&
      (ply.captured !== null || ply.givesCheck || ply.threats.length > 0)
  )
  return key?.ply ?? null
}

/**
 * 把引擎回答的「如果…」重播成事實，並標出關鍵的那一手。
 * 照樣應著的第 1、2 手是首選與對手照走的應著，關鍵從第 3 手（輪走方的回應）找起。
 */
function buildIdeas(analysis: EngineAnalysis, probes: IdeaProbes | undefined): IdeaFact[] {
  if (!probes) return []
  const side = analysis.sideToMove
  const ideas: IdeaFact[] = []
  const add = (kind: IdeaKind, probe: IdeaProbeLine | undefined, actor: PieceColor, fromPly: number): void => {
    if (!probe || probe.moves.length === 0) return
    if (
      kind === 'sameReply' &&
      (probe.startFen !== analysis.positionFen || probe.moves[0] !== analysis.bestMove)
    ) {
      return
    }
    const line = buildLineFacts(probe.startFen, probe.moves)
    const keyPly = keyPlyOf(line, actor, fromPly)
    if (keyPly === null) return
    const reply = kind === 'sameReply' ? line.plies[1]?.move : undefined
    ideas.push({ kind, side: actor, ...(reply ? { reply } : {}), line, keyPly })
  }
  add('opponentThreat', probes.opponentThreat, opponent(side), 1)
  add('sameReply', probes.sameReply, side, 3)
  add('bestThreat', probes.bestThreat, side, 1)
  return ideas
}

/** 由引擎分析（與可選的著法比較）建立事實表。 */
export function buildExplanationFacts(
  analysis: EngineAnalysis,
  comparison?: MoveComparisonResult | null,
  probes?: IdeaProbes
): ExplanationFacts {
  const startFen = analysis.positionFen
  const parsed = parseFen(startFen)
  const displayOf = (uci: string, fallback?: string): string =>
    (parsed.valid ? formatChineseMove(parsed.board, uci) : null) ?? fallback ?? uci
  const bestMove: MoveFact = {
    uci: analysis.bestMove,
    move: displayOf(analysis.bestMove, analysis.displayBestMove),
    ...(factScore(analysis.scoreAfterBestMove) ? { score: factScore(analysis.scoreAfterBestMove) } : {})
  }
  const bestLine = buildLineFacts(
    startFen,
    startsWith(analysis.principalVariation, analysis.bestMove)
  )
  const hasUserMove = Boolean(analysis.userMove)
  const userIsBest = hasUserMove && analysis.userMove === analysis.bestMove
  const userMove: MoveFact | undefined = analysis.userMove
    ? {
        uci: analysis.userMove,
        move: displayOf(analysis.userMove, analysis.displayUserMove),
        ...(factScore(analysis.scoreAfterUserMove) ? { score: factScore(analysis.scoreAfterUserMove) } : {})
      }
    : undefined
  const userLine =
    analysis.userMove && !userIsBest
      ? buildLineFacts(
          startFen,
          startsWith(analysis.userMovePrincipalVariation, analysis.userMove)
        )
      : undefined
  // 殺棋分數換算成「兵」沒有意義（例如殺 1 對殺 2 會被算成約 1 兵的差距），
  // 這時只呈現兩邊的評估文字（殺 N），不列錯誤等級與兵數。
  const involvesMate =
    analysis.scoreAfterBestMove?.type === 'mate' ||
    analysis.scoreAfterUserMove?.type === 'mate'
  const comparable =
    !involvesMate &&
    comparison &&
    comparison.positionFen === startFen &&
    comparison.userMove === analysis.userMove
  const gap = comparable ? comparison!.scoreDifference : null
  const ideas = buildIdeas(analysis, probes)
  return {
    positionFen: startFen,
    sideToMove: analysis.sideToMove,
    bestMove,
    ...(userMove ? { userMove } : {}),
    userIsBest,
    ...(comparable && comparison!.mistakeLevel !== 'unknown'
      ? { mistakeLevel: comparison!.mistakeLevel }
      : {}),
    ...(typeof gap === 'number' && Number.isFinite(gap)
      ? { scoreGapPawns: Math.round(gap * 100) / 100 }
      : {}),
    bestLine,
    ...(userLine ? { userLine } : {}),
    candidates: analysis.candidateMoves.slice(0, 3).map((candidate) => ({
      uci: candidate.move,
      move: displayOf(candidate.move, candidate.displayMove),
      ...(factScore(candidate.score) ? { score: factScore(candidate.score) } : {})
    })),
    differences: buildDifferences(bestLine, userLine),
    ...(ideas.length > 0 ? { ideas } : {}),
    ...(parsed.valid && boardInventory(parsed.board) ? { inventory: boardInventory(parsed.board) } : {})
  }
}
