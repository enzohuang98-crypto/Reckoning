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
import { applyUciMove } from '../../src/shared/logic/board/moves'
import type { BoardState } from '../../src/shared/types/BoardState'
import type {
  AnalysisConfig,
  EngineAnalysis,
  EngineScore
} from '../../src/shared/types/EngineAnalysis'

const CONFIG: AnalysisConfig = {
  rootAnalysisMovetimeMs: 1100,
  userMoveEvalMovetimeMs: 400,
  multiPv: 3
}
const MAX_WALL_TIME_MS = 3000
const DEFAULT_SEED = 'playok-ten-game-soak-v1'
const repoRoot = fileURLToPath(new URL('../../', import.meta.url))
const fixtureDir = resolve(repoRoot, 'tests', 'fixtures', 'playok')
const manifestPath = resolve(fixtureDir, 'soak.manifest.json')
const outputPath = resolve(fixtureDir, 'soak-engine-baseline.json')

interface CliOptions {
  primary: string
  verification: string
  seed: string
}

interface ManifestGame {
  sourceIndex: number
  sourceUrl: string
  sourcePageSha256: string
  gameId: string
  fixture: string
  result: string
  halfMoveCount: number
  sha256: string
  abandoned: boolean
  fullyReplayable: boolean
  belowPreferredMinimum: boolean
  aiExplanationSoak: boolean
}

interface SoakManifest {
  schemaVersion: number
  totalHalfMoves: number
  aiExplanationHalfMoves: number
  games: ManifestGame[]
}

interface ScoreEvidence {
  type: 'cp' | 'mate'
  comparableValue: number
  displayText: string
  cp?: number
  mateIn?: number
}

interface EngineEvidence {
  status: 'ok' | 'error'
  engineName: string | null
  bestMove: { uci: string; chinese: string } | null
  bestLine: { uci: string[]; chinese: string[] }
  actualLine: { uci: string[]; chinese: string[] }
  bestScore: ScoreEvidence | null
  actualScore: ScoreEvidence | null
  evaluationLoss: number | null
  depth: number | null
  analysisTimeMs: number | null
  incomplete: boolean
  warnings: string[]
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
    preMoveFenParsed: true
    actualMoveLegal: true
    reproducedNextFen: true
  }
  primary: EngineEvidence
  verification: EngineEvidence
  parallelAnalysisTimeMs: number
  divergence: {
    bestMove: boolean | null
    scoreType: boolean | null
    evaluationLoss: number | null
  }
  errors: Array<{ engine: 'primary' | 'verification'; code: string; message: string }>
}

interface TimingSummary {
  count: number
  minMs: number | null
  medianMs: number | null
  p95Ms: number | null
  maxMs: number | null
  within3000Ms: number
}

