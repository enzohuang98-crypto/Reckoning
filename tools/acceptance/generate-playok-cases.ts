import { createHash } from 'node:crypto'
import {
  existsSync,
  readFileSync,
  renameSync,
  statSync,
  writeFileSync
} from 'node:fs'
import { basename, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  EngineAnalysisError,
  PikafishAdapter
} from '../../src/main/engine/PikafishAdapter'
import { formatChineseMove } from '../../src/shared/logic/board/ChineseNotation'
import { parsePlayOkWxf } from '../../src/shared/logic/board/PlayOkWxf'
import type { BoardState } from '../../src/shared/types/BoardState'
import type {
  AnalysisConfig,
  EngineAnalysis,
  EngineScore
} from '../../src/shared/types/EngineAnalysis'

const DEFAULT_SEED = 'playok-one-click-v1'
const CONFIG: AnalysisConfig = {
  rootAnalysisMovetimeMs: 1100,
  userMoveEvalMovetimeMs: 400,
  multiPv: 3
}
const EXCLUDED_OPENING_PLIES = 16
const MINIMUM_LOSS = 0.5
const MINIMUM_PV_PLIES = 4
const MINIMUM_DEPTH = 10

const repoRoot = fileURLToPath(new URL('../../', import.meta.url))
const fixtureDir = resolve(repoRoot, 'tests', 'fixtures', 'playok')
const manifestPath = resolve(fixtureDir, 'sources.manifest.json')
const baselinePath = resolve(fixtureDir, 'full-engine-baseline.json')
const casesPath = resolve(fixtureDir, 'acceptance-cases.json')

interface CliOptions {
  primary: string
  verification: string
  seed: string
}

interface SourceManifestEntry {
  sourceUrl: string
  gameId: string
  fixture: string
  result: string
  halfMoveCount: number
  sha256: string
  selectionReason: string
  selected?: boolean
}

interface SourceManifest {
  schemaVersion: number
  capturedAt: string
  sources: SourceManifestEntry[]
}

interface ScoreEvidence {
  type: EngineScore['type']
  comparableValue: number
  displayText: string
  source: EngineScore['source']
  cp?: number
  mateIn?: number
}

interface MoveEvidence {
  uci: string
  chinese: string
}

interface VariationEvidence {
  uci: string[]
  chinese: string[]
}

interface RecordedError {
  code: string
  message: string
}

interface EngineEvidence {
  status: 'ok' | 'error'
  engineName: string | null
  bestMove: MoveEvidence | null
  bestLine: VariationEvidence
  actualLine: VariationEvidence
  bestScore: ScoreEvidence | null
  actualScore: ScoreEvidence | null
  scoreTypes: {
    best: EngineScore['type'] | null
    actual: EngineScore['type'] | null
  }
  evaluationLoss: number | null
  mateTransition: boolean
  depth: number | null
  analysisTimeMs: number | null
  incomplete: boolean
  warnings: string[]
  error: RecordedError | null
}

interface CandidateEvidence {
  eligible: boolean
  reasons: string[]
  selectionHash: string
  selected: boolean
}

interface PositionEvidence {
  gameId: string
  ply: number
  preMoveFen: string
  actualMove: MoveEvidence & { wxf: string }
  primary: EngineEvidence
  verification: EngineEvidence
  parallelAnalysisTimeMs: number
  divergence: {
    bestMove: boolean | null
    scoreType: boolean | null
    evaluationLoss: number | null
    hasError: boolean
  }
  errors: Array<RecordedError & { engine: 'primary' | 'verification' }>
  candidate: CandidateEvidence
}

interface ParsedSource {
  source: SourceManifestEntry
  moves: string[]
  displayMoves: string[]
  positions: BoardState[]
}

interface TimingSummary {
  count: number
  minMs: number | null
  medianMs: number | null
  p95Ms: number | null
  maxMs: number | null
  within3000Ms: number
  within3000Rate: number | null
}

