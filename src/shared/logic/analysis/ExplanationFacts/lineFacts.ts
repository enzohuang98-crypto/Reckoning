/**
 * 逐手重播一條引擎主線，算出每一手的事實：吃子、將軍、唯一合法著法、新威脅（有無保護、誰能吃回）、
 * 走法描述，以及線末是否將死／困斃、交換是否尚未結束。
 */

import type { BoardState, PieceColor, PieceType } from '../../../types/BoardState'
import { fileNumber, formatChineseMove } from '../../board/ChineseNotation'
import { parseFen } from '../../board/fen'
import {
  applyUciMove,
  formatUciMove,
  hasAnyLegalMove,
  isKingInCheck,
  isSquareAttackedBy,
  legalMoveCheck,
  parseUciMove
} from '../../board/moves'
import { opponent } from './common'
import {
  MAX_FACT_LINE_PLIES,
  MAX_FACT_THREATS,
  type LineFacts,
  type PlyDescriptor,
  type PlyFact,
  type ThreatFact
} from './types'

/**
 * 只用於排序「下一手可吃」的目標，不寫進事實表。採常見參考值：
 * 車 9、炮 4.5、馬 4、仕／相 2、兵 1（過河後約 2）——見 xiangqi.com〈The Value of the Pieces〉。
 */
const PIECE_VALUE: Record<PieceType, number> = {
  king: 100,
  rook: 9,
  cannon: 4.5,
  horse: 4,
  advisor: 2,
  elephant: 2,
  pawn: 1
}

function homeRow(color: PieceColor): number {
  return color === 'red' ? 9 : 0
}

function crossedRiver(color: PieceColor, row: number): boolean {
  return color === 'red' ? row <= 4 : row >= 5
}

interface LocatedThreat extends ThreatFact {
  square: string
  value: number
}

/** 這一手「新製造」的威脅：走前就能吃到的目標不重複列出，只留這步棋帶來的變化。 */
function newThreats(before: BoardState, after: BoardState, attacker: PieceColor): ThreatFact[] {
  const existing = new Set(
    capturableTargets(before.grid, attacker).map((threat) => `${threat.square}:${threat.piece}`)
  )
  return capturableTargets(after.grid, attacker)
    .filter((threat) => !existing.has(`${threat.square}:${threat.piece}`))
    .sort((left, right) => right.value - left.value)
    .slice(0, MAX_FACT_THREATS)
    .map(({ piece, side, file, protected: isProtected, recapturer }) => ({
      piece,
      side,
      file,
      protected: isProtected,
      ...(recapturer ? { recapturer } : {})
    }))
}

/**
 * 吃下 (row, col) 之後，守方哪個子能合法吃回：P3-9 live 中模型把「能吃回」歸功給錯的著法，
 * 寫出是誰吃回（例如「7路馬」），就能對回是哪一步讓它有保護。子力小的優先（較自然的吃回方式）。
 */
function recapturerOf(
  grid: BoardState['grid'],
  row: number,
  col: number,
  defender: PieceColor
): { piece: PieceType; file: number } | undefined {
  let best: { piece: PieceType; file: number; value: number } | undefined
  for (let fromRow = 0; fromRow < grid.length; fromRow++) {
    for (let fromCol = 0; fromCol < grid[fromRow].length; fromCol++) {
      const piece = grid[fromRow][fromCol]
      if (piece?.color !== defender) continue
      const move = formatUciMove({ fromRow, fromCol, toRow: row, toCol: col })
      if (!move || !legalMoveCheck(grid, defender, move).ok) continue
      const value = PIECE_VALUE[piece.type]
      if (!best || value < best.value) best = { piece: piece.type, file: fileNumber(defender, fromCol), value }
    }
  }
  return best ? { piece: best.piece, file: best.file } : undefined
}

/** 行棋方此刻可以合法吃到的敵子（不含將/帥）。 */
function capturableTargets(grid: BoardState['grid'], attacker: PieceColor): LocatedThreat[] {
  const defender = opponent(attacker)
  const found: LocatedThreat[] = []
  for (let row = 0; row < grid.length; row++) {
    for (let col = 0; col < grid[row].length; col++) {
      const target = grid[row][col]
      if (!target || target.color !== defender || target.type === 'king') continue
      let attackerMove: string | null = null
      for (let fromRow = 0; fromRow < grid.length && !attackerMove; fromRow++) {
        for (let fromCol = 0; fromCol < grid[fromRow].length; fromCol++) {
          if (grid[fromRow][fromCol]?.color !== attacker) continue
          const move = formatUciMove({ fromRow, fromCol, toRow: row, toCol: col })
          if (move && legalMoveCheck(grid, attacker, move).ok) {
            attackerMove = move
            break
          }
        }
      }
      if (!attackerMove) continue
      const coords = parseUciMove(attackerMove)!
      const afterCapture = grid.map((cells) => cells.slice())
      afterCapture[row][col] = afterCapture[coords.fromRow][coords.fromCol]
      afterCapture[coords.fromRow][coords.fromCol] = null
      found.push({
        piece: target.type,
        side: defender,
        file: fileNumber(defender, col),
        protected: isSquareAttackedBy(afterCapture, row, col, defender, true),
        ...(recapturerOf(afterCapture, row, col, defender) ? { recapturer: recapturerOf(afterCapture, row, col, defender)! } : {}),
        square: `${row},${col}`,
        value: PIECE_VALUE[target.type]
      })
    }
  }
  return found
}