interface SoakArtifact {
  schemaVersion: 1
  status: 'in_progress' | 'complete' | 'complete_with_failures'
  generatedAt: string
  seed: string
  runKey: string
  sourceManifest: string
  sourceManifestSha256: string
  analysisConfig: AnalysisConfig
  hardWallTimeMs: number
  engines: {
    primary: {
      binarySha256: string
      knownProtocol: 'uci'
      role: 'productPrimaryAuthority'
    }
    verification: {
      binarySha256: string
      knownProtocol: 'uci'
      role: 'acceptanceCrossCheck'
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

interface ParsedGame {
  manifest: ManifestGame
  moves: string[]
  displayMoves: string[]
  positions: BoardState[]
}

function usage(): string {
  return [
    'Usage:',
    '  tsx tools/acceptance/generate-playok-soak.ts --primary <exe> --verification <exe> [--seed <seed>]',
    `Default seed: ${DEFAULT_SEED}`
  ].join('\n')
}

function parseArgs(args: string[]): CliOptions {
  if (args.includes('--help') || args.includes('-h')) {
    console.log(usage())
    process.exit(0)
  }
  const values = new Map<string, string>()
  for (let index = 0; index < args.length; index += 2) {
    const key = args[index]
    const value = args[index + 1]
    if (!key?.startsWith('--') || !value || value.startsWith('--')) {
      throw new Error(`無效參數：${key ?? '(空)'}\n${usage()}`)
    }
    if (!['--primary', '--verification', '--seed'].includes(key)) {
      throw new Error(`不支援參數：${key}`)
    }
    values.set(key, value)
  }
  const primary = values.get('--primary')
  const verification = values.get('--verification')
  if (!primary || !verification) throw new Error('--primary 與 --verification 為必要參數。')
  return {
    primary: resolve(primary),
    verification: resolve(verification),
    seed: values.get('--seed') ?? DEFAULT_SEED
  }
}

function sha256(value: Buffer | string): string {
  return createHash('sha256').update(value).digest('hex')
}

function assertEngineFile(path: string, label: string): void {
  if (!existsSync(path) || !statSync(path).isFile()) {
    throw new Error(`${label} 引擎不存在或不是一般檔案。`)
  }
}

function writeJsonAtomic(path: string, value: unknown): void {
  const temporary = `${path}.tmp`
  writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
  renameSync(temporary, path)
}

function parseGames(manifest: SoakManifest): ParsedGame[] {
  if (manifest.schemaVersion !== 1 || manifest.games.length !== 10) {
    throw new Error('soak manifest 必須是 schemaVersion 1 且恰好 10 局。')
  }
  if (new Set(manifest.games.map((game) => game.gameId)).size !== 10) {
    throw new Error('soak manifest 含重複 gameId。')
  }
  return manifest.games.map((game) => {
    if (game.abandoned || !game.fullyReplayable) {
      throw new Error(`${game.gameId} 未通過非放棄／完整還原條件。`)
    }
    const path = resolve(fixtureDir, basename(game.fixture))
    const bytes = readFileSync(path)
    if (sha256(bytes) !== game.sha256) throw new Error(`${game.gameId} fixture hash 不符。`)
    const parsed = parsePlayOkWxf(bytes.toString('utf8'))
    if (!parsed.valid) throw new Error(`${game.gameId} 解析失敗：${parsed.message}`)
    if (parsed.moves.length !== game.halfMoveCount) {
      throw new Error(`${game.gameId} halfMoveCount 不符。`)
    }
    for (let index = 0; index < parsed.moves.length; index += 1) {
      const applied = applyUciMove(parsed.positions[index], parsed.moves[index])
      if (!applied.valid) {
        throw new Error(`${game.gameId} ply ${index + 1} 非法：${applied.message}`)
      }
      if (applied.board.fen !== parsed.positions[index + 1].fen) {
        throw new Error(`${game.gameId} ply ${index + 1} next FEN 無法重現。`)
      }
    }
    return {
      manifest: game,
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
        displayText: score.displayText
      }
    : {
        type: score.type,
        mateIn: score.mateIn,
        comparableValue: score.comparableValue,
        displayText: score.displayText
      }
}

function evaluationLoss(analysis: EngineAnalysis): number | null {
  const best = analysis.scoreAfterBestMove?.comparableValue
  const actual = analysis.scoreAfterUserMove?.comparableValue
  return Number.isFinite(best) && Number.isFinite(actual)
    ? (best as number) - (actual as number)
    : null
}

function successfulEvidence(analysis: EngineAnalysis): EngineEvidence {
  const missingScore = !analysis.scoreAfterBestMove || !analysis.scoreAfterUserMove
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
    evaluationLoss: evaluationLoss(analysis),
    depth: analysis.depth,
    analysisTimeMs: analysis.analysisTimeMs ?? null,
    incomplete: analysis.incomplete,
    warnings: [...analysis.warnings],
    error: missingScore
      ? { code: 'missing_score', message: '引擎未提供可比較的最佳步或實戰步分數。' }
      : null
  }
}

function redact(message: string, paths: string[]): string {
  return paths.reduce((current, path) => current.replaceAll(path, '[engine-path]'), message)
}

function failedEvidence(reason: unknown, paths: string[]): EngineEvidence {
  return {
    status: 'error',
    engineName: null,
    bestMove: null,
    bestLine: { uci: [], chinese: [] },
    actualLine: { uci: [], chinese: [] },
    bestScore: null,
    actualScore: null,
    evaluationLoss: null,
    depth: null,
    analysisTimeMs: null,
    incomplete: true,
    warnings: [],
    error: {
      code: reason instanceof EngineAnalysisError ? reason.code : 'analysis_failed',
      message: redact(reason instanceof Error ? reason.message : String(reason), paths)
    }
  }
}

function percentile(values: number[], fraction: number): number | null {
  if (values.length === 0) return null
  const sorted = [...values].sort((left, right) => left - right)
  return sorted[Math.max(0, Math.ceil(fraction * sorted.length) - 1)]
}

function timing(values: Array<number | null>): TimingSummary {
  const present = values.filter((value): value is number => value !== null)
  return {
    count: present.length,
    minMs: present.length > 0 ? Math.min(...present) : null,
    medianMs: percentile(present, 0.5),
    p95Ms: percentile(present, 0.95),
    maxMs: present.length > 0 ? Math.max(...present) : null,
    within3000Ms: present.filter((value) => value <= MAX_WALL_TIME_MS).length
  }
}

function summarize(
  positions: PositionEvidence[],
  games: ManifestGame[]
): SoakArtifact['summary'] {
  return {
    parseErrors: 0,
    illegalMoves: 0,
    engineErrors: positions.filter((position) => position.errors.length > 0).length,
    overWallTime: positions.filter(
      (position) => position.parallelAnalysisTimeMs > MAX_WALL_TIME_MS
    ).length,
    completedGames: games.filter(
      (game) =>
        positions.filter((position) => position.gameId === game.gameId).length ===
        game.halfMoveCount
    ).length
  }
}

function artifact(
  status: SoakArtifact['status'],
  generatedAt: string,
  options: { seed: string },
  runKey: string,
  manifestSha256: string,
  primarySha256: string,
  verificationSha256: string,
  games: ManifestGame[],
  positions: PositionEvidence[]
): SoakArtifact {
  const totalPositions = games.reduce((sum, game) => sum + game.halfMoveCount, 0)
  return {
    schemaVersion: 1,
    status,
    generatedAt,
    seed: options.seed,
    runKey,
    sourceManifest: 'tests/fixtures/playok/soak.manifest.json',
    sourceManifestSha256: manifestSha256,
    analysisConfig: CONFIG,
    hardWallTimeMs: MAX_WALL_TIME_MS,
    engines: {
      primary: {
        binarySha256: primarySha256,
        knownProtocol: 'uci',
        role: 'productPrimaryAuthority'
      },
      verification: {
        binarySha256: verificationSha256,
        knownProtocol: 'uci',
        role: 'acceptanceCrossCheck',
        note: '同版 Pikafish 的另一個 CPU build，只供驗收交叉檢查；不是產品第二引擎，也不要求 EngineRegistry 第二筆安裝。'
      }
    },
    games,
    analyzedPositions: positions.length,
    totalPositions,
    positions,
    summary: summarize(positions, games),
    timing: {
      primary: timing(positions.map((position) => position.primary.analysisTimeMs)),
      verification: timing(
        positions.map((position) => position.verification.analysisTimeMs)
      ),
      parallelComparison: timing(
        positions.map((position) => position.parallelAnalysisTimeMs)
      )
    }
  }
}

function resume(runKey: string): { generatedAt: string; positions: PositionEvidence[] } | null {
  if (!existsSync(outputPath)) return null
  try {
    const value = JSON.parse(readFileSync(outputPath, 'utf8')) as Partial<SoakArtifact>
    if (
      value.schemaVersion !== 1 ||
      value.status !== 'in_progress' ||
      value.runKey !== runKey ||
      typeof value.generatedAt !== 'string' ||
      !Array.isArray(value.positions)
    ) {
      return null
    }
    return { generatedAt: value.generatedAt, positions: value.positions }
  } catch {
    return null
  }
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2))
  assertEngineFile(options.primary, 'primary')
  assertEngineFile(options.verification, 'verification')
  const manifestBytes = readFileSync(manifestPath)
  const manifest = JSON.parse(manifestBytes.toString('utf8')) as SoakManifest
  const parsedGames = parseGames(manifest)
  const totalPositions = parsedGames.reduce(
    (sum, game) => sum + game.moves.length,
    0
  )
  if (totalPositions !== manifest.totalHalfMoves) {
    throw new Error('manifest totalHalfMoves 與 fixtures 不符。')
  }

  const manifestSha256 = sha256(manifestBytes)
  const primarySha256 = sha256(readFileSync(options.primary))
  const verificationSha256 = sha256(readFileSync(options.verification))
  const runKey = sha256(
    JSON.stringify({
      seed: options.seed,
      manifestSha256,
      primarySha256,
      verificationSha256,
      config: CONFIG
    })
  )
  const previous = resume(runKey)
  const generatedAt = previous?.generatedAt ?? new Date().toISOString()
  const positions = previous?.positions ?? []
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
      `引擎自測失敗：primary=${primaryTest.ok}, verification=${verificationTest.ok}`
    )
  }

