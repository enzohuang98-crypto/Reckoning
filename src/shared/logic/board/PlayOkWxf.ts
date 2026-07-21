import type { BoardState, PieceColor, PieceType } from '../../types/BoardState'
import { START_FEN } from '../../types/BoardState'
import { parseFen } from './fen'
import { applyUciMove, formatUciMove, parseUciMove } from './moves'

export interface ParsedGameRecord {
  valid: true
  format: 'uci' | 'wxf'
  /** 轉換後的合法 UCI 著法。 */
  moves: string[]
  /** WXF 保留來源 token；UCI 則為正規化後的 UCI。 */
  displayMoves: string[]
  /** positions[0] 是起始局面，positions[i] 是第 i 個半回合走完後的局面。 */
  positions: BoardState[]
}

export interface GameRecordParseError {
  valid: false
  message: string
  halfMove?: number
  token?: string
}

export type GameRecordParseResult = ParsedGameRecord | GameRecordParseError

interface WxfMove {
  pieceType: PieceType
  origin: string
  action: string
  target: number
}

const WXF_HEADER_PATTERN = /\bFORMAT\s+WXF\b/i
const WXF_BODY_PATTERN = /\bSTART\s*\{([\s\S]*?)\}\s*END\b/i
const WXF_TOKEN_PATTERN = /^([KAEHBNRCP])([1-9+-])([.+=-])([1-9])$/i

const WXF_PIECE_TYPES: Record<string, PieceType> = {
  K: 'king',
  A: 'advisor',
  E: 'elephant',
  B: 'elephant',
  H: 'horse',
  N: 'horse',
  R: 'rook',
  C: 'cannon',
  P: 'pawn'
}

function defaultStartBoard(): BoardState | null {
  const parsed = parseFen(START_FEN)
  return parsed.valid ? parsed.board : null
}

function moveError(halfMove: number, token: string, detail: string): GameRecordParseError {
  return {
    valid: false,
    message: `第 ${halfMove} 半回合 token "${token}" ${detail}`,
    halfMove,
    token
  }
}

function fileNumber(color: PieceColor, col: number): number {
  return color === 'red' ? 9 - col : col + 1
}

function isForward(color: PieceColor, fromRow: number, toRow: number): boolean {
  return color === 'red' ? toRow < fromRow : toRow > fromRow
}

function matchesRelativeOrigin(
  board: BoardState,
  pieceType: PieceType,
  fromRow: number,
  fromCol: number,
  origin: string
): boolean {
  if (origin !== '+' && origin !== '-') return false

  const rows: number[] = []
  for (let row = 0; row < board.grid.length; row += 1) {
    const piece = board.grid[row][fromCol]
    if (piece?.color === board.sideToMove && piece.type === pieceType) rows.push(row)
  }
  if (rows.length < 2) return false

  rows.sort((left, right) =>
    board.sideToMove === 'red' ? left - right : right - left
  )
  return fromRow === (origin === '+' ? rows[0] : rows[rows.length - 1])
}

function matchesWxfMove(board: BoardState, move: string, wxf: WxfMove): boolean {
  const coords = parseUciMove(move)
  if (!coords) return false
  const piece = board.grid[coords.fromRow][coords.fromCol]
  if (!piece || piece.type !== wxf.pieceType || piece.color !== board.sideToMove) {
    return false
  }

  if (/^[1-9]$/.test(wxf.origin)) {
    if (fileNumber(piece.color, coords.fromCol) !== Number(wxf.origin)) return false
  } else if (
    !matchesRelativeOrigin(
      board,
      piece.type,
      coords.fromRow,
      coords.fromCol,
      wxf.origin
    )
  ) {
    return false
  }

  const horizontal = coords.fromRow === coords.toRow
  if (wxf.action === '.' || wxf.action === '=') {
    return horizontal && fileNumber(piece.color, coords.toCol) === wxf.target
  }
  if (horizontal) return false
  if ((wxf.action === '+') !== isForward(piece.color, coords.fromRow, coords.toRow)) {
    return false
  }

  const targetIsFile =
    piece.type === 'advisor' || piece.type === 'elephant' || piece.type === 'horse'
  const actualTarget = targetIsFile
    ? fileNumber(piece.color, coords.toCol)
    : Math.abs(coords.toRow - coords.fromRow)
  return actualTarget === wxf.target
}

