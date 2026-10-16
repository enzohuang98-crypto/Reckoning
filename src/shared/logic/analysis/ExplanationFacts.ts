/**
 * 解說事實表 (ExplanationFacts) — v2 解說管線的事實來源（純函式）。
 *
 * 由程式逐手重播引擎主線，算出「誰走、哪個子、吃了什麼、是否將軍、走後威脅與有無保護、
 * 線末是否將死／困斃、兩條線的關鍵差異」。AI 只負責把這些事實講成人話，
 * 不再自己從 FEN 推棋盤（免費模型在這一步最常出錯）。
 *
 * 只產生客觀描述，不做戰略判斷；分數只取 comparableValue（兵）或殺棋的 displayText，絕不使用 EngineScore.raw。
 */

import type { ExplanationLanguage } from '../../types/AIExplanationTypes'
import type { BoardState, PieceColor, PieceType } from '../../types/BoardState'
import type { EngineAnalysis, EngineScore } from '../../types/EngineAnalysis'
import {
  MISTAKE_LEVEL_LABELS,
  type MistakeLevel,
  type MoveComparisonResult
} from '../../types/MoveComparisonResult'
import { fileNumber, fileNumeral, formatChineseMove } from '../board/ChineseNotation'
import { parseFen } from '../board/fen'
import {
  applyUciMove,
  formatUciMove,
  hasAnyLegalMove,
  isKingInCheck,
  isSquareAttackedBy,
  legalMoveCheck,
  parseUciMove
} from '../board/moves'

export const MAX_FACT_LINE_PLIES = 10
export const MAX_FACT_THREATS = 3
export const MAX_FACT_DIFFERENCES = 3
export const MAX_FACTS_PROMPT_CHARS = 1_500
/** 盤面子數不超過這個數時（殘局），事實表列出全部棋子，避免模型自己想像盤面上還有哪些子。 */
export const MAX_INVENTORY_PIECES = 12

export type PlyDescriptor =
  | 'enters_center'
  | 'rook_develops'
  | 'horse_develops'
  | 'pawn_crosses_river'
  | 'king_moves'

export interface ThreatFact {
  piece: PieceType
  side: PieceColor
  /** 目標所在的路（該方自己右手邊起算 1–9）。 */
  file: number
  /** 假設被吃下後，對方能否在同一格吃回（將/帥一步可及也算；即象棋所說的「有根」）。 */
  protected: boolean
  /** 能合法吃回的子（同一格；依子力由小到大挑一個）及其所在的路。 */
  recapturer?: { piece: PieceType; file: number }
}

export interface PlyFact {
  ply: number
  side: PieceColor
  uci: string
  move: string
  piece: PieceType
  captured: PieceType | null
  /** 被吃的子所在的路（被吃方自己右手邊起算 1–9）。 */
  capturedFile: number | null
  givesCheck: boolean
  /** 走這一手時，行棋方沒有其他合法著法（例如被將軍時只有一種應將方式）。 */
  onlyLegalMove: boolean
  threats: ThreatFact[]
  /** 這一手新製造的可吃目標（走前已存在的不重複列出），依子力價值排序，最多 3 個。 */
  descriptors: PlyDescriptor[]
}

export interface LineFacts {
  plies: PlyFact[]
  /** 線末輪走方沒有合法著法時：被將軍為將死，否則為困斃（象棋中困斃同樣判負，與西洋棋逼和不同）。 */
  endsWith: 'checkmate' | 'stalemate' | null
  /** 這條線中各方吃掉的子（依順序）。 */
  captures: Record<PieceColor, PieceType[]>
  /** 主線無法重播時的說明（之後的著法已省略）。 */
  warning?: string
}

/**
 * 給模型看的評估：一般分數換成「兵」（comparableValue，原局面行棋方視角），殺棋保留「殺 N」文字。
 * P3-9 live 中模型把原始 centipawn「42」「2000」讀成很大的差距，所以不再直接給 displayText。
 */
export type FactScore = { kind: 'pawns'; value: number } | { kind: 'mate'; text: string }