  console.log(`PlayOK 10-game soak：${parsedGames.length} 局，${totalPositions} plies`)
  console.log(
    `引擎設定：root=${CONFIG.rootAnalysisMovetimeMs}ms, actual=${CONFIG.userMoveEvalMovetimeMs}ms, MultiPV=${CONFIG.multiPv}`
  )
  if (positions.length > 0) console.log(`續跑 checkpoint：${positions.length}/${totalPositions}`)

  const paths = [options.primary, options.verification]
  for (const game of parsedGames) {
    for (let index = 0; index < game.moves.length; index += 1) {
      const ply = index + 1
      const key = `${game.manifest.gameId}:${ply}`
      if (completed.has(key)) continue
      const preMoveBoard = game.positions[index]
      const actualUci = game.moves[index]
      const applied = applyUciMove(preMoveBoard, actualUci)
      if (!applied.valid) {
        throw new Error(`${game.manifest.gameId} ply ${ply} 非法：${applied.message}`)
      }
      const nextFen = game.positions[index + 1].fen
      if (applied.board.fen !== nextFen) {
        throw new Error(`${game.manifest.gameId} ply ${ply} next FEN 不一致。`)
      }

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
      const primary = primaryResult.status === 'fulfilled'
        ? successfulEvidence(primaryResult.value)
        : failedEvidence(primaryResult.reason, paths)
      const verification = verificationResult.status === 'fulfilled'
        ? successfulEvidence(verificationResult.value)
        : failedEvidence(verificationResult.reason, paths)
      const errors: PositionEvidence['errors'] = []
      if (primary.error) errors.push({ engine: 'primary', ...primary.error })
      if (verification.error) errors.push({ engine: 'verification', ...verification.error })
      const record: PositionEvidence = {
        gameId: game.manifest.gameId,
        sourceIndex: game.manifest.sourceIndex,
        ply,
        preMoveFen: preMoveBoard.fen,
        nextFen,
        actualMove: {
          uci: actualUci,
          wxf: game.displayMoves[index],
          chinese: formatChineseMove(preMoveBoard, actualUci) ?? '無法辨識著法'
        },
        replay: {
          preMoveFenParsed: true,
          actualMoveLegal: true,
          reproducedNextFen: true
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
            primary.evaluationLoss !== null && verification.evaluationLoss !== null
              ? Math.abs(primary.evaluationLoss - verification.evaluationLoss)
              : null
        },
        errors
      }
      positions.push(record)
      completed.add(key)
      console.log(
        `[${positions.length}/${totalPositions}] ${record.gameId} ply ${ply} ${parallelAnalysisTimeMs}ms${errors.length > 0 ? ' ERROR' : ''}`
      )
      if (positions.length % 5 === 0 || positions.length === totalPositions) {
        writeJsonAtomic(
          outputPath,
          artifact(
            'in_progress',
            generatedAt,
            options,
            runKey,
            manifestSha256,
            primarySha256,
            verificationSha256,
            manifest.games,
            positions
          )
        )
      }
    }
  }

