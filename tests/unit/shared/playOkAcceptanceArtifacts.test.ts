import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { formatChineseMove } from '../../../src/shared/logic/board/ChineseNotation'
import { parsePlayOkWxf } from '../../../src/shared/logic/board/PlayOkWxf'
import { parseFen } from '../../../src/shared/logic/board/fen'
import { applyUciMove } from '../../../src/shared/logic/board/moves'

interface MoveEvidence {
  uci: string
  chinese: string
}

interface EngineEvidence {
  status: 'ok' | 'error'
  bestMove: MoveEvidence | null
  bestLine: { uci: string[]; chinese: string[] }
  actualLine: { uci: string[]; chinese: string[] }
  bestScore: { type: 'cp' | 'mate'; comparableValue: number } | null
  actualScore: { type: 'cp' | 'mate'; comparableValue: number } | null
  scoreTypes: { best: 'cp' | 'mate' | null; actual: 'cp' | 'mate' | null }
  evaluationLoss: number | null
  mateTransition: boolean
  depth: number | null
  analysisTimeMs: number | null
  incomplete: boolean
}

interface PositionEvidence {
  gameId: string
  ply: number
  preMoveFen: string
  actualMove: MoveEvidence & { wxf: string }
  primary: EngineEvidence
  verification: EngineEvidence
  parallelAnalysisTimeMs: number
  candidate: {
    eligible: boolean
    reasons: string[]
    selectionHash: string
    selected: boolean
  }
}

interface BaselineArtifact {
  schemaVersion: number
  status: string
  seed: string
  sourceManifest: string
  analysisConfig: {
    rootAnalysisMovetimeMs: number
    userMoveEvalMovetimeMs: number
    multiPv: number
  }
  criteria: {
    excludedOpeningPlies: number
    minimumEvaluationLoss: number
    minimumPrincipalVariationPlies: number
    minimumDepth: number
    positionsPerGame: number
    selectionOrder: string
  }
  games: Array<{
    gameId: string
    fixture: string
    halfMoveCount: number
  }>
  analyzedPositions: number
  totalPositions: number
  positions: PositionEvidence[]
  selection: {
    eligibleCount: number
    selected: Array<{ gameId: string; ply: number; selectionHash: string }>
    shortages: unknown[]
  }
  timing: {
    primary: { count: number; medianMs: number; p95Ms: number; maxMs: number }
    verification: { count: number; medianMs: number; p95Ms: number; maxMs: number }
    parallelComparison: {
      count: number
      medianMs: number
      p95Ms: number
      maxMs: number
      within3000Ms: number
    }
  }
}

interface AcceptanceArtifact {
  schemaVersion: number
  seed: string
  sourceManifest: string
  analysisConfig: BaselineArtifact['analysisConfig']
  criteria: BaselineArtifact['criteria']
  cases: PositionEvidence[]
}

interface SourceManifest {
  sources: Array<{ gameId: string; fixture: string; halfMoveCount: number }>
}

const fixtureDir = new URL('../../fixtures/playok/', import.meta.url)
const baselineRaw = readFileSync(
  new URL('full-engine-baseline.json', fixtureDir),
  'utf8'
)
const casesRaw = readFileSync(new URL('acceptance-cases.json', fixtureDir), 'utf8')
const baseline = JSON.parse(baselineRaw) as BaselineArtifact
const acceptance = JSON.parse(casesRaw) as AcceptanceArtifact
const manifest = JSON.parse(
  readFileSync(new URL('sources.manifest.json', fixtureDir), 'utf8')
) as SourceManifest

assert.equal(baseline.schemaVersion, 1)
assert.equal(baseline.status, 'complete')
assert.equal(baseline.seed, 'playok-one-click-v1')
assert.equal(baseline.sourceManifest, 'tests/fixtures/playok/sources.manifest.json')
assert.deepEqual(baseline.analysisConfig, {
  rootAnalysisMovetimeMs: 1100,
  userMoveEvalMovetimeMs: 400,
  multiPv: 3
})
assert.equal(baseline.totalPositions, 389)
assert.equal(baseline.analyzedPositions, 389)
assert.equal(baseline.positions.length, 389)
assert.deepEqual(
  baseline.games.map((game) => [game.gameId, game.halfMoveCount]),
  [
    ['xq272174077', 153],
    ['xq267431809', 75],
    ['xq276129901', 161]
  ]
)

assert.equal(acceptance.schemaVersion, 1)
assert.equal(acceptance.seed, baseline.seed)
assert.equal(acceptance.sourceManifest, baseline.sourceManifest)
assert.deepEqual(acceptance.analysisConfig, baseline.analysisConfig)
assert.deepEqual(acceptance.criteria, baseline.criteria)
assert.equal(acceptance.cases.length, 6)
assert.equal(baseline.selection.selected.length, 6)
assert.equal(baseline.selection.shortages.length, 0)

const expectedByGame = new Map<string, PositionEvidence[]>()
for (const game of baseline.games) {
  const eligible = baseline.positions
    .filter(
      (position) => position.gameId === game.gameId && position.candidate.eligible
    )
    .sort((left, right) =>
      left.candidate.selectionHash.localeCompare(right.candidate.selectionHash)
    )
  assert.ok(eligible.length >= baseline.criteria.positionsPerGame, game.gameId)
  expectedByGame.set(
    game.gameId,
    eligible.slice(0, baseline.criteria.positionsPerGame)
  )
}

