import { createHash } from 'node:crypto'
import { writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { PikafishAdapter } from '../../src/main/engine/PikafishAdapter'
import { START_FEN, type BoardState } from '../../src/shared/types/BoardState'
import { parseFen } from '../../src/shared/logic/board/fen'
import { applyUciMove, formatUciMove, isKingInCheck, legalMoveCheck } from '../../src/shared/logic/board/moves'
import { formatChineseMove } from '../../src/shared/logic/board/ChineseNotation'
import { parseGameRecord } from '../../src/shared/logic/board/PlayOkWxf'

// CPU-only engine-assisted quick self-play. No account, AI credential, AppData,
// installed binary or production updater settings are read or changed here.
async function main(): Promise<void> {
  const output = resolve(process.argv[2] ?? 'self-play-replay.json')
  const engine = new PikafishAdapter(process.argv[3] ?? 'C:\\Program Files\\xiangqi-analyzer\\resources\\engine\\pikafish.exe')
  const start = parseFen(START_FEN)
  if (!start.valid) throw new Error(start.message)
  let board = start.board
  const moves: string[] = []
  const positions: Array<Record<string, unknown>> = []
  const repetitions = new Map<string, number>()
  const identity = (position: BoardState): string => position.fen.split(' ').slice(0, 2).join(' ')
  const legalMoves = (position: BoardState): string[] => {
    const result: string[] = []
    for (let row = 0; row < 10; row++) for (let col = 0; col < 9; col++) {
      if (position.grid[row][col]?.color !== position.sideToMove) continue
      for (let toRow = 0; toRow < 10; toRow++) for (let toCol = 0; toCol < 9; toCol++) {
        const move = formatUciMove({ fromRow: row, fromCol: col, toRow, toCol })
        if (move && legalMoveCheck(position.grid, position.sideToMove, move).ok) result.push(move)
      }
    }
    return result
  }
  const started = Date.now()
  repetitions.set(identity(board), 1)
  let result = '*'
  let termination = 'bounded_limit_reached_incomplete'
  for (let ply = 0; ply <= 240; ply++) {
    const legal = legalMoves(board)
    if (legal.length === 0) {
      result = board.sideToMove === 'red' ? '0-1' : '1-0'
      termination = isKingInCheck(board.grid, board.sideToMove) ? 'checkmate' : 'stalemate_xiangqi_loss'
      break
    }
    if (ply === 240) break
    const analysis = await engine.analyzePosition({ positionFen: board.fen }, {
      rootAnalysisMovetimeMs: 100, userMoveEvalMovetimeMs: 100, multiPv: 3
    })
    const candidates = analysis.candidateMoves.map(candidate => candidate.move).filter(move => legal.includes(move))
    if (candidates.length === 0) throw new Error(`No legal engine candidate at ply ${ply + 1}`)
    // Red uses the first candidate; Black uses the second when available. This
    // provides real alternative decisions to review, not a fabricated fixture.
    const preferred = board.sideToMove === 'black' && candidates.length > 1 ? candidates[1] : candidates[0]
    const ordered = [preferred, ...candidates.filter(move => move !== preferred), ...legal.filter(move => !candidates.includes(move))]
    const selected = ordered.find(move => {
      const next = applyUciMove(board, move)
      return next.valid && (repetitions.get(identity(next.board)) ?? 0) < 2
    })
    if (!selected) { termination = 'unresolved_repetition_incomplete'; break }
    const next = applyUciMove(board, selected)
    if (!next.valid) throw new Error(next.message)
    positions.push({ ply: ply + 1, fen: board.fen, side: board.sideToMove,
      move: selected, displayMove: formatChineseMove(board, selected), captured: next.captured?.type ?? null,
      givesCheck: isKingInCheck(next.board.grid, next.board.sideToMove), depth: analysis.depth,
      selection: selected === preferred ? 'ranked_candidate' : 'avoid_unresolved_repetition',
      candidateMoves: analysis.candidateMoves.map(({ move, displayMove, score }) => ({ move, displayMove, score })) })
    moves.push(selected)
    board = next.board
    repetitions.set(identity(board), (repetitions.get(identity(board)) ?? 0) + 1)
    if (moves.length % 20 === 0) console.log(`Self-play ${moves.length} legal plies; ${board.sideToMove} to move.`)
  }
  const record = moves.join(' ')
  const replay = parseGameRecord(record)
  if (!replay.valid || replay.positions.at(-1)?.fen !== board.fen) throw new Error('Formal game import/replay mismatch')
  writeFileSync(output, JSON.stringify({ sourceCommit: process.env.RECKONING_SOURCE_COMMIT,
    evidenceClass: 'source_cpu_self_play_and_formal_import_not_installed_ui',
    policy: 'Pikafish 100ms MultiPV3 each side; red rank1/black rank2; avoid third position occurrence without adjudicating a draw',
    engine: engine.engineName, durationMs: Date.now() - started, plies: moves.length,
    complete: result !== '*', result, termination, finalFen: board.fen, importValidator: 'passed',
    uciRecord: record, sha256: createHash('sha256').update(record).digest('hex'), positions
  }, null, 2))
  writeFileSync(output.replace(/\.json$/i, '.uci.txt'), record + '\n')
  console.log(JSON.stringify({ output, complete: result !== '*', result, termination, plies: moves.length }))
  if (result === '*') process.exitCode = 2
}
void main().catch(error => { console.error(error); process.exitCode = 1 })
