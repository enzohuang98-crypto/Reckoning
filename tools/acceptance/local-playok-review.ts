import { readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join, resolve, basename } from 'node:path'
import { createHash } from 'node:crypto'
import { PikafishAdapter } from '../../src/main/engine/PikafishAdapter'
import { parsePlayOkWxf } from '../../src/shared/logic/board/PlayOkWxf'
import { compareMove } from '../../src/shared/logic/analysis/MoveComparisonService'

// Local, credential-free study. Player headers remain in the downloaded input;
// the review report contains only public game IDs, sides, moves and positions.
async function main() {
  const directory = resolve(process.argv[2])
  const output = resolve(process.argv[3])
  const player = process.argv[4]
  const engine = new PikafishAdapter(resolve(process.argv[5]))
  const games = []
  const selected = []
  try {
    for (const file of readdirSync(directory).filter(name => /^xq\d+\.txt$/.test(name)).sort()) {
      const raw = readFileSync(join(directory, file), 'utf8')
      const parsed = parsePlayOkWxf(raw)
      if (!parsed.valid) throw new Error(`Import failed for ${basename(file)}: ${parsed.message}`)
      const red = /^RED\s+(\S+)/m.exec(raw)?.[1]
      const black = /^BLACK\s+(\S+)/m.exec(raw)?.[1]
      const userSide = red === player ? 'red' : black === player ? 'black' : null
      if (!userSide) throw new Error('Requested player is not part of the supplied game.')
      const recordedResult = /^RESULT\s+(\S+)/m.exec(raw)?.[1]
      if (!recordedResult || !['1-0', '0-1', '1/2-1/2'].includes(recordedResult)) throw new Error('A finished recorded game is required.')
      const id = file.replace('.txt', '')
      const uciRecord = parsed.moves.join(' ')
      const positions = parsed.moves.map((move, index) => ({ ply: index + 1,
        fen: parsed.positions[index].fen, move, displayMove: parsed.displayMoves[index],
        side: parsed.positions[index].sideToMove }))
      const game = { kind: 'playok-recorded-game', sourceGameId: id, complete: true,
        importValidator: 'passed', recordedResult,
        userSide, plies: parsed.moves.length, uciRecord,
        sha256: createHash('sha256').update(uciRecord).digest('hex'), positions }
      writeFileSync(output.replace(/\.json$/i, `-${id}.json`), JSON.stringify(game, null, 2))
      games.push({ id, plies: game.plies, userSide, importValidator: game.importValidator, sha256: game.sha256 })
      // Every recorded ply was replayed by the formal importer. Analyze the
      // player's middlegame decisions, using the same fixed App defaults.
      for (const position of positions.filter(row => row.ply > 16 && row.side === userSide)) {
        const analysis = await engine.analyzePosition({ positionFen: position.fen, userMove: position.move },
          { rootAnalysisMovetimeMs: 3000, userMoveEvalMovetimeMs: 1000, multiPv: 3 })
        const comparison = compareMove(analysis)
        if (!['serious_mistake', 'major_blunder'].includes(comparison.mistakeLevel) || comparison.confidence === 'low') continue
        selected.push({ sourceGameId: id, ply: position.ply, fen: position.fen, move: position.move,
          displayMove: analysis.displayUserMove, bestMove: analysis.bestMove, displayBestMove: analysis.displayBestMove,
          comparison, analysis })
        console.log(JSON.stringify({ sourceGameId: id, ply: position.ply, side: userSide,
          mistakeLevel: comparison.mistakeLevel, confidence: comparison.confidence }))
        break
      }
    }
  } finally { /* analyzePosition disposes its own per-search engine session. */ }
  writeFileSync(output, JSON.stringify({ sourceCommit: process.env.RECKONING_SOURCE_COMMIT,
    evidenceClass: 'real-engine-recorded-game-review', config: { rootMs: 3000, userMs: 1000, multiPv: 3 },
    games, selected, aiAcceptance: 'not_run' }, null, 2))
  console.log(JSON.stringify({ games: games.length, completeImportedGames: games.length, selected: selected.length, aiAcceptance: 'not_run' }))
}
void main().catch(error => { console.error(error instanceof Error ? error.message : 'Local game study failed'); process.exitCode = 1 })