const manifestByGame = new Map(manifest.sources.map((source) => [source.gameId, source]))
for (const [gameId, expected] of expectedByGame) {
  const selected = acceptance.cases.filter((entry) => entry.gameId === gameId)
  assert.equal(selected.length, 2, gameId)
  assert.deepEqual(
    new Set(selected.map((entry) => entry.ply)),
    new Set(expected.map((entry) => entry.ply)),
    `${gameId} 必須採 SHA-256 固定排序的前兩例`
  )
}

for (const entry of acceptance.cases) {
  const label = `${entry.gameId} ply ${entry.ply}`
  assert.ok(entry.candidate.eligible, label)
  assert.ok(entry.candidate.selected, label)
  assert.deepEqual(entry.candidate.reasons, [], label)
  assert.ok(entry.ply > baseline.criteria.excludedOpeningPlies, label)

  assert.equal(entry.primary.status, 'ok', label)
  assert.equal(entry.verification.status, 'ok', label)
  assert.equal(entry.primary.incomplete, false, label)
  assert.equal(entry.verification.incomplete, false, label)
  assert.ok((entry.primary.depth ?? 0) >= baseline.criteria.minimumDepth, label)
  assert.ok((entry.verification.depth ?? 0) >= baseline.criteria.minimumDepth, label)
  assert.ok(entry.primary.bestScore, label)
  assert.ok(entry.primary.actualScore, label)
  assert.ok(entry.verification.bestScore, label)
  assert.ok(entry.verification.actualScore, label)
  assert.equal(entry.primary.scoreTypes.best, entry.primary.bestScore?.type, label)
  assert.equal(entry.primary.scoreTypes.actual, entry.primary.actualScore?.type, label)
  assert.ok(entry.primary.analysisTimeMs !== null, label)
  assert.ok(entry.verification.analysisTimeMs !== null, label)

  assert.ok(entry.primary.bestMove, label)
  assert.notEqual(entry.actualMove.uci, entry.primary.bestMove?.uci, label)
  assert.ok(
    (entry.primary.evaluationLoss ?? Number.NEGATIVE_INFINITY) >=
      baseline.criteria.minimumEvaluationLoss || entry.primary.mateTransition,
    label
  )
  assert.ok(
    entry.primary.bestLine.uci.length >=
      baseline.criteria.minimumPrincipalVariationPlies,
    label
  )
  assert.ok(
    entry.primary.actualLine.uci.length >=
      baseline.criteria.minimumPrincipalVariationPlies,
    label
  )
  assert.ok(
    entry.verification.bestLine.uci.length >=
      baseline.criteria.minimumPrincipalVariationPlies,
    label
  )
  assert.ok(
    entry.verification.actualLine.uci.length >=
      baseline.criteria.minimumPrincipalVariationPlies,
    label
  )

  const parsedFen = parseFen(entry.preMoveFen)
  assert.equal(parsedFen.valid, true, label)
  if (!parsedFen.valid) continue
  assert.equal(applyUciMove(parsedFen.board, entry.actualMove.uci).valid, true, label)
  assert.equal(
    formatChineseMove(parsedFen.board, entry.actualMove.uci),
    entry.actualMove.chinese,
    label
  )

  const source = manifestByGame.get(entry.gameId)
  assert.ok(source, label)
  if (!source) continue
  const fixture = parsePlayOkWxf(
    readFileSync(new URL(source.fixture, fixtureDir), 'utf8')
  )
  assert.equal(fixture.valid, true, label)
  if (!fixture.valid) continue
  assert.equal(fixture.positions[entry.ply - 1]?.fen, entry.preMoveFen, label)
  assert.equal(fixture.moves[entry.ply - 1], entry.actualMove.uci, label)
  assert.equal(fixture.displayMoves[entry.ply - 1], entry.actualMove.wxf, label)
}

assert.equal(baseline.timing.primary.count, 389)
assert.equal(baseline.timing.verification.count, 389)
assert.equal(baseline.timing.parallelComparison.count, 389)
assert.equal(baseline.timing.parallelComparison.within3000Ms, 389)
assert.ok(baseline.timing.parallelComparison.medianMs <= 3000)
assert.ok(baseline.timing.parallelComparison.p95Ms <= 3000)
assert.ok(baseline.timing.parallelComparison.maxMs <= 3000)
assert.ok(baseline.positions.every((entry) => entry.parallelAnalysisTimeMs <= 3000))

const absoluteWindowsPath = /"[A-Za-z]:(?:\\\\|\/)/
const jsonEncodedUncPath = /"\\\\\\\\/
assert.doesNotMatch(baselineRaw, absoluteWindowsPath)
assert.doesNotMatch(casesRaw, absoluteWindowsPath)
assert.doesNotMatch(baselineRaw, jsonEncodedUncPath)
assert.doesNotMatch(casesRaw, jsonEncodedUncPath)

console.log('PlayOK acceptance artifact tests passed')