export interface MoveFact {
  uci: string
  move: string
  score?: FactScore
}

function factScore(score: EngineScore | null | undefined): FactScore | undefined {
  if (!score) return undefined
  if (score.type === 'mate') return { kind: 'mate', text: score.displayText }
  return Number.isFinite(score.comparableValue)
    ? { kind: 'pawns', value: Math.round(score.comparableValue * 100) / 100 }
    : undefined
}

export type FactDifference =
  | { kind: 'no_captures'; plies: number }
  | {
      kind: 'first_capture'
      line: 'best' | 'user'
      ply: number
      side: PieceColor
      piece: PieceType
      captured: PieceType
      otherLineCaptureFirstAt: number | null
    }
  | { kind: 'first_check'; line: 'best' | 'user'; ply: number; side: PieceColor; otherLineCheckAt: number | null }
  | {
      kind: 'material'
      best: Record<PieceColor, PieceType[]>
      user: Record<PieceColor, PieceType[]>
    }

export interface ExplanationFacts {
  positionFen: string
  sideToMove: PieceColor
  bestMove: MoveFact
  userMove?: MoveFact
  /** 棋手的著法就是引擎首選。 */
  userIsBest: boolean
  mistakeLevel?: MistakeLevel
  /** 差距（兵）；只描述大小，不當理由。 */
  scoreGapPawns?: number
  bestLine: LineFacts
  userLine?: LineFacts
  candidates: MoveFact[]
  differences: FactDifference[]
  /** 殘局時目前盤面上的全部棋子（依子種排序）；子多時不列。 */
  inventory?: Record<PieceColor, PieceType[]>
}

const INVENTORY_ORDER: PieceType[] = ['king', 'rook', 'horse', 'cannon', 'advisor', 'elephant', 'pawn']

function boardInventory(board: BoardState): Record<PieceColor, PieceType[]> | undefined {
  const pieces: Record<PieceColor, PieceType[]> = { red: [], black: [] }
  for (const row of board.grid) for (const cell of row) if (cell) pieces[cell.color].push(cell.type)
  if (pieces.red.length + pieces.black.length > MAX_INVENTORY_PIECES) return undefined
  for (const side of ['red', 'black'] as const) {
    pieces[side].sort((left, right) => INVENTORY_ORDER.indexOf(left) - INVENTORY_ORDER.indexOf(right))
  }
  return pieces
}

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

function opponent(color: PieceColor): PieceColor {
  return color === 'red' ? 'black' : 'red'
}

function homeRow(color: PieceColor): number {
  return color === 'red' ? 9 : 0
}

function crossedRiver(color: PieceColor, row: number): boolean {
  return color === 'red' ? row <= 4 : row >= 5
}

