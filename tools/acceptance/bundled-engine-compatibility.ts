import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { PikafishAdapter } from '../../src/main/engine/PikafishAdapter'
import { parseFen } from '../../src/shared/logic/board/fen'
import { legalMoveCheck } from '../../src/shared/logic/board/moves'
import { START_FEN } from '../../src/shared/types/BoardState'

// Actual bundled engine/NNUE execution. This is independent of provider/UI and
// does not claim proof on an old CPU: SSE4.1 and POPCNT are still requirements.
async function main(): Promise<void> {
  const enginePath = resolve('resources/engine/pikafish-sse41-popcnt.exe')
  const started = Date.now()
  const engine = new PikafishAdapter(enginePath, 'uci')
  const result = await engine.analyzePosition({ positionFen: START_FEN, userMove: 'h2e2' }, {
    rootAnalysisMovetimeMs: 3000, userMoveEvalMovetimeMs: 1000, multiPv: 3
  })
  const board = parseFen(START_FEN).board
  assert.ok(result.depth > 0)
  assert.ok(result.candidateMoves.length > 0)
  assert.ok(result.principalVariation.length > 0)
  assert.equal(legalMoveCheck(board.grid, board.sideToMove, result.bestMove).ok, true)
  assert.equal(result.incomplete, false)
  const evidence = {
    kind: 'real-bundled-engine-source-acceptance', enginePath,
    sha256: createHash('sha256').update(readFileSync(enginePath)).digest('hex'),
    engineName: result.engineName, userMove: result.userMove, bestMove: result.bestMove,
    depth: result.depth, candidateCount: result.candidateMoves.length,
    principalVariation: result.principalVariation, elapsedMs: Date.now() - started,
    incomplete: result.incomplete, warnings: result.warnings,
    cpuCoverage: 'current host only; no claim of actual execution on a non-AVX2 CPU'
  }
  const outputIndex = process.argv.indexOf('--output')
  if (outputIndex >= 0) writeFileSync(resolve(process.argv[outputIndex + 1]), JSON.stringify(evidence, null, 2))
  console.log(JSON.stringify(evidence, null, 2))
}
main().catch((error) => { console.error(error); process.exitCode = 1 })
