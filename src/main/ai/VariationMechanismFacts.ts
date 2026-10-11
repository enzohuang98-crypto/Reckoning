import { formatChineseMove } from '@shared/logic/board/ChineseNotation'
import { parseFen } from '@shared/logic/board/fen'
import { applyUciMove, formatUciMove, legalMoveCheck, parseUciMove } from '@shared/logic/board/moves'
import type { BoardState, Piece, PieceColor, PieceType } from '@shared/types/BoardState'
import type { HarnessEvidence } from '@shared/types/Harness'
import { MAX_PV_MOVES } from '../engine/EngineOutputParser'

const MAX_FUTURE_OWN_PLIES = 4
const MAX_LEGALITY_CHANGES_PER_STEP = 2
const MAX_CAPTURE_CHANGES_PER_KIND = 8

export type OwnerRelativeWing = 'left' | 'center' | 'right'

export interface MechanismCaptureTarget {
  square: string
  side: PieceColor
  piece: PieceType
}

export interface FutureMoveLegalityChange {
  /** One-based ply and notation in this same legally replayed PV. */
  futurePly: number
  move: string
  side: PieceColor
  piece: PieceType
  fromSquare: string
  toSquare: string
  /** Hypothetical same-side turn on each fixed board, not an extra played ply. */
  beforeLegal: boolean
  afterLegal: boolean
  /** Existing legal-move checker diagnostic; never a strategic or unique-cause verdict. */
  beforeConstraint: string | null
  afterConstraint: string | null
}

export interface VariationMechanismStep {
  ply: number
  move: string
  side: PieceColor
  piece: PieceType
  fromSquare: string
  toSquare: string
  fromFile: number
  toFile: number
  fromWing: OwnerRelativeWing
  toWing: OwnerRelativeWing
  /** The actual capture by this PV move; distinct from possible later captures. */
  actualCapture: MechanismCaptureTarget | null
  captureOpportunities: {
    added: MechanismCaptureTarget[]
    removed: MechanismCaptureTarget[]
    omittedAdded: number
    omittedRemoved: number
  }
  futureMoveLegalityChanges: FutureMoveLegalityChange[]
  coverage: {
    futureOwnPliesConsidered: number[]
    futurePliesChecked: number[]
    /** Remaining own PV plies in the verified prefix, beyond the lookahead. */
    omittedFutureOwnPlies: number
    omittedLegalityChanges: number
  }
}

export interface VariationMechanismFacts {
  evidenceId: string
  scope: {
    sourcePlies: number
    replayedPlies: number
    maxSourcePlies: number
    maxFutureOwnPlies: number
    maxLegalityChangesPerStep: number
    maxCaptureChangesPerKind: number
    wingPerspective: 'piece_owner'
    captureOpportunityMeaning: 'fixed_board_same_side_to_move'
    futureMoveMeaning: 'first_future_move_of_other_unmoved_piece_on_fixed_boards'
    coverageNotice: string
  }
  steps: VariationMechanismStep[]
  /** Replay failure or source-PV cap. Per-step limits are reported in coverage. */
  warning: string | null
  /** Some source plies, future candidates, or computed records were omitted. */
  truncated: boolean
}

interface ReplayFrame {
  before: BoardState
  after: BoardState
  uci: string
  move: string
  moving: Piece
  captured: Piece | null
}

function ownerFile(square: string, side: PieceColor): number {
  const column = square.charCodeAt(0) - 97
  return side === 'red' ? 9 - column : column + 1
}

function ownerWing(file: number): OwnerRelativeWing {
  return file < 5 ? 'right' : file === 5 ? 'center' : 'left'
}