function describePly(
  uci: string,
  piece: PieceType,
  side: PieceColor
): PlyDescriptor[] {
  const coords = parseUciMove(uci)!
  const descriptors: PlyDescriptor[] = []
  if (
    coords.toCol === 4 &&
    coords.fromCol !== 4 &&
    (piece === 'cannon' || piece === 'rook' || piece === 'horse' || piece === 'pawn')
  ) {
    descriptors.push('enters_center')
  }
  if (piece === 'rook' && coords.fromRow === homeRow(side) && coords.toRow !== coords.fromRow) {
    descriptors.push('rook_develops')
  }
  if (piece === 'horse' && coords.fromRow === homeRow(side)) descriptors.push('horse_develops')
  if (
    piece === 'pawn' &&
    !crossedRiver(side, coords.fromRow) &&
    crossedRiver(side, coords.toRow)
  ) {
    descriptors.push('pawn_crosses_river')
  }
  if (piece === 'king') descriptors.push('king_moves')
  return descriptors
}

/** 行棋方的合法著法數，數到 limit 就停（只需要知道是不是唯一）。 */
function countLegalMoves(grid: BoardState['grid'], color: PieceColor, limit = 2): number {
  let count = 0
  for (let fromRow = 0; fromRow < grid.length; fromRow++) {
    for (let fromCol = 0; fromCol < grid[fromRow].length; fromCol++) {
      if (grid[fromRow][fromCol]?.color !== color) continue
      for (let toRow = 0; toRow < grid.length; toRow++) {
        for (let toCol = 0; toCol < grid[toRow].length; toCol++) {
          const move = formatUciMove({ fromRow, fromCol, toRow, toCol })
          if (move && legalMoveCheck(grid, color, move).ok && ++count >= limit) return count
        }
      }
    }
  }
  return count
}

/** 逐手重播一條主線，最多 MAX_FACT_LINE_PLIES 手；遇到無法重播的著法就停並附說明。 */
export function buildLineFacts(
  startFen: string,
  moves: readonly string[],
  maxPlies = MAX_FACT_LINE_PLIES
): LineFacts {
  const parsed = parseFen(startFen)
  const captures: Record<PieceColor, PieceType[]> = { red: [], black: [] }
  if (!parsed.valid) {
    return { plies: [], endsWith: null, captures, warning: '局面無法解析，無法重播主線。' }
  }
  let board = parsed.board
  const plies: PlyFact[] = []
  let warning: string | undefined
  for (const uci of moves.slice(0, maxPlies)) {
    const coords = parseUciMove(uci)
    const moving = coords ? board.grid[coords.fromRow][coords.fromCol] : null
    const display = formatChineseMove(board, uci)
    const applied = applyUciMove(board, uci)
    if (!coords || !moving || !display || !applied.valid) {
      warning = `主線第 ${plies.length + 1} 手無法在棋盤上重播，之後的著法已省略。`
      break
    }
    const side = board.sideToMove
    const next = applied.board
    if (applied.captured) captures[side].push(applied.captured.type)
    plies.push({
      ply: plies.length + 1,
      side,
      uci,
      move: display,
      piece: moving.type,
      captured: applied.captured?.type ?? null,
      capturedFile: applied.captured ? fileNumber(applied.captured.color, coords.toCol) : null,
      givesCheck: isKingInCheck(next.grid, opponent(side)),
      onlyLegalMove: countLegalMoves(board.grid, side) === 1,
      threats: newThreats(board, next, side),
      descriptors: describePly(uci, moving.type, side)
    })
    board = next
  }
  let endsWith: LineFacts['endsWith'] = null
  if (plies.length > 0 && !warning && !hasAnyLegalMove(board.grid, board.sideToMove)) {
    endsWith = isKingInCheck(board.grid, board.sideToMove) ? 'checkmate' : 'stalemate'
  }
  // 主線被截在交換中途時要說清楚，否則「紅方多吃 3 子」會被讀成最後結果（P3-9 holdout：其實黑方之後會吃回）。
  const next = !warning ? moves[plies.length] : undefined
  const nextApplied = next !== undefined ? applyUciMove(board, next) : null
  const capturesContinue = Boolean(nextApplied?.valid && nextApplied.captured)
  return {
    plies,
    endsWith,
    captures,
    ...(warning ? { warning } : {}),
    ...(capturesContinue ? { capturesContinue } : {})
  }
}
