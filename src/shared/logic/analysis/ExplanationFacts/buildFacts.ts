/**
 * 由引擎分析（與可選的著法比較）組出整張事實表：首選線／實戰線重播、評估、錯誤等級與差距、
 * 其他候選、兩線差異，以及殘局時的棋子清單。
 */

import type { BoardState, PieceColor, PieceType } from '../../../types/BoardState'
import type { EngineAnalysis } from '../../../types/EngineAnalysis'
import type { MoveComparisonResult } from '../../../types/MoveComparisonResult'
import { formatChineseMove } from '../../board/ChineseNotation'
import { parseFen } from '../../board/fen'
import { INVENTORY_ORDER } from './common'
import { buildLineFacts } from './lineFacts'
import { factScore } from './score'
import {
  MAX_FACT_DIFFERENCES,
  MAX_INVENTORY_PIECES,
  type ExplanationFacts,
  type FactDifference,
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

/** 由引擎分析（與可選的著法比較）建立事實表。 */
export function buildExplanationFacts(
  analysis: EngineAnalysis,
  comparison?: MoveComparisonResult | null
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
    ...(parsed.valid && boardInventory(parsed.board) ? { inventory: boardInventory(parsed.board) } : {})
  }
}