function startsWith(line: readonly string[] | undefined, move: string): string[] {
  const moves = [...(line ?? [])]
  return moves[0] === move ? moves : [move, ...moves]
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
  return { plies, endsWith, captures, ...(warning ? { warning } : {}) }
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

/** 事實表中所有可被回答引用的著法（顯示記譜）。 */
export function factMoveSet(facts: ExplanationFacts): Set<string> {
  const moves = new Set<string>([facts.bestMove.move])
  if (facts.userMove) moves.add(facts.userMove.move)
  for (const line of [facts.bestLine, facts.userLine]) {
    for (const ply of line?.plies ?? []) moves.add(ply.move)
  }
  for (const candidate of facts.candidates) moves.add(candidate.move)
  return moves
}

/** 事實表中標為「唯一合法著法」的著法（顯示記譜）。 */
export function factOnlyLegalMoves(facts: ExplanationFacts): Set<string> {
  const moves = new Set<string>()
  for (const line of [facts.bestLine, facts.userLine]) {
    for (const ply of line?.plies ?? []) if (ply.onlyLegalMove) moves.add(ply.move)
  }
  return moves
}

/** 著法是否在某條線中吃子／將軍（任何一條線都算）。 */
export function factMoveEvents(
  facts: ExplanationFacts
): Map<string, { captures: boolean; checks: boolean }> {
  const events = new Map<string, { captures: boolean; checks: boolean }>()
  for (const line of [facts.bestLine, facts.userLine]) {
    for (const ply of line?.plies ?? []) {
      const current = events.get(ply.move) ?? { captures: false, checks: false }
      events.set(ply.move, {
        captures: current.captures || ply.captured !== null,
        checks: current.checks || ply.givesCheck
      })
    }
  }
  return events
}

interface FactLabels {
  side: Record<PieceColor, string>
  /** 「黑卒」「Black pawn」：哪一方的哪個子。 */
  named: (side: string, piece: string) => string
  /** 「黑5路卒（中卒；…）」：哪一方、哪一路的哪個子；第 5 路的兵卒加上「中兵／中卒」，note 放在同一個括號裡。 */
  located: (side: string, file: string, piece: string, central: boolean, note?: string) => string
  piece: Record<PieceColor, Record<PieceType, string>>
  descriptor: Record<PlyDescriptor, (piece: string) => string>
  noCapture: string
  noCheck: string
  check: string
  onlyLegalMove: string
  capture: (piece: string) => string
  threats: string
  protectedLabel: string
  /** 「吃下後對方能用7路馬吃回」 */
  protectedBy: (piece: string) => string
  unprotectedLabel: string
  toMove: string
  bestMove: string
  userMove: string
  gap: string
  pawns: string
  userIsBest: string
  bestLine: string
  userLine: string
  differences: string
  candidates: string
  evaluation: string
  /** 評估的視角與單位說明（一行）。 */
  perspective: (side: string) => string
  inventory: (pieces: string) => string
  inventorySide: (side: string, pieces: string) => string
  inventoryEmpty: string
  checkmate: (side: string) => string
  stalemate: (side: string) => string
  noCaptures: (plies: number) => string
  firstCapture: (line: string, ply: number, side: string, piece: string, captured: string, other: string) => string
  otherCapture: (at: number | null) => string
  firstCheck: (line: string, ply: number, side: string, other: string) => string
  otherCheck: (at: number | null) => string
  material: (best: string, user: string) => string
  capturesNone: string
  capturesOf: (side: string, pieces: string) => string
  /** 列出的手數內，雙方吃子的合計與子數比較（只算子數，不做子力價值換算）。 */
  lineCaptures: (captures: string, note: string) => string
  capturesEven: (count: number) => string
  capturesMore: (side: string, count: number) => string
  bestLineName: string
  userLineName: string
  truncatedNote: string
}

const PIECES_TW: Record<PieceColor, Record<PieceType, string>> = {
  red: { king: '帥', advisor: '仕', elephant: '相', horse: '馬', rook: '車', cannon: '炮', pawn: '兵' },
  black: { king: '將', advisor: '士', elephant: '象', horse: '馬', rook: '車', cannon: '炮', pawn: '卒' }
}
const PIECES_CN: Record<PieceColor, Record<PieceType, string>> = {
  red: { king: '帅', advisor: '仕', elephant: '相', horse: '马', rook: '车', cannon: '炮', pawn: '兵' },
  black: { king: '将', advisor: '士', elephant: '象', horse: '马', rook: '车', cannon: '炮', pawn: '卒' }
}
const PIECES_EN: Record<PieceColor, Record<PieceType, string>> = {
  red: { king: 'king', advisor: 'advisor', elephant: 'elephant', horse: 'horse', rook: 'rook', cannon: 'cannon', pawn: 'pawn' },
  black: { king: 'king', advisor: 'advisor', elephant: 'elephant', horse: 'horse', rook: 'rook', cannon: 'cannon', pawn: 'pawn' }
}

const LABELS: Record<ExplanationLanguage, FactLabels> = {
  'zh-TW': {
    side: { red: '紅', black: '黑' },
    named: (side, piece) => `${side}${piece}`,
    located: (side, file, piece, central, note) => {
      const inner = [central ? `中${piece}` : '', note ?? ''].filter(Boolean).join('；')
      return `${side}${file}路${piece}${inner ? `（${inner}）` : ''}`
    },
    piece: PIECES_TW,
    descriptor: {
      enters_center: (piece) => `${piece}進入中路`,
      rook_develops: () => '出車',
      horse_develops: () => '跳馬出動',
      pawn_crosses_river: (piece) => `${piece}過河`,
      king_moves: (piece) => `${piece}移動`
    },
    noCapture: '未吃子',
    noCheck: '未將軍',
    check: '將軍',
    onlyLegalMove: '唯一合法著法',
    capture: (piece) => `吃${piece}`,
    threats: '走完這步，下一手可吃',
    protectedLabel: '吃下後對方能吃回',
    protectedBy: (piece) => `吃下後對方能用${piece}吃回`,
    unprotectedLabel: '吃下後對方吃不回',
    toMove: '輪到',
    bestMove: '引擎首選',
    userMove: '棋手著法',
    gap: '差距',
    pawns: '兵',
    userIsBest: '棋手的著法就是引擎首選。',
    bestLine: '首選主線',
    userLine: '棋手著法之後的主線',
    differences: '兩線差異',
    candidates: '其他候選',
    evaluation: '評估',
    perspective: (side) => `評估都以${side}方來看，單位是兵；正數對${side}方有利，負數對${side}方不利。`,
    inventory: (pieces) => `盤面上全部的棋子：${pieces}。`,
    inventorySide: (side, pieces) => `${side}方 ${pieces}`,
    inventoryEmpty: '無',
    checkmate: (side) => `主線結束時${side}方無合法著法且被將軍：將死。`,
    stalemate: (side) => `主線結束時${side}方無子可動：困斃（象棋規則判${side}方負）。`,
    noCaptures: (plies) => `兩線前 ${plies} 手都沒有吃子。`,
    firstCapture: (line, ply, side, piece, captured, other) =>
      `${line}第 ${ply} 手${side}${piece}吃${captured}${other}。`,
    otherCapture: (at) => (at === null ? '，另一條線沒有吃子' : `，另一條線第 ${at} 手才有吃子`),
    firstCheck: (line, ply, side, other) => `${line}第 ${ply} 手${side}方先將軍${other}。`,
    otherCheck: (at) => (at === null ? '，另一條線沒有將軍' : `，另一條線第 ${at} 手才將軍`),
    material: (best, user) => `吃子結果：首選線${best}；實戰線${user}。`,
    capturesNone: '雙方都沒有吃子',
    capturesOf: (side, pieces) => `${side}方吃掉${pieces}`,
    lineCaptures: (captures, note) => `列出手數內吃子合計：${captures}（${note}）`,
    capturesEven: (count) => `雙方各吃 ${count} 子，子數相同`,
    capturesMore: (side, count) => `${side}方多吃 ${count} 子`,
    bestLineName: '首選線',
    userLineName: '實戰線',
    truncatedNote: '（主線只列出部分手數）'
  },
  'zh-CN': {
    side: { red: '红', black: '黑' },
    named: (side, piece) => `${side}${piece}`,
    located: (side, file, piece, central, note) => {
      const inner = [central ? `中${piece}` : '', note ?? ''].filter(Boolean).join('；')
      return `${side}${file}路${piece}${inner ? `（${inner}）` : ''}`
    },
    piece: PIECES_CN,
    descriptor: {
      enters_center: (piece) => `${piece}进入中路`,
      rook_develops: () => '出车',
      horse_develops: () => '跳马出动',
      pawn_crosses_river: (piece) => `${piece}过河`,
      king_moves: (piece) => `${piece}移动`
    },
    noCapture: '未吃子',
    noCheck: '未将军',
    check: '将军',
    onlyLegalMove: '唯一合法着法',
    capture: (piece) => `吃${piece}`,
    threats: '走完这步，下一手可吃',
    protectedLabel: '吃下后对方能吃回',
    protectedBy: (piece) => `吃下后对方能用${piece}吃回`,
    unprotectedLabel: '吃下后对方吃不回',
    toMove: '轮到',
    bestMove: '引擎首选',
    userMove: '棋手着法',
    gap: '差距',
    pawns: '兵',
    userIsBest: '棋手的着法就是引擎首选。',
    bestLine: '首选主线',
    userLine: '棋手着法之后的主线',
    differences: '两线差异',
    candidates: '其他候选',
    evaluation: '评估',
    perspective: (side) => `评估都以${side}方来看，单位是兵；正数对${side}方有利，负数对${side}方不利。`,
    inventory: (pieces) => `盘面上全部的棋子：${pieces}。`,
    inventorySide: (side, pieces) => `${side}方 ${pieces}`,
    inventoryEmpty: '无',
    checkmate: (side) => `主线结束时${side}方无合法着法且被将军：将死。`,
    stalemate: (side) => `主线结束时${side}方无子可动：困毙（象棋规则判${side}方负）。`,
    noCaptures: (plies) => `两线前 ${plies} 手都没有吃子。`,
    firstCapture: (line, ply, side, piece, captured, other) =>
      `${line}第 ${ply} 手${side}${piece}吃${captured}${other}。`,
    otherCapture: (at) => (at === null ? '，另一条线没有吃子' : `，另一条线第 ${at} 手才有吃子`),
    firstCheck: (line, ply, side, other) => `${line}第 ${ply} 手${side}方先将军${other}。`,
    otherCheck: (at) => (at === null ? '，另一条线没有将军' : `，另一条线第 ${at} 手才将军`),
    material: (best, user) => `吃子结果：首选线${best}；实战线${user}。`,
    capturesNone: '双方都没有吃子',
    capturesOf: (side, pieces) => `${side}方吃掉${pieces}`,
    lineCaptures: (captures, note) => `列出手数内吃子合计：${captures}（${note}）`,
    capturesEven: (count) => `双方各吃 ${count} 子，子数相同`,
    capturesMore: (side, count) => `${side}方多吃 ${count} 子`,
    bestLineName: '首选线',
    userLineName: '实战线',
    truncatedNote: '（主线只列出部分手数）'
  },
  en: {
    side: { red: 'Red', black: 'Black' },
    named: (side, piece) => `${side} ${piece}`,
    located: (side, file, piece, central, note) => {
      const inner = [central ? 'central pawn' : '', note ?? ''].filter(Boolean).join('; ')
      return `${side} ${piece} on file ${file}${inner ? ` (${inner})` : ''}`
    },
    piece: PIECES_EN,
    descriptor: {
      enters_center: (piece) => `${piece} moves to the central file`,
      rook_develops: () => 'rook develops',
      horse_develops: () => 'horse develops',
      pawn_crosses_river: (piece) => `${piece} crosses the river`,
      king_moves: (piece) => `${piece} moves`
    },
    noCapture: 'no capture',
    noCheck: 'no check',
    check: 'check',
    onlyLegalMove: 'the only legal move',
    capture: (piece) => `captures ${piece}`,
    threats: 'after this move it can capture next',
    protectedLabel: 'can be recaptured',
    protectedBy: (piece) => `can be recaptured by the ${piece}`,
    unprotectedLabel: 'cannot be recaptured',
    toMove: 'To move',
    bestMove: 'Engine best move',
    userMove: "Player's move",
    gap: 'Gap',
    pawns: 'pawns',
    userIsBest: "The player's move is the engine's best move.",
    bestLine: 'Best line',
    userLine: "Line after the player's move",
    differences: 'Differences',
    candidates: 'Other candidates',
    evaluation: 'eval',
    perspective: (side) => `All evals are from ${side}'s point of view, in pawns; positive favours ${side}, negative favours the opponent.`,
    inventory: (pieces) => `All pieces on the board: ${pieces}.`,
    inventorySide: (side, pieces) => `${side} ${pieces}`,
    inventoryEmpty: 'none',
    checkmate: (side) => `At the end of the line ${side} has no legal move and is in check: checkmate.`,
    stalemate: (side) => `At the end of the line ${side} has no legal move: stalemate (a loss for ${side}).`,
    noCaptures: (plies) => `Neither line captures anything in the first ${plies} plies.`,
    firstCapture: (line, ply, side, piece, captured, other) =>
      `In the ${line}, ply ${ply}: ${side} ${piece} captures ${captured}${other}.`,
    otherCapture: (at) => (at === null ? '; the other line has no capture' : `; the other line first captures at ply ${at}`),
    firstCheck: (line, ply, side, other) => `In the ${line}, ${side} gives check first at ply ${ply}${other}.`,
    otherCheck: (at) => (at === null ? '; the other line has no check' : `; the other line first checks at ply ${at}`),
    material: (best, user) => `Captures: best line ${best}; player's line ${user}.`,
    capturesNone: 'no captures by either side',
    capturesOf: (side, pieces) => `${side} captured ${pieces}`,
    lineCaptures: (captures, note) => `Captures within the listed plies: ${captures} (${note})`,
    capturesEven: (count) => `each side captured ${count}, equal piece count`,
    capturesMore: (side, count) => `${side} captured ${count} more`,
    bestLineName: 'best line',
    userLineName: "player's line",
    truncatedNote: '(only part of the line is listed)'
  }
}

function capturesText(
  captures: Record<PieceColor, PieceType[]>,
  labels: FactLabels
): string {
  const parts = (['red', 'black'] as const)
    .filter((side) => captures[side].length > 0)
    .map((side) =>
      labels.capturesOf(
        labels.side[side],
        captures[side]
          .map((piece) => labels.named(labels.side[opponent(side)], labels.piece[opponent(side)][piece]))
          .join('、')
      )
    )
  return parts.length > 0 ? parts.join('；') : labels.capturesNone
}

function protectionText(threat: ThreatFact, labels: FactLabels, language: ExplanationLanguage): string {
  if (!threat.protected) return labels.unprotectedLabel
  if (!threat.recapturer) return labels.protectedLabel
  const defender = threat.side
  const { piece, file } = threat.recapturer
  const name =
    language === 'en'
      ? `${labels.piece[defender][piece]} on file ${file}`
      : `${fileNumeral(defender, defender === 'red' ? 9 - file : file - 1)}路${labels.piece[defender][piece]}`
  return labels.protectedBy(name)
}

/** 帶「路」的子名：紅方用中文數字、黑方用阿拉伯數字（英文一律用數字）。 */
function locatedName(
  side: PieceColor,
  piece: PieceType,
  file: number,
  labels: FactLabels,
  language: ExplanationLanguage,
  note?: string
): string {
  const numeral = language === 'en' ? String(file) : fileNumeral(side, side === 'red' ? 9 - file : file - 1)
  return labels.located(labels.side[side], numeral, labels.piece[side][piece], piece === 'pawn' && file === 5, note)
}

function formatPly(ply: PlyFact, labels: FactLabels, language: ExplanationLanguage): string {
  const pieceName = labels.piece[ply.side][ply.piece]
  const parts: string[] = ply.onlyLegalMove ? [labels.onlyLegalMove] : []
  parts.push(...ply.descriptors.map((descriptor) => labels.descriptor[descriptor](pieceName)))
  const enemy = opponent(ply.side)
  parts.push(
    ply.captured
      ? labels.capture(
          ply.capturedFile !== null
            ? locatedName(enemy, ply.captured, ply.capturedFile, labels, language)
            : labels.named(labels.side[enemy], labels.piece[enemy][ply.captured])
        )
      : labels.noCapture
  )
  parts.push(ply.givesCheck ? labels.check : labels.noCheck)
  if (ply.threats.length > 0) {
    parts.push(
      `${labels.threats}：${ply.threats
        .map(
          (threat) =>
            locatedName(
              threat.side,
              threat.piece,
              threat.file,
              labels,
              language,
              protectionText(threat, labels, language)
            )
        )
        .join('、')}`
    )
  }
  return ` ${ply.ply}. ${labels.side[ply.side]} ${ply.move}：${parts.join('；')}`
}

function formatLine(
  title: string,
  line: LineFacts,
  labels: FactLabels,
  maxPlies: number,
  language: ExplanationLanguage
): string[] {
  const lines = [`${title}：`]
  const shown = line.plies.slice(0, maxPlies)
  for (const ply of shown) lines.push(formatPly(ply, labels, language))
  // 只列子數：子力價值要看局面，沒有固定換算，交給引擎評估，不在事實表裡判斷誰划算。
  const taken: Record<PieceColor, PieceType[]> = { red: [], black: [] }
  for (const ply of shown) if (ply.captured) taken[ply.side].push(ply.captured)
  if (taken.red.length + taken.black.length > 0) {
    const diff = taken.red.length - taken.black.length
    const note =
      diff === 0
        ? labels.capturesEven(taken.red.length)
        : labels.capturesMore(labels.side[diff > 0 ? 'red' : 'black'], Math.abs(diff))
    lines.push(` ${labels.lineCaptures(capturesText(taken, labels), note)}`)
  }
  if (line.plies.length > maxPlies) lines.push(` ${labels.truncatedNote}`)
  if (line.warning) lines.push(` ${line.warning}`)
  const last = line.plies.at(-1)
  if (last && line.plies.length <= maxPlies) {
    const loser = labels.side[opponent(last.side)]
    if (line.endsWith === 'checkmate') lines.push(` ${labels.checkmate(loser)}`)
    if (line.endsWith === 'stalemate') lines.push(` ${labels.stalemate(loser)}`)
  }
  return lines
}

function formatDifference(difference: FactDifference, labels: FactLabels): string {
  switch (difference.kind) {
    case 'no_captures':
      return labels.noCaptures(difference.plies)
    case 'first_capture': {
      const enemy = opponent(difference.side)
      return labels.firstCapture(
        difference.line === 'best' ? labels.bestLineName : labels.userLineName,
        difference.ply,
        labels.side[difference.side],
        labels.piece[difference.side][difference.piece],
        labels.named(labels.side[enemy], labels.piece[enemy][difference.captured]),
        labels.otherCapture(difference.otherLineCaptureFirstAt)
      )
    }
    case 'first_check':
      return labels.firstCheck(
        difference.line === 'best' ? labels.bestLineName : labels.userLineName,
        difference.ply,
        labels.side[difference.side],
        labels.otherCheck(difference.otherLineCheckAt)
      )
    case 'material':
      return labels.material(capturesText(difference.best, labels), capturesText(difference.user, labels))
  }
}

function render(facts: ExplanationFacts, labels: FactLabels, maxPlies: number, language: ExplanationLanguage): string {
  const out: string[] = []
  out.push(`${labels.toMove}：${labels.side[facts.sideToMove]}${language === 'en' ? '' : '方'}`)
  if (facts.inventory) {
    const inventory = facts.inventory
    const sides = (['red', 'black'] as const).map((side) => {
      // 同種子合併成「兵×3」。
      const names = INVENTORY_ORDER.flatMap((piece) => {
        const count = inventory[side].filter((item) => item === piece).length
        if (count === 0) return []
        return [`${labels.piece[side][piece]}${count > 1 ? `×${count}` : ''}`]
      })
      return labels.inventorySide(labels.side[side], names.length > 0 ? names.join('、') : labels.inventoryEmpty)
    })
    out.push(labels.inventory(sides.join('；')))
  }
  const scores = [facts.bestMove, facts.userMove, ...facts.candidates].map((move) => move?.score)
  if (scores.some((item) => item?.kind === 'pawns')) out.push(labels.perspective(labels.side[facts.sideToMove]))
  const score = (move: MoveFact): string => {
    if (!move.score) return ''
    const text =
      move.score.kind === 'mate'
        ? move.score.text
        : `${move.score.value > 0 ? '+' : ''}${move.score.value.toFixed(2)} ${labels.pawns}`
    return `（${labels.evaluation} ${text}）`
  }
  const headline = [`${labels.bestMove}：${facts.bestMove.move}${score(facts.bestMove)}`]
  if (facts.userMove) headline.push(`${labels.userMove}：${facts.userMove.move}${score(facts.userMove)}`)
  if (facts.mistakeLevel || facts.scoreGapPawns !== undefined) {
    const level = facts.mistakeLevel
      ? language === 'en'
        ? facts.mistakeLevel.replace(/_/g, ' ')
        : MISTAKE_LEVEL_LABELS[facts.mistakeLevel]
      : ''
    const gap = facts.scoreGapPawns !== undefined ? `${facts.scoreGapPawns} ${labels.pawns}` : ''
    headline.push(`${labels.gap}：${[level, gap ? `（${gap}）` : ''].join('')}`)
  }
  out.push(headline.join('；'))
  if (facts.userIsBest) out.push(labels.userIsBest)
  out.push(...formatLine(labels.bestLine, facts.bestLine, labels, maxPlies, language))
  if (facts.userLine) out.push(...formatLine(labels.userLine, facts.userLine, labels, maxPlies, language))
  if (facts.differences.length > 0) {
    out.push(`${labels.differences}：`)
    for (const difference of facts.differences) out.push(` - ${formatDifference(difference, labels)}`)
  }
  const others = facts.candidates.filter(
    (candidate) => candidate.move !== facts.bestMove.move && candidate.move !== facts.userMove?.move
  )
  if (others.length > 0) {
    out.push(`${labels.candidates}：${others.map((candidate) => `${candidate.move}${score(candidate)}`).join('、')}`)
  }
  const text = out.join('\n')
  return language === 'en' ? toAsciiPunctuation(text) : text
}

/** 英文事實表改用半形標點，避免中英混排的全形冒號與括號。 */
function toAsciiPunctuation(text: string): string {
  return text
    .replace(/：/g, ': ')
    .replace(/；/g, '; ')
    .replace(/（/g, ' (')
    .replace(/）/g, ')')
    .replace(/、/g, ', ')
    .replace(/ +\n/g, '\n')
}

/** 給模型看的事實表文字；超過上限時逐步減少列出的手數。 */
export function formatFactsForPrompt(
  facts: ExplanationFacts,
  language: ExplanationLanguage = 'zh-TW'
): string {
  const labels = LABELS[language]
  let maxPlies = MAX_FACT_LINE_PLIES
  let text = render(facts, labels, maxPlies, language)
  while (text.length > MAX_FACTS_PROMPT_CHARS && maxPlies > 2) {
    maxPlies -= 2
    text = render(facts, labels, maxPlies, language)
  }
  return text.length > MAX_FACTS_PROMPT_CHARS ? text.slice(0, MAX_FACTS_PROMPT_CHARS) : text
}

/** 顯示用的單條主線（前 N 手）及其關鍵事件，供「引擎重點摘要」使用。 */
export function summarizeLine(
  line: LineFacts,
  language: ExplanationLanguage = 'zh-TW',
  maxPlies = 6
): { moves: string[]; events: string[] } {
  const labels = LABELS[language]
  const events: string[] = []
  for (const ply of line.plies.slice(0, maxPlies)) {
    const side = labels.side[ply.side]
    if (ply.captured) {
      const enemy = opponent(ply.side)
      events.push(
        language === 'en'
          ? `ply ${ply.ply}: ${side} ${labels.piece[ply.side][ply.piece]} captures ${labels.side[enemy]} ${labels.piece[enemy][ply.captured]}`
          : `第 ${ply.ply} 手${side}${labels.piece[ply.side][ply.piece]}吃${labels.side[enemy]}${labels.piece[enemy][ply.captured]}`
      )
    }
    if (ply.givesCheck) {
      events.push(language === 'en' ? `ply ${ply.ply}: ${side} gives check` : `第 ${ply.ply} 手${side}方${labels.check}`)
    }
  }
  if (line.endsWith && line.plies.length <= maxPlies) {
    const last = line.plies.at(-1)
    if (last) {
      const loser = labels.side[opponent(last.side)]
      events.push(line.endsWith === 'checkmate' ? labels.checkmate(loser) : labels.stalemate(loser))
    }
  }
  return { moves: line.plies.slice(0, maxPlies).map((ply) => ply.move), events }
}

export { formatDifference as formatFactDifference, LABELS as FACT_LABELS }