function parseWxfToken(token: string): WxfMove | null {
  const matched = WXF_TOKEN_PATTERN.exec(token)
  if (!matched) return null
  return {
    pieceType: WXF_PIECE_TYPES[matched[1].toUpperCase()],
    origin: matched[2],
    action: matched[3],
    target: Number(matched[4])
  }
}

function legalCandidates(board: BoardState, wxf: WxfMove): string[] {
  const result: string[] = []
  for (let fromRow = 0; fromRow < board.grid.length; fromRow += 1) {
    for (let fromCol = 0; fromCol < board.grid[fromRow].length; fromCol += 1) {
      const piece = board.grid[fromRow][fromCol]
      if (piece?.color !== board.sideToMove || piece.type !== wxf.pieceType) continue
      for (let toRow = 0; toRow < board.grid.length; toRow += 1) {
        for (let toCol = 0; toCol < board.grid[toRow].length; toCol += 1) {
          const move = formatUciMove({ fromRow, fromCol, toRow, toCol })
          if (!move || !matchesWxfMove(board, move, wxf)) continue
          if (applyUciMove(board, move).valid) result.push(move)
        }
      }
    }
  }
  return result
}

function parseUciRecord(input: string, startBoard: BoardState): GameRecordParseResult {
  const tokens = input.trim().split(/\s+/).filter(Boolean)
  if (tokens.length === 0) return { valid: false, message: '棋譜不可為空。' }

  const positions: BoardState[] = [startBoard]
  const moves: string[] = []
  let current = startBoard
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index]
    const move = token.toLowerCase()
    const applied = applyUciMove(current, move)
    if (!applied.valid) {
      return moveError(index + 1, token, `不合法：${applied.message}`)
    }
    moves.push(move)
    current = applied.board
    positions.push(current)
  }
  return { valid: true, format: 'uci', moves, displayMoves: moves, positions }
}

function parseWxfTokens(tokens: string[], startBoard: BoardState): GameRecordParseResult {
  if (tokens.length === 0) return { valid: false, message: 'WXF 棋譜沒有著法。' }

  const positions: BoardState[] = [startBoard]
  const moves: string[] = []
  let current = startBoard
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index]
    const wxf = parseWxfToken(token)
    if (!wxf) return moveError(index + 1, token, '格式錯誤。')

    const candidates = legalCandidates(current, wxf)
    if (candidates.length === 0) {
      return moveError(index + 1, token, '無法對應到合法著法。')
    }
    if (candidates.length > 1) {
      return moveError(
        index + 1,
        token,
        `對應到 ${candidates.length} 個合法著法，無法唯一判定。`
      )
    }

    const move = candidates[0]
    const applied = applyUciMove(current, move)
    if (!applied.valid) {
      return moveError(index + 1, token, `轉換為 ${move} 後不合法：${applied.message}`)
    }
    moves.push(move)
    current = applied.board
    positions.push(current)
  }
  return {
    valid: true,
    format: 'wxf',
    moves,
    displayMoves: [...tokens],
    positions
  }
}

function tokenizeWxfBody(body: string): string[] {
  return body
    .trim()
    .split(/\s+/)
    .map((fragment) => fragment.replace(/^\d+\.(?:\.\.)?/, ''))
    .filter(Boolean)
}

/** 解析 PlayOK 完整 `FORMAT WXF ... START{...}END` 棋譜。 */
export function parsePlayOkWxf(
  input: string,
  startBoard?: BoardState
): GameRecordParseResult {
  if (!WXF_HEADER_PATTERN.test(input)) {
    return { valid: false, message: 'PlayOK 棋譜缺少 FORMAT WXF 標頭。' }
  }
  const body = WXF_BODY_PATTERN.exec(input)?.[1]
  if (body === undefined) {
    return { valid: false, message: 'WXF 棋譜缺少 START{...}END 區段。' }
  }
  const start = startBoard ?? defaultStartBoard()
  if (!start) return { valid: false, message: '內建起始局面無法解析。' }
  return parseWxfTokens(tokenizeWxfBody(body), start)
}

/** 自動辨識完整 PlayOK WXF 或既有的空白分隔 UCI 序列。 */
export function parseGameRecord(
  input: string,
  startBoard?: BoardState
): GameRecordParseResult {
  if (!input.trim()) return { valid: false, message: '棋譜不可為空。' }
  if (WXF_HEADER_PATTERN.test(input)) return parsePlayOkWxf(input, startBoard)
  const start = startBoard ?? defaultStartBoard()
  if (!start) return { valid: false, message: '內建起始局面無法解析。' }
  return parseUciRecord(input, start)
}
