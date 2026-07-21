import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { formatChineseMove } from '../../../src/shared/logic/board/ChineseNotation'
import { parsePlayOkWxf } from '../../../src/shared/logic/board/PlayOkWxf'
import { parseFen } from '../../../src/shared/logic/board/fen'
import { applyUciMove } from '../../../src/shared/logic/board/moves'

interface ManifestGame {
  sourceIndex: number
  sourceUrl: string
  sourcePageSha256: string
  gameId: string
  fixture: string
  halfMoveCount: number
  sha256: string
  abandoned: boolean
  fullyReplayable: boolean
  belowPreferredMinimum: boolean
  aiExplanationSoak: boolean
}

interface SoakManifest {
  schemaVersion: number
  criteria: {
    corpusSize: number
    sourceDistribution: Record<string, number>
    aiExplanationGames: number
  }
  totalHalfMoves: number
  aiExplanationHalfMoves: number
  games: ManifestGame[]
}

interface EngineEvidence {
  status: 'ok' | 'error'
  bestMove: { uci: string; chinese: string } | null
  bestLine: { uci: string[]; chinese: string[] }
  actualLine: { uci: string[]; chinese: string[] }
  bestScore: { type: 'cp' | 'mate'; comparableValue: number } | null
  actualScore: { type: 'cp' | 'mate'; comparableValue: number } | null
  depth: number | null
  analysisTimeMs: number | null
  incomplete: boolean
  error: { code: string; message: string } | null
}

interface PositionEvidence {
  gameId: string
  sourceIndex: number
  ply: number
  preMoveFen: string
  nextFen: string
  actualMove: { uci: string; wxf: string; chinese: string }
  replay: {
    preMoveFenParsed: boolean
    actualMoveLegal: boolean
    reproducedNextFen: boolean
  }
  primary: EngineEvidence
  verification: EngineEvidence
  parallelAnalysisTimeMs: number
  errors: unknown[]
}

interface TimingSummary {
  count: number
  minMs: number
  medianMs: number
  p95Ms: number
  maxMs: number
  within3000Ms: number
}

interface SoakArtifact {
  schemaVersion: number
  status: string
  seed: string
  sourceManifest: string
  sourceManifestSha256: string
  analysisConfig: {
    rootAnalysisMovetimeMs: number
    userMoveEvalMovetimeMs: number
    multiPv: number
  }
  hardWallTimeMs: number
  engines: {
    primary: { binarySha256: string; knownProtocol: string; role: string }
    verification: {
      binarySha256: string
      knownProtocol: string
      role: string
      note: string
    }
  }
  games: ManifestGame[]
  analyzedPositions: number
  totalPositions: number
  positions: PositionEvidence[]
  summary: {
    parseErrors: number
    illegalMoves: number
    engineErrors: number
    overWallTime: number
    completedGames: number
  }
  timing: {
    primary: TimingSummary
    verification: TimingSummary
    parallelComparison: TimingSummary
  }
}

const fixtureDir = new URL('../../fixtures/playok/', import.meta.url)
const manifestRaw = readFileSync(new URL('soak.manifest.json', fixtureDir), 'utf8')
const canonicalManifestRaw = manifestRaw.replace(/\r\n/g, '\n')
const artifactRaw = readFileSync(
  new URL('soak-engine-baseline.json', fixtureDir),
  'utf8'
)
const manifest = JSON.parse(manifestRaw) as SoakManifest
const artifact = JSON.parse(artifactRaw) as SoakArtifact

const expectedGames = new Map([
  ['xq272174077', 153],
  ['xq270018889', 108],
  ['xq270403766', 70],
  ['xq275885193', 35],
  ['xq267431809', 75],
  ['xq267432366', 65],
  ['xq268887284', 18],
  ['xq276129901', 161],
  ['xq276040718', 103],
  ['xq276077323', 37]
])
const expectedAiGames = new Set([
  'xq270018889',
  'xq275885193',
  'xq267431809',
  'xq276040718',
  'xq276077323'
])

assert.equal(manifest.schemaVersion, 1)
assert.equal(manifest.criteria.corpusSize, 10)
assert.deepEqual(manifest.criteria.sourceDistribution, { '1': 4, '2': 3, '3': 3 })
assert.equal(manifest.criteria.aiExplanationGames, 5)
assert.equal(manifest.totalHalfMoves, 825)
assert.equal(manifest.aiExplanationHalfMoves, 358)
assert.equal(manifest.games.length, 10)
assert.deepEqual(
  new Map(manifest.games.map((game) => [game.gameId, game.halfMoveCount])),
  expectedGames
)
assert.deepEqual(
  new Set(
    manifest.games
      .filter((game) => game.aiExplanationSoak)
      .map((game) => game.gameId)
  ),
  expectedAiGames
)
assert.equal(manifest.games.filter((game) => game.belowPreferredMinimum).length, 1)
assert.equal(
  manifest.games.find((game) => game.belowPreferredMinimum)?.gameId,
  'xq268887284'
)