  const summary = summarize(positions, manifest.games)
  const failed =
    positions.length !== totalPositions ||
    summary.completedGames !== manifest.games.length ||
    summary.parseErrors > 0 ||
    summary.illegalMoves > 0 ||
    summary.engineErrors > 0 ||
    summary.overWallTime > 0
  const finalArtifact = artifact(
    failed ? 'complete_with_failures' : 'complete',
    generatedAt,
    options,
    runKey,
    manifestSha256,
    primarySha256,
    verificationSha256,
    manifest.games,
    positions
  )
  writeJsonAtomic(outputPath, finalArtifact)
  if (failed) {
    throw new Error(`soak 未通過：${JSON.stringify(finalArtifact.summary)}`)
  }
  console.log(`完成：${positions.length}/${totalPositions}，${summary.completedGames}/10 局。`)
  console.log(
    `並行耗時 min=${finalArtifact.timing.parallelComparison.minMs}ms, median=${finalArtifact.timing.parallelComparison.medianMs}ms, p95=${finalArtifact.timing.parallelComparison.p95Ms}ms, max=${finalArtifact.timing.parallelComparison.maxMs}ms`
  )
}

main().catch((error: unknown) => {
  console.error(`PlayOK soak 失敗：${error instanceof Error ? error.message : String(error)}`)
  process.exitCode = 1
})