/** Check only enemy-occupied destinations for the one moved piece, not all moves of all pieces. */
function captureTargets(board: BoardState, moving: Piece, fromSquare: string): MechanismCaptureTarget[] {
  const targets: MechanismCaptureTarget[] = []
  for (const [row, cells] of board.grid.entries()) {
    for (const [col, target] of cells.entries()) {
      if (!target || target.color === moving.color || target.type === 'king') continue
      const uci = formatUciMove({
        fromRow: 9 - Number(fromSquare[1]), fromCol: fromSquare.charCodeAt(0) - 97,
        toRow: row, toCol: col
      })
      if (uci && legalMoveCheck(board.grid, moving.color, uci).ok) {
        targets.push({ square: uci.slice(2), side: target.color, piece: target.type })
      }
    }
  }
  return targets
}

/**
 * Computed differences within one PV, never a strategic verdict or a natural-
 * language truth checker. Absence means this bounded observation found nothing;
 * it does not establish that a move has no purpose, pressure or long-term effect.
 */
export function buildVariationMechanismFacts(evidence: HarnessEvidence): VariationMechanismFacts {
  const isUserLine = evidence.move !== undefined && evidence.move === evidence.analysis.userMove
  const moves = isUserLine ? evidence.analysis.userMovePrincipalVariation ?? [] : evidence.analysis.principalVariation
  const frames: ReplayFrame[] = []
  const parsed = parseFen(evidence.positionFen)
  let warning: string | null = null
  if (!parsed.valid) {
    warning = '證據起始局面無效，不能計算機制前提。'
  } else {
    let board = parsed.board
    for (const [index, uci] of moves.slice(0, MAX_PV_MOVES).entries()) {
      const coordinates = parseUciMove(uci)
      const move = formatChineseMove(board, uci)
      const applied = applyUciMove(board, uci)
      if (!coordinates || !move || !applied.valid) {
        warning = `第 ${index + 1} 手未通過合法性檢查，其後不提供機制前提。`
        break
      }
      if (evidence.displayPrincipalVariation[index] !== move) {
        warning = `第 ${index + 1} 手中文記譜與本變例棋盤不一致，其後不提供機制前提。`
        break
      }
      frames.push({ before: board, after: applied.board, uci, move,
        moving: board.grid[coordinates.fromRow][coordinates.fromCol]!, captured: applied.captured })
      board = applied.board
    }
    if (warning === null) {
      warning = moves.length === 0 ? '沒有 UCI 主線，不能計算機制前提。'
        : moves.length > MAX_PV_MOVES ? `主線超過引擎解析上限 ${MAX_PV_MOVES} 手，其後不提供機制前提。` : null
    }
  }

  const steps = frames.map((frame, index): VariationMechanismStep => {
    const fromSquare = frame.uci.slice(0, 2)
    const toSquare = frame.uci.slice(2)
    const fromFile = ownerFile(fromSquare, frame.moving.color)
    const toFile = ownerFile(toSquare, frame.moving.color)
    const beforeTargets = captureTargets(frame.before, frame.moving, fromSquare)
    const afterTargets = captureTargets(frame.after, frame.moving, toSquare)
    // Only this side's piece moved. Uncaptured enemies retain their identities
    // and squares; matching square/side/type is therefore sufficient here.
    const key = (target: MechanismCaptureTarget): string => `${target.square}:${target.side}:${target.piece}`
    const beforeKeys = new Set(beforeTargets.map(key))
    const afterKeys = new Set(afterTargets.map(key))
    const added = afterTargets.filter(target => !beforeKeys.has(key(target)))
    const removed = beforeTargets.filter(target => !afterKeys.has(key(target)))
    const changes: FutureMoveLegalityChange[] = []
    const futureOwnPliesConsidered: number[] = []
    const futurePliesChecked: number[] = []
    const alreadyMoved = new Set<Piece>()
    for (let next = index + 1; next < frames.length && futureOwnPliesConsidered.length < MAX_FUTURE_OWN_PLIES; next++) {
      const future = frames[next]
      if (future.moving.color !== frame.moving.color) continue
      futureOwnPliesConsidered.push(next + 1)
      const coordinates = parseUciMove(future.uci)!
      // applyUciMove copies grid rows while retaining Piece object identities.
      // Never relocate a piece to its future origin or borrow a same-type piece
      // that currently occupies that square. A moved-and-returned piece is also
      // outside the first-unmoved-piece comparison.
      const eligible = future.moving !== frame.moving && !alreadyMoved.has(future.moving) &&
        frame.before.grid[coordinates.fromRow][coordinates.fromCol] === future.moving &&
        frame.after.grid[coordinates.fromRow][coordinates.fromCol] === future.moving
      alreadyMoved.add(future.moving)
      if (!eligible) continue
      futurePliesChecked.push(next + 1)
      const beforeCheck = legalMoveCheck(frame.before.grid, frame.moving.color, future.uci)
      const afterCheck = legalMoveCheck(frame.after.grid, frame.moving.color, future.uci)
      const beforeLegal = beforeCheck.ok
      const afterLegal = afterCheck.ok
      if (beforeLegal !== afterLegal) {
        changes.push({ futurePly: next + 1, move: future.move, side: future.moving.color,
          piece: future.moving.type, fromSquare: future.uci.slice(0, 2), toSquare: future.uci.slice(2), beforeLegal, afterLegal,
          beforeConstraint: beforeCheck.ok ? null : beforeCheck.message ?? null,
          afterConstraint: afterCheck.ok ? null : afterCheck.message ?? null })
      }
    }
    return {
      ply: index + 1, move: frame.move, side: frame.moving.color, piece: frame.moving.type,
      fromSquare, toSquare, fromFile, toFile, fromWing: ownerWing(fromFile), toWing: ownerWing(toFile),
      actualCapture: frame.captured ? { square: toSquare, side: frame.captured.color, piece: frame.captured.type } : null,
      captureOpportunities: {
        added: added.slice(0, MAX_CAPTURE_CHANGES_PER_KIND), removed: removed.slice(0, MAX_CAPTURE_CHANGES_PER_KIND),
        omittedAdded: Math.max(0, added.length - MAX_CAPTURE_CHANGES_PER_KIND),
        omittedRemoved: Math.max(0, removed.length - MAX_CAPTURE_CHANGES_PER_KIND)
      },
      futureMoveLegalityChanges: changes.slice(0, MAX_LEGALITY_CHANGES_PER_STEP),
      coverage: {
        futureOwnPliesConsidered, futurePliesChecked,
        omittedFutureOwnPlies: Math.floor((frames.length - index - 1) / 2) - futureOwnPliesConsidered.length,
        omittedLegalityChanges: Math.max(0, changes.length - MAX_LEGALITY_CHANGES_PER_STEP)
      }
    }
  })
  return {
    evidenceId: evidence.id,
    scope: {
      sourcePlies: moves.length, replayedPlies: frames.length, maxSourcePlies: MAX_PV_MOVES,
      maxFutureOwnPlies: MAX_FUTURE_OWN_PLIES, maxLegalityChangesPerStep: MAX_LEGALITY_CHANGES_PER_STEP,
      maxCaptureChangesPerKind: MAX_CAPTURE_CHANGES_PER_KIND, wingPerspective: 'piece_owner',
      captureOpportunityMeaning: 'fixed_board_same_side_to_move',
      futureMoveMeaning: 'first_future_move_of_other_unmoved_piece_on_fixed_boards',
      coverageNotice: '左右翼依該棋子所屬方視角。吃子機會假設固定盤面再輪該方，並非已吃或必然威脅。後續合法性只比較本線有限候選及仍在原格、尚未移動的其他同方棋子；不假移棋子、不證明唯一原因或策略優劣，未列出也不代表沒有作用。'
    },
    steps, warning,
    truncated: frames.length < moves.length || steps.some(step =>
      step.coverage.omittedFutureOwnPlies > 0 || step.coverage.omittedLegalityChanges > 0 ||
      step.captureOpportunities.omittedAdded > 0 || step.captureOpportunities.omittedRemoved > 0)
  }
}