interface BaselineArtifact {
  schemaVersion: 1
  status: 'in_progress' | 'complete' | 'analysis_complete_selection_failed'
  generatedAt: string
  seed: string
  runKey: string
  sourceManifest: string
  sourceManifestSha256: string
  analysisConfig: AnalysisConfig
  criteria: {
    excludedOpeningPlies: number
    minimumEvaluationLoss: number
    minimumPrincipalVariationPlies: number
    minimumDepth: number
    positionsPerGame: number
    selectionOrder: string
  }
  engines: {
    primary: { binarySha256: string; knownProtocol: 'uci' }
    verification: { binarySha256: string; knownProtocol: 'uci' }
  }
  games: Array<{
    gameId: string
    sourceUrl: string
    fixture: string
    result: string
    halfMoveCount: number
  }>
  analyzedPositions: number
  totalPositions: number
  positions: PositionEvidence[]
  selection: {
    eligibleCount: number
    selected: Array<{ gameId: string; ply: number; selectionHash: string }>
    shortages: Array<{ gameId: string; eligibleCount: number }>
  }
  timing: {
    primary: TimingSummary
    verification: TimingSummary
    parallelComparison: TimingSummary
  }
}

function usage(): string {
  return [
    'Usage:',
    '  npx tsx --tsconfig tsconfig.node.json tools/acceptance/generate-playok-cases.ts \\',
    '    --primary <pikafish.exe> --verification <pikafish.exe> [--seed <seed>]',
    '',
    `Default seed: ${DEFAULT_SEED}`
  ].join('\n')
}

function parseArgs(argv: string[]): CliOptions {
  if (argv.includes('--help') || argv.includes('-h')) {
    console.log(usage())
    process.exit(0)
  }
  const values = new Map<string, string>()
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index]
    const value = argv[index + 1]
    if (!key?.startsWith('--') || !value || value.startsWith('--')) {
      throw new Error(`無效參數：${key ?? '(空)'}\n${usage()}`)
    }
    if (!['--primary', '--verification', '--seed'].includes(key)) {
      throw new Error(`不支援參數：${key}\n${usage()}`)
    }
    values.set(key, value)
  }
  const primary = values.get('--primary')
  const verification = values.get('--verification')
  if (!primary || !verification) {
    throw new Error(`--primary 與 --verification 都是必要參數。\n${usage()}`)
  }
  return {
    primary: resolve(primary),
    verification: resolve(verification),
    seed: values.get('--seed') ?? DEFAULT_SEED
  }
}

function sha256Bytes(bytes: Buffer | string): string {
  return createHash('sha256').update(bytes).digest('hex')
}

function assertEngineFile(path: string, label: string): void {
  if (!existsSync(path) || !statSync(path).isFile()) {
    throw new Error(`${label} 引擎檔不存在或不是一般檔案。`)
  }
}