assert.equal(artifact.schemaVersion, 1)
assert.equal(artifact.status, 'complete')
assert.equal(artifact.seed, 'playok-ten-game-soak-v1')
assert.equal(artifact.sourceManifest, 'tests/fixtures/playok/soak.manifest.json')
assert.equal(
  artifact.sourceManifestSha256,
  createHash('sha256').update(canonicalManifestRaw).digest('hex')
)
assert.deepEqual(artifact.analysisConfig, {
  rootAnalysisMovetimeMs: 1100,
  userMoveEvalMovetimeMs: 400,
  multiPv: 3
})
assert.equal(artifact.hardWallTimeMs, 3000)
assert.equal(artifact.engines.primary.role, 'productPrimaryAuthority')
assert.equal(artifact.engines.verification.role, 'acceptanceCrossCheck')
assert.match(artifact.engines.verification.note, /不是產品第二引擎/)
assert.notEqual(
  artifact.engines.primary.binarySha256,
  artifact.engines.verification.binarySha256
)
assert.deepEqual(artifact.games, manifest.games)
assert.equal(artifact.totalPositions, 825)
assert.equal(artifact.analyzedPositions, 825)
assert.equal(artifact.positions.length, 825)
assert.deepEqual(artifact.summary, {
  parseErrors: 0,
  illegalMoves: 0,
  engineErrors: 0,
  overWallTime: 0,
  completedGames: 10
})

for (const game of manifest.games) {
  const fixtureBytes = readFileSync(new URL(game.fixture, fixtureDir))
  assert.equal(
    createHash('sha256').update(fixtureBytes).digest('hex'),
    game.sha256,
    game.gameId
  )
  assert.match(game.sourcePageSha256, /^[a-f0-9]{64}$/)
  assert.equal(game.abandoned, false, game.gameId)
  assert.equal(game.fullyReplayable, true, game.gameId)
  const parsed = parsePlayOkWxf(fixtureBytes.toString('utf8'))
  assert.equal(parsed.valid, true, game.gameId)
  if (!parsed.valid) continue
  assert.equal(parsed.moves.length, game.halfMoveCount, game.gameId)

  const positions = artifact.positions
    .filter((position) => position.gameId === game.gameId)
    .sort((left, right) => left.ply - right.ply)
  assert.equal(positions.length, game.halfMoveCount, game.gameId)
  assert.deepEqual(
    positions.map((position) => position.ply),
    Array.from({ length: game.halfMoveCount }, (_value, index) => index + 1),
    game.gameId
  )

  for (const position of positions) {
    const label = `${game.gameId} ply ${position.ply}`
    const index = position.ply - 1
    assert.equal(position.sourceIndex, game.sourceIndex, label)
    assert.equal(position.preMoveFen, parsed.positions[index].fen, label)
    assert.equal(position.nextFen, parsed.positions[index + 1].fen, label)
    assert.equal(position.actualMove.uci, parsed.moves[index], label)
    assert.equal(position.actualMove.wxf, parsed.displayMoves[index], label)
    assert.deepEqual(position.replay, {
      preMoveFenParsed: true,
      actualMoveLegal: true,
      reproducedNextFen: true
    })

    const parsedFen = parseFen(position.preMoveFen)
    assert.equal(parsedFen.valid, true, label)
    if (!parsedFen.valid) continue
    const applied = applyUciMove(parsedFen.board, position.actualMove.uci)
    assert.equal(applied.valid, true, label)
    if (!applied.valid) continue
    assert.equal(applied.board.fen, position.nextFen, label)
    assert.equal(
      formatChineseMove(parsedFen.board, position.actualMove.uci),
      position.actualMove.chinese,
      label
    )

    for (const engine of [position.primary, position.verification]) {
      assert.equal(engine.status, 'ok', label)
      assert.equal(engine.incomplete, false, label)
      assert.equal(engine.error, null, label)
      assert.ok(engine.bestMove, label)
      assert.ok(engine.bestScore, label)
      assert.ok(engine.actualScore, label)
      assert.ok((engine.depth ?? 0) >= 10, label)
      assert.ok(engine.analysisTimeMs !== null, label)
      assert.equal(engine.bestLine.uci[0], engine.bestMove?.uci, label)
      assert.equal(engine.actualLine.uci[0], position.actualMove.uci, label)
    }
    assert.deepEqual(position.errors, [], label)
    assert.ok(position.parallelAnalysisTimeMs <= artifact.hardWallTimeMs, label)
  }
}

function nearestRank(values: number[], fraction: number): number {
  const sorted = [...values].sort((left, right) => left - right)
  return sorted[Math.max(0, Math.ceil(fraction * sorted.length) - 1)]
}

const wallTimes = artifact.positions.map((position) => position.parallelAnalysisTimeMs)
assert.deepEqual(artifact.timing.parallelComparison, {
  count: 825,
  minMs: Math.min(...wallTimes),
  medianMs: nearestRank(wallTimes, 0.5),
  p95Ms: nearestRank(wallTimes, 0.95),
  maxMs: Math.max(...wallTimes),
  within3000Ms: 825
})
assert.equal(artifact.timing.primary.count, 825)
assert.equal(artifact.timing.verification.count, 825)

const absoluteWindowsPath = /"[A-Za-z]:(?:\\\\|\/)/
const jsonEncodedUncPath = /"\\\\\\\\/
assert.doesNotMatch(manifestRaw, absoluteWindowsPath)
assert.doesNotMatch(artifactRaw, absoluteWindowsPath)
assert.doesNotMatch(manifestRaw, jsonEncodedUncPath)
assert.doesNotMatch(artifactRaw, jsonEncodedUncPath)

console.log('PlayOK 10-game soak artifact tests passed')