function writeJsonAtomic(path: string, value: unknown): void {
  const temporaryPath = `${path}.tmp`
  writeFileSync(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
  renameSync(temporaryPath, path)
}

function selectedSources(manifest: SourceManifest): SourceManifestEntry[] {
  const explicit = manifest.sources.filter((source) => source.selected === true)
  const selected = explicit.length > 0
    ? explicit
    : manifest.sources.filter(
        (source) => source.selectionReason === 'longest qualifying'
      )
  if (selected.length !== 3) {
    throw new Error(`來源 manifest 必須恰好選定 3 局，目前為 ${selected.length} 局。`)
  }
  if (new Set(selected.map((source) => source.sourceUrl)).size !== 3) {
    throw new Error('選定的 3 局必須分別來自 3 個不同來源。')
  }
  return selected
}

function parseSources(sources: SourceManifestEntry[]): ParsedSource[] {
  return sources.map((source) => {
    const fixturePath = resolve(fixtureDir, basename(source.fixture))
    const bytes = readFileSync(fixturePath)
    if (sha256Bytes(bytes) !== source.sha256) {
      throw new Error(`${source.gameId} fixture SHA-256 與 manifest 不一致。`)
    }
    const parsed = parsePlayOkWxf(bytes.toString('utf8'))
    if (!parsed.valid) {
      throw new Error(`${source.gameId} 無法完整還原：${parsed.message}`)
    }
    if (parsed.moves.length !== source.halfMoveCount) {
      throw new Error(
        `${source.gameId} 半回合數不一致：manifest=${source.halfMoveCount}, parsed=${parsed.moves.length}`
      )
    }
    return {
      source,
      moves: parsed.moves,
      displayMoves: parsed.displayMoves,
      positions: parsed.positions
    }
  })
}

function scoreEvidence(score: EngineScore | null): ScoreEvidence | null {
  if (!score) return null
  return score.type === 'cp'
    ? {
        type: score.type,
        cp: score.cp,
        comparableValue: score.comparableValue,
        displayText: score.displayText,
        source: score.source
      }
    : {
        type: score.type,
        mateIn: score.mateIn,
        comparableValue: score.comparableValue,
        displayText: score.displayText,
        source: score.source
      }
}

function losingMate(score: EngineScore | null): boolean {
  return score?.type === 'mate' && score.comparableValue < 0
}

function evaluationLoss(analysis: EngineAnalysis): number | null {
  const best = analysis.scoreAfterBestMove?.comparableValue
  const actual = analysis.scoreAfterUserMove?.comparableValue
  if (!Number.isFinite(best) || !Number.isFinite(actual)) return null
  return (best as number) - (actual as number)
}

function successfulEvidence(analysis: EngineAnalysis): EngineEvidence {
  const loss = evaluationLoss(analysis)
  const missingActualScore = analysis.scoreAfterUserMove === null
  return {
    status: 'ok',
    engineName: analysis.engineName || null,
    bestMove: {
      uci: analysis.bestMove,
      chinese: analysis.displayBestMove ?? '無法辨識著法'
    },
    bestLine: {
      uci: [...analysis.principalVariation],
      chinese: [...(analysis.displayPrincipalVariation ?? [])]
    },
    actualLine: {
      uci: [...(analysis.userMovePrincipalVariation ?? [])],
      chinese: [...(analysis.displayUserMovePrincipalVariation ?? [])]
    },
    bestScore: scoreEvidence(analysis.scoreAfterBestMove),
    actualScore: scoreEvidence(analysis.scoreAfterUserMove),
    scoreTypes: {
      best: analysis.scoreAfterBestMove?.type ?? null,
      actual: analysis.scoreAfterUserMove?.type ?? null
    },
    evaluationLoss: loss,
    mateTransition:
      analysis.scoreAfterBestMove?.type !== 'mate' &&
      losingMate(analysis.scoreAfterUserMove),
    depth: analysis.depth,
    analysisTimeMs: analysis.analysisTimeMs ?? null,
    incomplete: analysis.incomplete,
    warnings: [...analysis.warnings],
    error: missingActualScore
      ? {
          code: 'actual_move_score_unavailable',
          message: '引擎未提供實戰步的可比較分數。'
        }
      : null
  }
}

function redactPaths(message: string, paths: string[]): string {
  return paths.reduce(
    (result, path) => result.replaceAll(path, '[engine-path]'),
    message
  )
}

function failedEvidence(reason: unknown, paths: string[]): EngineEvidence {
  const message = redactPaths(
    reason instanceof Error ? reason.message : String(reason),
    paths
  )
  return {
    status: 'error',
    engineName: null,
    bestMove: null,
    bestLine: { uci: [], chinese: [] },
    actualLine: { uci: [], chinese: [] },
    bestScore: null,
    actualScore: null,
    scoreTypes: { best: null, actual: null },
    evaluationLoss: null,
    mateTransition: false,
    depth: null,
    analysisTimeMs: null,
    incomplete: true,
    warnings: [],
    error: {
      code: reason instanceof EngineAnalysisError ? reason.code : 'analysis_failed',
      message
    }
  }
}

function eligibilityReasons(
  role: 'primary' | 'verification',
  actualMove: string,
  evidence: EngineEvidence
): string[] {
  const reasons: string[] = []
  if (evidence.status === 'error') reasons.push(`${role}:analysis_error`)
  if (!evidence.bestMove) reasons.push(`${role}:missing_best_move`)
  else if (role === 'primary' && evidence.bestMove.uci === actualMove) {
    reasons.push(`${role}:actual_is_best`)
  }
  if (evidence.bestScore === null) reasons.push(`${role}:missing_best_score`)
  if (evidence.actualScore === null) reasons.push(`${role}:missing_actual_score`)
  if (
    role === 'primary' &&
    evidence.evaluationLoss !== null &&
    evidence.evaluationLoss < MINIMUM_LOSS &&
    !evidence.mateTransition
  ) {
    reasons.push(`${role}:loss_below_threshold`)
  }
  if (
    role === 'primary' &&
    evidence.evaluationLoss === null &&
    !evidence.mateTransition
  ) {
    reasons.push(`${role}:missing_evaluation_loss`)
  }
  if (evidence.bestLine.uci.length < MINIMUM_PV_PLIES) {
    reasons.push(`${role}:best_pv_too_short`)
  }
  if (evidence.actualLine.uci.length < MINIMUM_PV_PLIES) {
    reasons.push(`${role}:actual_pv_too_short`)
  }
  if (evidence.incomplete) reasons.push(`${role}:incomplete`)
  if (evidence.depth === null || evidence.depth < MINIMUM_DEPTH) {
    reasons.push(`${role}:depth_below_minimum`)
  }
  return reasons
}

function selectionHash(seed: string, gameId: string, ply: number): string {
  return sha256Bytes(`${seed}:${gameId}:${ply}`)
}

function percentile(values: number[], fraction: number): number | null {
  if (values.length === 0) return null
  const sorted = [...values].sort((left, right) => left - right)
  const index = Math.max(0, Math.ceil(fraction * sorted.length) - 1)
  return sorted[index]
}

function timingSummary(values: Array<number | null>): TimingSummary {
  const present = values.filter((value): value is number => value !== null)
  if (present.length === 0) {
    return {
      count: 0,
      minMs: null,
      medianMs: null,
      p95Ms: null,
      maxMs: null,
      within3000Ms: 0,
      within3000Rate: null
    }
  }
  return {
    count: present.length,
    minMs: Math.min(...present),
    medianMs: percentile(present, 0.5),
    p95Ms: percentile(present, 0.95),
    maxMs: Math.max(...present),
    within3000Ms: present.filter((value) => value <= 3000).length,
    within3000Rate:
      present.filter((value) => value <= 3000).length / present.length
  }
}

function emptySelection(): BaselineArtifact['selection'] {
  return { eligibleCount: 0, selected: [], shortages: [] }
}

function artifact(
  status: BaselineArtifact['status'],
  generatedAt: string,
  seed: string,
  runKey: string,
  manifestSha256: string,
  primarySha256: string,
  verificationSha256: string,
  sources: SourceManifestEntry[],
  positions: PositionEvidence[],
  totalPositions: number,
  selection: BaselineArtifact['selection'] = emptySelection()
): BaselineArtifact {
  return {
    schemaVersion: 1,
    status,
    generatedAt,
    seed,
    runKey,
    sourceManifest: 'tests/fixtures/playok/sources.manifest.json',
    sourceManifestSha256: manifestSha256,
    analysisConfig: CONFIG,
    criteria: {
      excludedOpeningPlies: EXCLUDED_OPENING_PLIES,
      minimumEvaluationLoss: MINIMUM_LOSS,
      minimumPrincipalVariationPlies: MINIMUM_PV_PLIES,
      minimumDepth: MINIMUM_DEPTH,
      positionsPerGame: 2,
      selectionOrder: 'SHA-256(seed:gameId:ply), ascending'
    },
    engines: {
      primary: { binarySha256: primarySha256, knownProtocol: 'uci' },
      verification: {
        binarySha256: verificationSha256,
        knownProtocol: 'uci'
      }
    },
    games: sources.map((source) => ({
      gameId: source.gameId,
      sourceUrl: source.sourceUrl,
      fixture: source.fixture,
      result: source.result,
      halfMoveCount: source.halfMoveCount
    })),
    analyzedPositions: positions.length,
    totalPositions,
    positions,
    selection,
    timing: {
      primary: timingSummary(
        positions.map((position) => position.primary.analysisTimeMs)
      ),
      verification: timingSummary(
        positions.map((position) => position.verification.analysisTimeMs)
      ),
      parallelComparison: timingSummary(
        positions.map((position) => position.parallelAnalysisTimeMs)
      )
    }
  }
}

function loadResumePositions(runKey: string): {
  generatedAt: string
  positions: PositionEvidence[]
} | null {
  if (!existsSync(baselinePath)) return null
  try {
    const existing = JSON.parse(
      readFileSync(baselinePath, 'utf8')
    ) as Partial<BaselineArtifact>
    if (
      existing.schemaVersion !== 1 ||
      existing.status !== 'in_progress' ||
      existing.runKey !== runKey ||
      !Array.isArray(existing.positions) ||
      typeof existing.generatedAt !== 'string'
    ) {
      return null
    }
    return { generatedAt: existing.generatedAt, positions: existing.positions }
  } catch {
    return null
  }
}

function selectCases(
  positions: PositionEvidence[],
  gameIds: string[]
): BaselineArtifact['selection'] {
  const selected: BaselineArtifact['selection']['selected'] = []
  const shortages: BaselineArtifact['selection']['shortages'] = []
  for (const gameId of gameIds) {
    const eligible = positions
      .filter(
        (position) =>
          position.gameId === gameId && position.candidate.eligible
      )
      .sort((left, right) =>
        left.candidate.selectionHash.localeCompare(right.candidate.selectionHash)
      )
    if (eligible.length < 2) {
      shortages.push({ gameId, eligibleCount: eligible.length })
    }
    for (const position of eligible.slice(0, 2)) {
      position.candidate.selected = true
      selected.push({
        gameId,
        ply: position.ply,
        selectionHash: position.candidate.selectionHash
      })
    }
  }
  return {
    eligibleCount: positions.filter((position) => position.candidate.eligible).length,
    selected,
    shortages
  }
}

function validateCompleteArtifacts(
  baseline: BaselineArtifact,
  cases: PositionEvidence[]
): void {
  if (baseline.status !== 'complete') throw new Error('baseline 尚未完成。')
  if (baseline.positions.length !== baseline.totalPositions) {
    throw new Error('baseline 沒有涵蓋全部實戰步。')
  }
  if (cases.length !== 6) throw new Error(`固定案例必須為 6，實際為 ${cases.length}。`)
  for (const game of baseline.games) {
    if (cases.filter((entry) => entry.gameId === game.gameId).length !== 2) {
      throw new Error(`${game.gameId} 固定案例不是 2 個。`)
    }
  }
  for (const entry of cases) {
    if (!entry.candidate.eligible || !entry.candidate.selected) {
      throw new Error(`${entry.gameId} ply ${entry.ply} 並非合格且選中的案例。`)
    }
    if (entry.ply <= EXCLUDED_OPENING_PLIES) {
      throw new Error(`${entry.gameId} ply ${entry.ply} 位於排除的開局範圍。`)
    }
  }
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2))
  assertEngineFile(options.primary, 'primary')
  assertEngineFile(options.verification, 'verification')

  const manifestBytes = readFileSync(manifestPath)
  const manifest = JSON.parse(manifestBytes.toString('utf8')) as SourceManifest
  const sources = selectedSources(manifest)
  const parsedSources = parseSources(sources)
  const totalPositions = parsedSources.reduce(
    (sum, parsed) => sum + parsed.moves.length,
    0
  )
  const primarySha256 = sha256Bytes(readFileSync(options.primary))
  const verificationSha256 = sha256Bytes(readFileSync(options.verification))
  const manifestSha256 = sha256Bytes(manifestBytes)
  const runKey = sha256Bytes(
    JSON.stringify({
      seed: options.seed,
      manifestSha256,
      primarySha256,
      verificationSha256,
      config: CONFIG
    })
  )
  const resume = loadResumePositions(runKey)
  const generatedAt = resume?.generatedAt ?? new Date().toISOString()
  const positions = resume?.positions ?? []
  const completed = new Set(
    positions.map((position) => `${position.gameId}:${position.ply}`)
  )

  const primaryAdapter = new PikafishAdapter(
    options.primary,
    'uci',
    'Pikafish primary',
    'primary'
  )
  const verificationAdapter = new PikafishAdapter(
    options.verification,
    'uci',
    'Pikafish verification',
    'verification'
  )
  const [primaryTest, verificationTest] = await Promise.all([
    primaryAdapter.test(),
    verificationAdapter.test()
  ])
  if (!primaryTest.ok || !verificationTest.ok) {
    throw new Error(
      `引擎自我測試失敗：primary=${primaryTest.ok}, verification=${verificationTest.ok}`
    )
  }

  console.log(
    `PlayOK 全盤抽樣：${sources.length} 局，${totalPositions} 個走前局面，seed=${options.seed}`
  )
  console.log(
    `引擎設定：root=${CONFIG.rootAnalysisMovetimeMs}ms, actual=${CONFIG.userMoveEvalMovetimeMs}ms, MultiPV=${CONFIG.multiPv}`
  )
  if (positions.length > 0) console.log(`續跑既有 checkpoint：${positions.length}/${totalPositions}`)

  const redactedPaths = [options.primary, options.verification]
  for (const parsed of parsedSources) {
    for (let index = 0; index < parsed.moves.length; index += 1) {
      const ply = index + 1
      const key = `${parsed.source.gameId}:${ply}`
      if (completed.has(key)) continue

      const actualUci = parsed.moves[index]
      const actualWxf = parsed.displayMoves[index]
      const preMoveBoard = parsed.positions[index]
      const actualChinese =
        formatChineseMove(preMoveBoard, actualUci) ?? '無法辨識著法'
      const startedAt = Date.now()
      const [primaryResult, verificationResult] = await Promise.allSettled([
        primaryAdapter.analyzePosition(
          { positionFen: preMoveBoard.fen, userMove: actualUci },
          CONFIG
        ),
        verificationAdapter.analyzePosition(
          { positionFen: preMoveBoard.fen, userMove: actualUci },
          CONFIG
        )
      ])
      const parallelAnalysisTimeMs = Date.now() - startedAt
      const primary =
        primaryResult.status === 'fulfilled'
          ? successfulEvidence(primaryResult.value)
          : failedEvidence(primaryResult.reason, redactedPaths)
      const verification =
        verificationResult.status === 'fulfilled'
          ? successfulEvidence(verificationResult.value)
          : failedEvidence(verificationResult.reason, redactedPaths)
      const reasons = ply <= EXCLUDED_OPENING_PLIES
        ? ['opening_ply_excluded']
        : [
            ...eligibilityReasons('primary', actualUci, primary),
            ...eligibilityReasons('verification', actualUci, verification)
          ]
      const errors: PositionEvidence['errors'] = []
      if (primary.error) errors.push({ engine: 'primary', ...primary.error })
      if (verification.error) {
        errors.push({ engine: 'verification', ...verification.error })
      }
      const record: PositionEvidence = {
        gameId: parsed.source.gameId,
        ply,
        preMoveFen: preMoveBoard.fen,
        actualMove: {
          uci: actualUci,
          wxf: actualWxf,
          chinese: actualChinese
        },
        primary,
        verification,
        parallelAnalysisTimeMs,
        divergence: {
          bestMove:
            primary.bestMove && verification.bestMove
              ? primary.bestMove.uci !== verification.bestMove.uci
              : null,
          scoreType:
            primary.bestScore && verification.bestScore
              ? primary.bestScore.type !== verification.bestScore.type
              : null,
          evaluationLoss:
            primary.evaluationLoss !== null &&
            verification.evaluationLoss !== null
              ? Math.abs(primary.evaluationLoss - verification.evaluationLoss)
              : null,
          hasError: errors.length > 0
        },
        errors,
        candidate: {
          eligible: reasons.length === 0,
          reasons,
          selectionHash: selectionHash(options.seed, parsed.source.gameId, ply),
          selected: false
        }
      }
      positions.push(record)
      completed.add(key)

      const done = positions.length
      const marker = record.candidate.eligible ? ' candidate' : ''
      console.log(
        `[${done}/${totalPositions}] ${record.gameId} ply ${ply} ${parallelAnalysisTimeMs}ms${marker}`
      )
      if (done % 5 === 0 || done === totalPositions) {
        writeJsonAtomic(
          baselinePath,
          artifact(
            'in_progress',
            generatedAt,
            options.seed,
            runKey,
            manifestSha256,
            primarySha256,
            verificationSha256,
            sources,
            positions,
            totalPositions
          )
        )
      }
    }
  }

  positions.sort(
    (left, right) =>
      sources.findIndex((source) => source.gameId === left.gameId) -
        sources.findIndex((source) => source.gameId === right.gameId) ||
      left.ply - right.ply
  )
  const selection = selectCases(
    positions,
    sources.map((source) => source.gameId)
  )
  const status: BaselineArtifact['status'] =
    selection.shortages.length === 0 && selection.selected.length === 6
      ? 'complete'
      : 'analysis_complete_selection_failed'
  const baseline = artifact(
    status,
    generatedAt,
    options.seed,
    runKey,
    manifestSha256,
    primarySha256,
    verificationSha256,
    sources,
    positions,
    totalPositions,
    selection
  )
  writeJsonAtomic(baselinePath, baseline)

  if (status !== 'complete') {
    throw new Error(
      `候選不足：${selection.shortages
        .map((shortage) => `${shortage.gameId}=${shortage.eligibleCount}`)
        .join(', ')}`
    )
  }

  const selectedKeys = new Set(
    selection.selected.map((entry) => `${entry.gameId}:${entry.ply}`)
  )
  const cases = positions.filter((position) =>
    selectedKeys.has(`${position.gameId}:${position.ply}`)
  )
  validateCompleteArtifacts(baseline, cases)
  writeJsonAtomic(casesPath, {
    schemaVersion: 1,
    generatedAt,
    seed: options.seed,
    sourceManifest: baseline.sourceManifest,
    sourceManifestSha256: manifestSha256,
    analysisConfig: CONFIG,
    criteria: baseline.criteria,
    cases,
    timing: {
      allPositions: baseline.timing,
      selectedCases: {
        primary: timingSummary(cases.map((entry) => entry.primary.analysisTimeMs)),
        verification: timingSummary(
          cases.map((entry) => entry.verification.analysisTimeMs)
        ),
        parallelComparison: timingSummary(
          cases.map((entry) => entry.parallelAnalysisTimeMs)
        )
      }
    }
  })

  console.log(`完成：${positions.length} 個走前局面，${cases.length} 個固定案例。`)
  console.log(
    `並行比較耗時：median=${baseline.timing.parallelComparison.medianMs}ms, p95=${baseline.timing.parallelComparison.p95Ms}ms, <=3s=${baseline.timing.parallelComparison.within3000Ms}/${baseline.timing.parallelComparison.count}`
  )
  console.log(
    `案例：${cases.map((entry) => `${entry.gameId}#${entry.ply}`).join(', ')}`
  )
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error)
  console.error(`PlayOK 抽樣失敗：${message}`)
  process.exitCode = 1
})
