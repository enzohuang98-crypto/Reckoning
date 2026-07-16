import { app } from 'electron'
import { strict as assert } from 'node:assert'
import { createHash, randomUUID } from 'node:crypto'
import {
  appendFileSync,
  closeSync,
  existsSync,
  fsyncSync,
  lstatSync,
  mkdtempSync,
  openSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  truncateSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { getAIProvider } from '../../src/main/ai/AIProvider'
import {
  runExplanationHarness,
  type HarnessRunResult
} from '../../src/main/ai/HarnessOrchestrator'
import { modelRegistry } from '../../src/main/ai/ModelRegistry'
import { buildExplanationPrompt } from '../../src/main/ai/promptBuilder'
import { EngineRegistryService } from '../../src/main/engine/EngineRegistryService'
import {
  EngineAnalysisError,
  PikafishAdapter
} from '../../src/main/engine/PikafishAdapter'
import { mapStreamingErrorToPayload } from '../../src/main/ipc/aiExplanationHandlers'
import { maskSecrets } from '../../src/main/logger'
import type { AnalysisSession } from '../../src/main/storage/AnalysisSessionStore'
import { HarnessTraceStore } from '../../src/main/storage/HarnessTraceStore'
import { SecretStore } from '../../src/main/storage/SecretStore'
import { writeJsonFileAtomic } from '../../src/main/storage/SecureJsonFile'
import { StorageService } from '../../src/main/storage/StorageService'
import { compareMove } from '../../src/shared/logic/analysis/MoveComparisonService'
import { screenExplanationText } from '../../src/shared/logic/ai/ExplanationQualityScorer'
import { formatChineseMove } from '../../src/shared/logic/board/ChineseNotation'
import { parsePlayOkWxf } from '../../src/shared/logic/board/PlayOkWxf'
import type {
  AIExplanationRequest,
  AIExplanationResponse
} from '../../src/shared/types/AIExplanationTypes'
import type {
  AIExplanationStreamChunk,
  AIProvider
} from '../../src/shared/types/AIProviderTypes'
import type {
  AnalysisConfig,
  EngineAnalysis,
  EngineScore
} from '../../src/shared/types/EngineAnalysis'
import type { EngineInstallation } from '../../src/shared/types/EngineRegistry'
import type { HarnessTrace } from '../../src/shared/types/Harness'
import type { GenerateExplanationStartPayload } from '../../src/shared/types/ipc'

const PROVIDER = 'gemini' as const
const PRIMARY_MODEL = modelRegistry.getModel(
  PROVIDER,
  'gemini-3.5-flash'
).model
const REFERENCE_MODEL_CANDIDATE = modelRegistry.hasModel(
  PROVIDER,
  'gemini-3.1-pro-preview'
)
  ? 'gemini-3.1-pro-preview'
  : null
const AI_TIMEOUT_MS = 30_000
const MAX_OBSERVED_RETRY_AFTER_MS = 15 * 60_000
const PRIMARY_CONTENT_ATTEMPTS = 3
const EXPECTED_SOAK_AI_PLIES = 358
const EXPECTED_SOAK_GAMES = new Map<string, number>([
  ['xq270018889', 108],
  ['xq275885193', 35],
  ['xq267431809', 75],
  ['xq276040718', 103],
  ['xq276077323', 37]
])
const TARGET_MIN_CHINESE_CHARS = 500
const TARGET_MAX_CHINESE_CHARS = 900
const RESULT_MAX_BYTES = 32 * 1024 * 1024
const CHECK_VERSION = 6
const REQUIRED_HEADINGS = [
  '直接結論',
  '實戰步問題',
  'AI 首選',
  '對手利用與後果',
  '實戰原則'
] as const

type SuiteName = 'fixed' | 'soak'
type RunMode = 'help' | 'self-test' | 'dry-run' | 'live'
type Responsibility =
  | 'passed'
  | 'data_or_loop'
  | 'engine_local'
  | 'model'
  | 'service'

interface CliOptions {
  mode: RunMode
  suite: SuiteName
  crossCheckPath?: string
}

interface AcceptanceCase {
  caseId: string
  gameId: string
  ply: number
  preMoveFen: string
  actualMove: { uci: string; chinese: string; wxf?: string }
}

interface LoadedSuite {
  name: SuiteName
  sourceFingerprint: string
  analysisConfig: AnalysisConfig
  expectedEngineBinarySha256: string[]
  cases: AcceptanceCase[]
  resultPath: string
  checkpointPath: string | null
}

interface FixedArtifact {
  schemaVersion: number
  analysisConfig: AnalysisConfig
  cases: Array<{
    gameId: string
    ply: number
    preMoveFen: string
    actualMove: { uci: string; chinese: string; wxf?: string }
  }>
}

interface EngineBaselineIdentity {
  engines?: {
    primary?: { binarySha256?: string }
    verification?: { binarySha256?: string }
  }
}

interface SoakManifestSource {
  sourceIndex: number
  gameId: string
  fixture: string
  halfMoveCount: number
  sha256: string
  aiExplanationSoak?: boolean
}

interface SoakManifest {
  schemaVersion: number
  totalHalfMoves: number
  aiExplanationHalfMoves: number
  games: SoakManifestSource[]
}

interface SoakEngineArtifact {
  schemaVersion: number
  status?: string
  sourceManifestSha256?: string
  analysisConfig: AnalysisConfig
  hardWallTimeMs?: number
  totalPositions?: number
  analyzedPositions?: number
  engines?: EngineBaselineIdentity['engines']
  positions?: Array<{
    primary?: { status?: string; incomplete?: boolean; error?: unknown }
    verification?: { status?: string; incomplete?: boolean; error?: unknown }
    parallelAnalysisTimeMs?: number
    errors?: unknown[]
  }>
  summary?: {
    parseErrors?: number
    illegalMoves?: number
    engineErrors?: number
    overWallTime?: number
    completedGames?: number
  }
}

interface AcceptanceCrossCheckEngine {
  id: string
  displayName: string
  executablePath: string
  protocol: 'uci'
}

interface ServiceErrorClassification {
  code: string
  message: string
}

interface TraceSummary {
  status: HarnessTrace['status']
  modelCalls: number
  engineRounds: number
  validationErrors: string[]
}

type InternalModelCallPurpose = 'initial_combined' | 'provider_retry'
type InternalModelCallOutcome =
  | 'success'
  | 'provider_error'
  | 'deadline_abort'
  | 'caller_abort'
type RateLimitScope = 'rpm' | 'tpm' | 'rpd' | 'capacity' | 'unknown'
type AttemptDeliveryStatus = 'completed' | 'terminal_service'
type AttemptTimeoutStage = 'outer_deadline' | 'internal_model_phase' | null
type AttemptCompletionMode =
  | 'model_response'
  | 'grounded_completion'
  | 'engine_evidence_fallback'
  | 'none'

interface InternalModelCallObservation {
  callIndex: number
  purpose: InternalModelCallPurpose
  startedOffsetMs: number
  remainingDeadlineMsAtStart: number
  durationMs: number
  outcome: InternalModelCallOutcome
  errorCode: string | null
  rateLimitScope: RateLimitScope | null
  retryAfterMs: number | null
  responseFingerprint: string | null
  responseCharCount: number
  responseChineseCharCount: number
  usage: { inputTokens: number; outputTokens: number } | null
  validationCodes: string[]
}

interface StructuralChecks {
  requiredHeadingsPresentOnce: boolean
  requiredHeadingsInOrder: boolean
  mentionsActualMove: boolean
  mentionsBestMove: boolean
  atLeastTwoEvidenceMoves: boolean
  noSelfQuestionAnswer: boolean
  noFallback: boolean
  productionQualityScreenPassed: boolean
  productionQualityIssues: string[]
  modelCallsWithinInitialLimit: boolean
  zeroEngineRounds: boolean
  noClarification: boolean
  chineseLengthWithinTarget: boolean
  passed: boolean
}

interface ForbiddenInfoChecks {
  noFen: boolean
  noUci: boolean
  noEvidenceIds: boolean
  noRawScores: boolean
  noInternalDiagnostics: boolean
  noUnsupportedChineseMoves: boolean
  passed: boolean
}

interface RubricCriteria {
  directActualMoveReason: boolean
  actualAndBestChineseMoves: boolean
  completeCausalChain: boolean
  atLeastTwoRealPvMoves: boolean
  noFabricationTurnOrFenError: boolean
  noSelfQaOrInternalInfo: boolean
  exactlyOneUserClickRequest: boolean
}

interface AcceptanceAttempt {
  requestId: string
  attempt: number
  modelRole: 'primary' | 'reference'
  purpose: 'user_click' | 'diagnostic_replay' | 'reference_diagnosis'
  provider: typeof PROVIDER
  model: string
  aiDurationMs: number
  deliveryStatus: AttemptDeliveryStatus
  timeoutStage: AttemptTimeoutStage
  serviceErrorClassification: ServiceErrorClassification | null
  transientServiceErrorCount: number
  internalCalls: InternalModelCallObservation[]
  successfulInternalCalls: number
  firstCandidateObserved: boolean
  initialModelCandidatePass: boolean | null
  initialModelIssueCodes: string[]
  completionMode: AttemptCompletionMode
  modelBackedQualityPass: boolean
  finalDisplayedQualityPass: boolean
  safeDisplayedFallbackPass: boolean
  finalText: string | null
  finalTextFingerprint: string | null
  trace: TraceSummary | null
  chineseCharCount: number | null
  structuralChecks: StructuralChecks | null
  forbiddenInfoChecks: ForbiddenInfoChecks | null
  /** Model-backed rubric; engine-evidence fallback cannot satisfy it. */
  rubricCriteria: RubricCriteria
  rubricScore0to10: number
  majorErrorFlags: string[]
  displayedRubricCriteria: RubricCriteria
  displayedRubricScore0to10: number
  displayedMajorErrorFlags: string[]
  /** Model-backed first-click gate; deterministic fallback never satisfies it. */
  firstClickQualityPass: boolean
  passed: boolean
}

interface AcceptanceAttemptStart {
  requestId: string
  attempt: number
  modelRole: AcceptanceAttempt['modelRole']
  purpose: AcceptanceAttempt['purpose']
  provider: typeof PROVIDER
  model: string
}

interface EngineEvidencePacket {
  status: 'ok' | 'error'
  engineId?: string
  engineName?: string
  bestMove?: string
  displayBestMove?: string
  actualMove?: string
  displayActualMove?: string
  bestScore?: ReturnType<typeof safeScore>
  actualScore?: ReturnType<typeof safeScore>
  depth?: number | null
  analysisTimeMs?: number | null
  bestLine?: { uci: string[]; chinese: string[] }
  actualLine?: { uci: string[]; chinese: string[] }
  incomplete?: boolean
  warnings?: string[]
  error?: { code: string; message: string }
}

interface EvidencePacket {
  positionFen: string
  actualMove: AcceptanceCase['actualMove']
  analysisConfig: AnalysisConfig
  parallelEngineDurationMs: number
  analysisFingerprint: string | null
  primary: EngineEvidencePacket
  acceptanceCrossCheck: EngineEvidencePacket
}

interface CaseResult {
  caseId: string
  gameId: string
  ply: number
  evidenceFingerprint: string
  evidence: EvidencePacket
  provider: typeof PROVIDER
  model: string
  engineDurationMs: number
  aiDurationMs: number | null
  diagnosticRetryDurationMs: number
  serviceErrorClassification: ServiceErrorClassification | null
  finalText: string | null
  finalTextFingerprint: string | null
  trace: TraceSummary | null
  structuralChecks: StructuralChecks | null
  forbiddenInfoChecks: ForbiddenInfoChecks | null
  chineseCharCount: number | null
  fallbackUsed: boolean
  userClickRequestCount: number
  /** Model-backed rubric; engine-evidence fallback cannot satisfy it. */
  rubricCriteria: RubricCriteria
  rubricScore0to10: number
  majorErrorFlags: string[]
  displayedRubricCriteria: RubricCriteria
  displayedRubricScore0to10: number
  displayedMajorErrorFlags: string[]
  initialModelCandidatePass: boolean | null
  modelBackedQualityPass: boolean
  finalDisplayedQualityPass: boolean
  safeDisplayedFallbackPass: boolean
  /** Model-backed first-click gate; deterministic fallback never satisfies it. */
  firstClickQualityPass: boolean
  attempts: AcceptanceAttempt[]
  responsibility: Responsibility
  diagnosisLimitations: string[]
  passed: boolean
}

interface TimingSummary {
  count: number
  medianMs: number | null
  p95Ms: number | null
  maxMs: number | null
}

interface ResultArtifact {
  schemaVersion: 1
  checkVersion: typeof CHECK_VERSION
  status: 'in_progress' | 'complete'
  suite: SuiteName
  generatedAt: string
  completedAt?: string
  sourceFingerprint: string
  runKey: string
  provider: typeof PROVIDER
  primaryModel: string
  referenceModel: string | null
  credentialBinding: 'exact_provider_model'
  aiTimeoutMs: number
  harnessEngineMode: 'configured_primary_only'
  initialRequestContract: 'exactly_one_user_click_per_case'
  qualityAxes: {
    initialModelCandidatePass: 'raw_first_model_candidate_before_local_completion'
    firstClickQualityPass: 'model_response_or_grounded_completion_without_engine_fallback'
    finalDisplayedQualityPass: 'visible_full_five_section_explanation_excluding_engine_fallback'
    safeDisplayedFallbackPass: 'safe_visible_engine_evidence_fallback_not_full_explanation_quality'
    rubricScore0to10: 'model_backed'
    displayedRubricScore0to10: 'displayed_content_criteria_not_full_explanation_acceptance'
  }
  analysisConfig: AnalysisConfig
  engines: {
    primary: { id: string; name: string; binarySha256: string }
    acceptanceCrossCheck: {
      id: string
      name: string
      binarySha256: string
      purpose: 'acceptance_cross_check_same_package_cpu_build'
    }
  }
  expectedCases: number
  cases: CaseResult[]
  aggregate: {
    completedCases: number
    initialModelCandidatePasses: number
    firstClickQualityPasses: number
    finalDisplayedQualityPasses: number
    safeDisplayedFallbackPasses: number
    exactOneUserClickCases: number
    engineDuration: TimingSummary
    aiDuration: TimingSummary
    firstClickRubric: {
      medianScore0to10: number | null
      minimumScore0to10: number | null
      below8Cases: number
      majorErrorCases: number
    }
    failures: Array<{
      caseId: string
      responsibility: Responsibility
      serviceCode: string | null
      failedChecks: string[]
    }>
  }
}

function artifactVersionMetadata(): Pick<
  ResultArtifact,
  'schemaVersion' | 'checkVersion'
> {
  return { schemaVersion: 1, checkVersion: CHECK_VERSION }
}

interface CheckpointRecord {
  schemaVersion: 1
  runKey: string
  type: 'meta' | 'evidence' | 'attempt_started' | 'attempt' | 'case_complete'
  at: string
  caseId?: string
  evidenceFingerprint?: string
  fallbackUsed?: boolean
  evidence?: {
    packet: EvidencePacket
    primaryAnalysis: EngineAnalysis | null
    acceptanceCrossCheckAnalysis: EngineAnalysis | null
  }
  attemptStart?: AcceptanceAttemptStart
  attempt?: AcceptanceAttempt
  result?: CaseResult
}

interface ObservedProvider extends AIProvider {
  readonly errors: unknown[]
  readonly successfulCalls: number
  readonly terminalError: unknown | null
  readonly internalCalls: InternalModelCallObservation[]
}

let activeAbortController: AbortController | null = null
let shutdownRequested = false

function usage(): string {
  return [
    'Production AI acceptance runner (Electron main process; safeStorage enabled)',
    '',
    'Usage:',
    '  npm.cmd run acceptance:ai -- --help',
    '  npm.cmd run acceptance:ai -- --self-test',
    '  npm.cmd run acceptance:ai -- --dry-run [--suite fixed|soak] [--cross-check <pikafish-build>]',
    '  npm.cmd run acceptance:ai -- --live [--suite fixed|soak] [--cross-check <pikafish-build>]',
    '',
    'Safety:',
    '  --self-test exercises fixture, rubric, and checkpoint contracts without credentials, engines, or network.',
    '  --dry-run validates fixtures, the configured primary engine, an acceptance-only cross-check build, models, and the encrypted Gemini key.',
    '  --dry-run never starts an engine and never contacts Gemini.',
    '  --live is mandatory for network calls; close xiangqi-analyzer before running.',
    '  Every explicit Harness request has a 30 second deadline.',
    '  --cross-check never changes the product registry and is labeled acceptance-only in artifacts.',
    '  Gemini credentials are looked up by exact provider+model; catalog presence never enables Pro.',
    '',
    'Suites:',
    '  fixed (default): six deterministic cases -> ai-acceptance-results.json',
    '  soak: every ply in five aiExplanationSoak games; resumes from JSONL checkpoints.',
    '  Each case has exactly one initial user_click; any later calls are labeled diagnostic replays.'
  ].join('\n')
}

function parseArgs(argv: string[]): CliOptions {
  if (argv.includes('--help') || argv.includes('-h')) {
    return { mode: 'help', suite: 'fixed' }
  }
  if (argv.includes('--self-test')) {
    if (argv.length !== 1) {
      throw new Error('--self-test cannot be combined with other arguments.')
    }
    return { mode: 'self-test', suite: 'fixed' }
  }
  let mode: RunMode | null = null
  let suite: SuiteName = 'fixed'
  let crossCheckPath: string | undefined
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--dry-run' || arg === '--live') {
      if (mode) throw new Error('Choose exactly one of --dry-run or --live.')
      mode = arg === '--live' ? 'live' : 'dry-run'
      continue
    }
    if (arg === '--suite') {
      const value = argv[index + 1]
      if (value !== 'fixed' && value !== 'soak') {
        throw new Error('--suite must be fixed or soak.')
      }
      suite = value
      index += 1
      continue
    }
    if (arg === '--cross-check') {
      const value = argv[index + 1]
      if (!value || value.startsWith('--')) {
        throw new Error('--cross-check requires an engine binary path.')
      }
      crossCheckPath = resolve(value)
      index += 1
      continue
    }
    throw new Error(`Unsupported argument: ${arg}`)
  }
  if (!mode) throw new Error('Refusing to run without explicit --dry-run or --live.')
  return { mode, suite, crossCheckPath }
}

function sha256(value: Buffer | string): string {
  return createHash('sha256').update(value).digest('hex')
}

function validAnalysisConfig(value: AnalysisConfig): boolean {
  return (
    Number.isSafeInteger(value.rootAnalysisMovetimeMs) &&
    value.rootAnalysisMovetimeMs >= 100 &&
    value.rootAnalysisMovetimeMs <= 60_000 &&
    Number.isSafeInteger(value.userMoveEvalMovetimeMs) &&
    value.userMoveEvalMovetimeMs >= 100 &&
    value.userMoveEvalMovetimeMs <= 60_000 &&
    Number.isSafeInteger(value.multiPv) &&
    value.multiPv >= 1 &&
    value.multiPv <= 20
  )
}

function expectedEngineHashes(identity: EngineBaselineIdentity): string[] {
  return [
    identity.engines?.primary?.binarySha256,
    identity.engines?.verification?.binarySha256
  ].filter((value): value is string => Boolean(value && /^[a-f0-9]{64}$/i.test(value)))
}

function loadFixedSuite(fixtureDir: string): LoadedSuite {
  const path = join(fixtureDir, 'acceptance-cases.json')
  const baselinePath = join(fixtureDir, 'full-engine-baseline.json')
  const bytes = readFileSync(path)
  const baselineBytes = readFileSync(baselinePath)
  const artifact = JSON.parse(bytes.toString('utf8')) as FixedArtifact
  const baseline = JSON.parse(
    baselineBytes.toString('utf8')
  ) as EngineBaselineIdentity
  if (
    artifact.schemaVersion !== 1 ||
    !validAnalysisConfig(artifact.analysisConfig) ||
    !Array.isArray(artifact.cases) ||
    artifact.cases.length !== 6
  ) {
    throw new Error('acceptance-cases.json must contain exactly six schema v1 cases.')
  }
  const cases = artifact.cases.map((entry) => ({
    caseId: `${entry.gameId}#${entry.ply}`,
    gameId: entry.gameId,
    ply: entry.ply,
    preMoveFen: entry.preMoveFen,
    actualMove: entry.actualMove
  }))
  if (new Set(cases.map((entry) => entry.caseId)).size !== cases.length) {
    throw new Error('Fixed acceptance case IDs must be unique.')
  }
  const engineHashes = expectedEngineHashes(baseline)
  if (new Set(engineHashes).size !== 2) {
    throw new Error('Fixed engine baseline must identify two distinct CPU builds.')
  }
  return {
    name: 'fixed',
    sourceFingerprint: sha256(Buffer.concat([bytes, baselineBytes])),
    analysisConfig: artifact.analysisConfig,
    expectedEngineBinarySha256: engineHashes,
    cases,
    resultPath: join(fixtureDir, 'ai-acceptance-results.json'),
    checkpointPath: null
  }
}

function loadSoakSuite(fixtureDir: string): LoadedSuite {
  const manifestPath = join(fixtureDir, 'soak.manifest.json')
  const baselinePath = join(fixtureDir, 'soak-engine-baseline.json')
  const manifestBytes = readFileSync(manifestPath)
  const baselineBytes = readFileSync(baselinePath)
  const manifest = JSON.parse(manifestBytes.toString('utf8')) as SoakManifest
  const baseline = JSON.parse(baselineBytes.toString('utf8')) as SoakEngineArtifact
  const games = Array.isArray(manifest.games) ? manifest.games : []
  const selected = games.filter(
    (source) => source.aiExplanationSoak === true
  )
  const selectedSourceCounts = selected.reduce<Record<number, number>>(
    (counts, source) => ({
      ...counts,
      [source.sourceIndex]: (counts[source.sourceIndex] ?? 0) + 1
    }),
    {}
  )
  const baselinePositions = Array.isArray(baseline.positions)
    ? baseline.positions
    : []
  const baselineSummary = baseline.summary
  const exactSelectedGames =
    selected.length === EXPECTED_SOAK_GAMES.size &&
    selected.every(
      (source) =>
        EXPECTED_SOAK_GAMES.get(source.gameId) === source.halfMoveCount
    )
  const completeBaselinePositions = baselinePositions.every(
    (position) =>
      position.primary?.status === 'ok' &&
      position.primary.incomplete === false &&
      position.primary.error === null &&
      position.verification?.status === 'ok' &&
      position.verification.incomplete === false &&
      position.verification.error === null &&
      Array.isArray(position.errors) &&
      position.errors.length === 0 &&
      typeof position.parallelAnalysisTimeMs === 'number' &&
      position.parallelAnalysisTimeMs <= 3_000
  )
  if (
    manifest.schemaVersion !== 1 ||
    baseline.schemaVersion !== 1 ||
    baseline.status !== 'complete' ||
    games.length !== 10 ||
    manifest.totalHalfMoves !== 825 ||
    manifest.aiExplanationHalfMoves !== EXPECTED_SOAK_AI_PLIES ||
    !validAnalysisConfig(baseline.analysisConfig) ||
    baseline.analysisConfig.rootAnalysisMovetimeMs !== 1_100 ||
    baseline.analysisConfig.userMoveEvalMovetimeMs !== 400 ||
    baseline.analysisConfig.multiPv !== 3 ||
    !exactSelectedGames ||
    selectedSourceCounts[1] !== 2 ||
    selectedSourceCounts[2] !== 1 ||
    selectedSourceCounts[3] !== 2 ||
    baseline.sourceManifestSha256 !== sha256(manifestBytes) ||
    baseline.hardWallTimeMs !== 3_000 ||
    baseline.totalPositions !== 825 ||
    baseline.analyzedPositions !== 825 ||
    baselinePositions.length !== 825 ||
    !completeBaselinePositions ||
    baselineSummary?.parseErrors !== 0 ||
    baselineSummary.illegalMoves !== 0 ||
    baselineSummary.engineErrors !== 0 ||
    baselineSummary.overWallTime !== 0 ||
    baselineSummary.completedGames !== 10
  ) {
    throw new Error(
      'Soak artifacts must be complete 825/825 schema v1 data with the exact five 358-ply AI games, 2/1/2 source balance, 1100/400/MultiPV3, zero errors, and zero positions over 3 seconds.'
    )
  }
  const cases: AcceptanceCase[] = []
  for (const source of selected) {
    const fixturePath = join(fixtureDir, basename(source.fixture))
    const fixtureBytes = readFileSync(fixturePath)
    if (sha256(fixtureBytes) !== source.sha256) {
      throw new Error(`${source.gameId} fixture fingerprint does not match the soak manifest.`)
    }
    const parsed = parsePlayOkWxf(fixtureBytes.toString('utf8'))
    if (!parsed.valid || parsed.moves.length !== source.halfMoveCount) {
      throw new Error(`${source.gameId} could not be reconstructed exactly from WXF.`)
    }
    for (let index = 0; index < parsed.moves.length; index += 1) {
      const board = parsed.positions[index]
      const uci = parsed.moves[index]
      if (!board || !uci) throw new Error(`${source.gameId} ply ${index + 1} is incomplete.`)
      cases.push({
        caseId: `${source.gameId}#${index + 1}`,
        gameId: source.gameId,
        ply: index + 1,
        preMoveFen: board.fen,
        actualMove: {
          uci,
          wxf: parsed.displayMoves[index],
          chinese: formatChineseMove(board, uci) ?? '無法辨識著法'
        }
      })
    }
  }
  if (new Set(cases.map((entry) => entry.caseId)).size !== cases.length) {
    throw new Error('Soak case IDs must be unique.')
  }
  if (cases.length !== EXPECTED_SOAK_AI_PLIES) {
    throw new Error(
      `Soak AI suite must contain ${EXPECTED_SOAK_AI_PLIES} explicit user_click cases; found ${cases.length}.`
    )
  }
  const engineHashes = expectedEngineHashes(baseline)
  if (new Set(engineHashes).size !== 2) {
    throw new Error('Soak engine baseline must identify two distinct CPU builds.')
  }
  return {
    name: 'soak',
    sourceFingerprint: sha256(Buffer.concat([manifestBytes, baselineBytes])),
    analysisConfig: baseline.analysisConfig,
    expectedEngineBinarySha256: engineHashes,
    cases,
    resultPath: join(fixtureDir, 'ai-soak-results.json'),
    checkpointPath: join(fixtureDir, 'ai-soak-checkpoint.jsonl')
  }
}

function loadSuite(name: SuiteName): LoadedSuite {
  const fixtureDir = resolve('tests', 'fixtures', 'playok')
  return name === 'fixed'
    ? loadFixedSuite(fixtureDir)
    : loadSoakSuite(fixtureDir)
}

function assertEngineFile(installation: EngineInstallation, label: string): void {
  if (
    !existsSync(installation.executablePath) ||
    !lstatSync(installation.executablePath).isFile()
  ) {
    throw new Error(`${label} configured engine binary is missing or invalid.`)
  }
}

function configuredPrimary(registry: EngineRegistryService): EngineInstallation {
  const snapshot = registry.list()
  const primary = registry.getInstallation(snapshot.activeEngineId)
  if (!primary) throw new Error('A configured primary Pikafish engine is required.')
  assertEngineFile(primary, 'Primary')
  return primary
}

function binaryFingerprint(installation: EngineInstallation): string {
  return sha256(readFileSync(installation.executablePath))
}

function resolveAcceptanceCrossCheck(input: {
  registry: EngineRegistryService
  primary: EngineInstallation
  explicitPath?: string
  expectedHashes: string[]
}): {
  crossCheck: AcceptanceCrossCheckEngine
  primarySha256: string
  crossCheckSha256: string
} {
  const primaryPath = realpathSync(input.primary.executablePath)
  const primarySha256 = binaryFingerprint(input.primary)
  if (!input.expectedHashes.includes(primarySha256)) {
    throw new Error('Configured primary engine does not match the acceptance corpus build set.')
  }
  const registryHint = input.registry.getInstallation(
    input.registry.list().verificationEngineId
  )?.executablePath
  const siblingCandidates = readdirSync(dirname(primaryPath), {
    withFileTypes: true
  })
    .filter(
      (entry) =>
        entry.isFile() &&
        /^pikafish.*\.exe$/i.test(entry.name)
    )
    .map((entry) => join(dirname(primaryPath), entry.name))
  const candidates = [
    input.explicitPath,
    process.env.PIKAFISH_CROSSCHECK_PATH,
    registryHint,
    ...siblingCandidates
  ].filter((path): path is string => Boolean(path))
  for (const candidate of [...new Set(candidates.map((path) => resolve(path)))]) {
    if (!existsSync(candidate) || !lstatSync(candidate).isFile()) continue
    const resolvedCandidate = realpathSync(candidate)
    if (resolvedCandidate === primaryPath) continue
    const candidateSha256 = sha256(readFileSync(resolvedCandidate))
    if (
      candidateSha256 !== primarySha256 &&
      input.expectedHashes.includes(candidateSha256)
    ) {
      return {
        crossCheck: {
          id: `acceptance-cross-check-${candidateSha256.slice(0, 12)}`,
          displayName: 'Pikafish acceptance cross-check',
          executablePath: resolvedCandidate,
          protocol: 'uci'
        },
        primarySha256,
        crossCheckSha256: candidateSha256
      }
    }
  }
  throw new Error(
    'No second same-package CPU build matched the acceptance corpus. Supply --cross-check without changing the product registry.'
  )
}

function exactModelApiKey(
  secretStore: SecretStore,
  model: string
): string | null {
  return secretStore.getCredential(PROVIDER, model, undefined)
}

function safeScore(score: EngineScore | null):
  | {
      type: EngineScore['type']
      comparableValue: number
      displayText: string
      source: EngineScore['source']
    }
  | null {
  return score
    ? {
        type: score.type,
        comparableValue: score.comparableValue,
        displayText: score.displayText,
        source: score.source
      }
    : null
}

function successfulEnginePacket(analysis: EngineAnalysis): EngineEvidencePacket {
  return {
    status: 'ok',
    engineId: analysis.engineId,
    engineName: analysis.engineName,
    bestMove: analysis.bestMove,
    displayBestMove: analysis.displayBestMove,
    actualMove: analysis.userMove,
    displayActualMove: analysis.displayUserMove,
    bestScore: safeScore(analysis.scoreAfterBestMove),
    actualScore: safeScore(analysis.scoreAfterUserMove),
    depth: analysis.depth,
    analysisTimeMs: analysis.analysisTimeMs ?? null,
    bestLine: {
      uci: [...analysis.principalVariation],
      chinese: [...(analysis.displayPrincipalVariation ?? [])]
    },
    actualLine: {
      uci: [...(analysis.userMovePrincipalVariation ?? [])],
      chinese: [...(analysis.displayUserMovePrincipalVariation ?? [])]
    },
    incomplete: analysis.incomplete,
    warnings: [...analysis.warnings]
  }
}

function checkpointAnalysis(analysis: EngineAnalysis): EngineAnalysis {
  return { ...analysis, rawAnalysis: undefined }
}

function fingerprintAnalyses(
  primary: EngineAnalysis,
  acceptanceCrossCheck: EngineAnalysis
): string {
  return sha256(
    JSON.stringify({
      primary: checkpointAnalysis(primary),
      acceptanceCrossCheck: checkpointAnalysis(acceptanceCrossCheck)
    })
  )
}

function savedAnalysesMatchPacket(evidence: NonNullable<CheckpointRecord['evidence']>): boolean {
  if (evidence.packet.analysisFingerprint === null) {
    return (
      evidence.primaryAnalysis === null &&
      evidence.acceptanceCrossCheckAnalysis === null
    )
  }
  return Boolean(
    evidence.primaryAnalysis &&
      evidence.acceptanceCrossCheckAnalysis &&
      fingerprintAnalyses(
        evidence.primaryAnalysis,
        evidence.acceptanceCrossCheckAnalysis
      ) === evidence.packet.analysisFingerprint
  )
}

function sanitizeOperationalMessage(
  error: unknown,
  redactions: string[] = []
): string {
  const raw = error instanceof Error ? error.message : String(error)
  return maskSecrets(
    redactions.reduce(
      (message, value) => (value ? message.replaceAll(value, '[redacted]') : message),
      raw
    )
  ).slice(0, 500)
}

function failedEnginePacket(
  error: unknown,
  redactions: string[]
): EngineEvidencePacket {
  return {
    status: 'error',
    error: {
      code: error instanceof EngineAnalysisError ? error.code : 'engine_local_error',
      message: sanitizeOperationalMessage(error, redactions)
    }
  }
}

function evidencePacket(
  entry: AcceptanceCase,
  config: AnalysisConfig,
  parallelEngineDurationMs: number,
  analysisFingerprint: string | null,
  primary: EngineEvidencePacket,
  verification: EngineEvidencePacket
): EvidencePacket {
  return {
    positionFen: entry.preMoveFen,
    actualMove: entry.actualMove,
    analysisConfig: config,
    parallelEngineDurationMs,
    analysisFingerprint,
    primary,
    acceptanceCrossCheck: verification
  }
}

function fingerprintEvidence(packet: EvidencePacket): string {
  const withoutTiming = (engine: EngineEvidencePacket): EngineEvidencePacket => {
    const { analysisTimeMs: _analysisTimeMs, ...rest } = engine
    void _analysisTimeMs
    return rest
  }
  return sha256(
    JSON.stringify({
      positionFen: packet.positionFen,
      actualMove: packet.actualMove,
      analysisConfig: packet.analysisConfig,
      analysisFingerprint: packet.analysisFingerprint,
      primary: withoutTiming(packet.primary),
      acceptanceCrossCheck: withoutTiming(packet.acceptanceCrossCheck)
    })
  )
}

function percentile(values: number[], fraction: number): number | null {
  if (values.length === 0) return null
  const ordered = [...values].sort((left, right) => left - right)
  return ordered[Math.max(0, Math.ceil(ordered.length * fraction) - 1)] ?? null
}

function timingSummary(values: Array<number | null>): TimingSummary {
  const present = values.filter((value): value is number => value !== null)
  return {
    count: present.length,
    medianMs: percentile(present, 0.5),
    p95Ms: percentile(present, 0.95),
    maxMs: present.length > 0 ? Math.max(...present) : null
  }
}

function fallbackUsed(trace: HarnessTrace | null): boolean {
  return Boolean(
    trace?.validationErrors.some((message) =>
      /保守版|引擎快照直接回答|引擎證據版|fallback/i.test(message)
    )
  )
}

function countOccurrences(text: string, needle: string): number {
  return text.split(needle).length - 1
}

function countChineseCharacters(text: string): number {
  return text.match(/\p{Script=Han}/gu)?.length ?? 0
}

function availableDisplayMoves(primary: EngineAnalysis): string[] {
  return [
    primary.displayUserMove,
    primary.displayBestMove,
    ...(primary.displayPrincipalVariation ?? []),
    ...(primary.displayUserMovePrincipalVariation ?? [])
  ].filter((move): move is string => Boolean(move?.trim()))
}

function mentionedChineseMoves(text: string): string[] {
  return [
    ...text.matchAll(
      /(?:[前中後][車馬炮兵卒相象仕士帥將]|[車馬炮兵卒相象仕士帥將][一二三四五六七八九1-9])[進退平][一二三四五六七八九1-9]/gu
    )
  ].map((match) => match[0])
}

function evaluateText(
  finalText: string,
  result: HarnessRunResult,
  trace: HarnessTrace | null,
  entry: AcceptanceCase,
  primary: EngineAnalysis
): {
  chineseCharCount: number
  structural: StructuralChecks
  forbidden: ForbiddenInfoChecks
} {
  const moves = [
    ...new Set([entry.actualMove.chinese, ...availableDisplayMoves(primary)])
  ]
  const allowedMoves = new Set(moves)
  const pvMoves = [
    ...(primary.displayPrincipalVariation ?? []),
    ...(primary.displayUserMovePrincipalVariation ?? [])
  ]
  const uniquePvMoves = [...new Set(pvMoves.filter(Boolean))]
  const headingTokens = REQUIRED_HEADINGS.map((heading) => `### ${heading}`)
  const headingIndexes = headingTokens.map((heading) => finalText.indexOf(heading))
  const qualityIssues = screenExplanationText(finalText, moves)
  const chineseCharCount = countChineseCharacters(finalText)
  const mentionedEvidenceMoves = uniquePvMoves.filter((move) =>
    finalText.includes(move)
  )
  const noFallback = !fallbackUsed(trace)
  const structural: StructuralChecks = {
    requiredHeadingsPresentOnce: headingTokens.every(
      (heading) => countOccurrences(finalText, heading) === 1
    ),
    requiredHeadingsInOrder: headingIndexes.every(
      (position, index) => position >= 0 && (index === 0 || position > headingIndexes[index - 1]!)
    ),
    mentionsActualMove:
      finalText.includes(entry.actualMove.chinese) ||
      Boolean(primary.displayUserMove && finalText.includes(primary.displayUserMove)),
    mentionsBestMove: Boolean(
      primary.displayBestMove && finalText.includes(primary.displayBestMove)
    ),
    atLeastTwoEvidenceMoves: mentionedEvidenceMoves.length >= 2,
    noSelfQuestionAnswer: !/問：|你問我答|\bQ\s*[:：]/iu.test(finalText),
    noFallback,
    productionQualityScreenPassed: qualityIssues.length === 0,
    productionQualityIssues: qualityIssues,
    modelCallsWithinInitialLimit:
      trace !== null && trace.modelCalls >= 1 && trace.modelCalls <= 2,
    zeroEngineRounds: trace?.engineRounds === 0,
    noClarification: !result.clarificationRequired,
    chineseLengthWithinTarget:
      chineseCharCount >= TARGET_MIN_CHINESE_CHARS &&
      chineseCharCount <= TARGET_MAX_CHINESE_CHARS,
    passed: false
  }
  structural.passed = Object.entries(structural).every(([key, value]) =>
    key === 'productionQualityIssues' || key === 'passed'
      ? true
      : value === true
  )

  const forbidden: ForbiddenInfoChecks = {
    noFen:
      !finalText.includes(entry.preMoveFen) &&
      !/(?:[prnbakPRNBAK1-9]+\/){9}[prnbakPRNBAK1-9]+\s+[wb]\b/u.test(
        finalText
      ),
    noUci: !/\b[a-i][0-9][a-i][0-9]\b/iu.test(finalText),
    noEvidenceIds: !/\[(?:E|K|C)\d+\]|\b(?:E|K)\d+\b/iu.test(finalText),
    noRawScores: !/(?:\bcp\b|\bmate\b|[+-]\d+(?:\.\d+)?)/iu.test(finalText),
    noInternalDiagnostics:
      !/\b(?:token|trace|prompt|json|api|uci|fen)\b|模型(?:呼叫|輪次)|證據編號|引擎輪次/iu.test(
        finalText
      ),
    noUnsupportedChineseMoves: mentionedChineseMoves(finalText).every((move) =>
      allowedMoves.has(move)
    ),
    passed: false
  }
  forbidden.passed = Object.entries(forbidden).every(([key, value]) =>
    key === 'passed' ? true : value === true
  )
  return { chineseCharCount, structural, forbidden }
}

function emptyRubric(): RubricCriteria {
  return {
    directActualMoveReason: false,
    actualAndBestChineseMoves: false,
    completeCausalChain: false,
    atLeastTwoRealPvMoves: false,
    noFabricationTurnOrFenError: false,
    noSelfQaOrInternalInfo: false,
    exactlyOneUserClickRequest: false
  }
}

function hasCausalLanguage(text: string): boolean {
  return /因為|因此|所以|導致|使(?!用)|讓|造成|問題(?:是|在於)|錯在|過於[^。！？\n]{0,80}而|未能|放棄|失去/u.test(
    text
  )
}

function scoreRubric(input: {
  finalText: string
  trace: HarnessTrace | null
  result: HarnessRunResult
  structural: StructuralChecks
  forbidden: ForbiddenInfoChecks
  entry: AcceptanceCase
  primary: EngineAnalysis
  purpose: AcceptanceAttempt['purpose']
  requireModelBacked?: boolean
}): {
  criteria: RubricCriteria
  score: number
  majorErrorFlags: string[]
  pass: boolean
} {
  const directStart = input.finalText.indexOf('### 直接結論')
  const directEnd = input.finalText.indexOf('### 實戰步問題')
  const directText =
    directStart >= 0 && directEnd > directStart
      ? input.finalText.slice(directStart, directEnd)
      : ''
  const actualMove =
    input.primary.displayUserMove ?? input.entry.actualMove.chinese
  const directActualMoveReason =
    directText.includes(actualMove) && hasCausalLanguage(directText)
  const traceCompleted = input.trace?.status === 'completed'
  const completionSourceAllowed =
    input.requireModelBacked === false || input.structural.noFallback
  const turnMismatch =
    input.primary.sideToMove === 'red'
      ? /輪到黑方|黑方先行|黑方為行棋方/u.test(input.finalText)
      : /輪到紅方|紅方先行|紅方為行棋方/u.test(input.finalText)
  const criteria: RubricCriteria = {
    directActualMoveReason,
    actualAndBestChineseMoves:
      input.structural.mentionsActualMove && input.structural.mentionsBestMove,
    completeCausalChain:
      input.structural.productionQualityScreenPassed &&
      traceCompleted &&
      hasCausalLanguage(input.finalText),
    atLeastTwoRealPvMoves: input.structural.atLeastTwoEvidenceMoves,
    noFabricationTurnOrFenError:
      traceCompleted &&
      input.forbidden.noFen &&
      input.forbidden.noUci &&
      input.forbidden.noUnsupportedChineseMoves &&
      !turnMismatch &&
      !input.result.clarificationRequired,
    noSelfQaOrInternalInfo:
      input.structural.noSelfQuestionAnswer &&
      input.forbidden.noEvidenceIds &&
      input.forbidden.noRawScores &&
      input.forbidden.noInternalDiagnostics,
    exactlyOneUserClickRequest: input.purpose === 'user_click'
  }
  const score = Number(
    (
      (criteria.directActualMoveReason ? 1.5 : 0) +
      (criteria.actualAndBestChineseMoves ? 1.5 : 0) +
      (criteria.completeCausalChain ? 2 : 0) +
      (criteria.atLeastTwoRealPvMoves ? 1.5 : 0) +
      (criteria.noFabricationTurnOrFenError ? 1.5 : 0) +
      (criteria.noSelfQaOrInternalInfo ? 1 : 0) +
      (criteria.exactlyOneUserClickRequest ? 1 : 0)
    ).toFixed(1)
  )
  const majorErrorFlags = [
    !criteria.directActualMoveReason ? 'missing_direct_actual_move_reason' : null,
    !criteria.actualAndBestChineseMoves ? 'missing_actual_or_best_chinese_move' : null,
    !criteria.noFabricationTurnOrFenError
      ? 'fabrication_turn_fen_or_validation_failure'
      : null,
    !criteria.noSelfQaOrInternalInfo ? 'self_qa_or_internal_info_leak' : null,
    !criteria.exactlyOneUserClickRequest ? 'not_initial_user_click' : null
  ].filter((flag): flag is string => flag !== null)
  return {
    criteria,
    score,
    majorErrorFlags,
    pass:
      score >= 8 && majorErrorFlags.length === 0 && completionSourceAllowed
  }
}

function rubricPassForPurpose(
  rubric: ReturnType<typeof scoreRubric>,
  purpose: AcceptanceAttempt['purpose']
): boolean {
  if (purpose === 'user_click') return rubric.pass
  const contentMajorErrors = rubric.majorErrorFlags.filter(
    (flag) => flag !== 'not_initial_user_click'
  )
  return rubric.score >= 7 && contentMajorErrors.length === 0
}

function displayedOutputPass(input: {
  structural: StructuralChecks
  forbidden: ForbiddenInfoChecks
  rubric: ReturnType<typeof scoreRubric>
  purpose: AcceptanceAttempt['purpose']
}): boolean {
  const structural = input.structural
  return (
    rubricPassForPurpose(input.rubric, input.purpose) &&
    structural.requiredHeadingsPresentOnce &&
    structural.requiredHeadingsInOrder &&
    structural.mentionsActualMove &&
    structural.mentionsBestMove &&
    structural.atLeastTwoEvidenceMoves &&
    structural.noSelfQuestionAnswer &&
    structural.productionQualityScreenPassed &&
    structural.noClarification &&
    structural.chineseLengthWithinTarget &&
    input.forbidden.passed
  )
}

function displayedQualitySignals(
  completionMode: AttemptCompletionMode,
  displayedOutputPassed: boolean
): Pick<
  AcceptanceAttempt,
  'finalDisplayedQualityPass' | 'safeDisplayedFallbackPass'
> {
  return {
    finalDisplayedQualityPass:
      displayedOutputPassed &&
      (completionMode === 'model_response' ||
        completionMode === 'grounded_completion'),
    safeDisplayedFallbackPass:
      displayedOutputPassed && completionMode === 'engine_evidence_fallback'
  }
}

function safeRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null
    ? (value as Record<string, unknown>)
    : null
}

function safeProperty(record: Record<string, unknown> | null, key: string): unknown {
  if (!record) return undefined
  try {
    return record[key]
  } catch {
    return undefined
  }
}

function boundedRetryAfterMs(value: number): number | null {
  if (!Number.isFinite(value) || value < 0) return null
  return Math.min(MAX_OBSERVED_RETRY_AFTER_MS, Math.round(value))
}

function parseRetryAfterValue(
  value: unknown,
  defaultUnit: 'ms' | 'seconds'
): number | null {
  if (typeof value === 'number') {
    return boundedRetryAfterMs(value * (defaultUnit === 'seconds' ? 1_000 : 1))
  }
  if (typeof value !== 'string') return null
  const duration = value.trim().match(/^(\d+(?:\.\d+)?)\s*(ms|s|m)?$/iu)
  if (duration) {
    const amount = Number(duration[1])
    const unit = duration[2]?.toLowerCase() ?? defaultUnit
    const multiplier =
      unit === 'm' ? 60_000 : unit === 's' || unit === 'seconds' ? 1_000 : 1
    return boundedRetryAfterMs(amount * multiplier)
  }
  const retryDate = Date.parse(value)
  return Number.isNaN(retryDate)
    ? null
    : boundedRetryAfterMs(Math.max(0, retryDate - Date.now()))
}

function rateLimitMetadata(error: unknown): {
  rateLimitScope: RateLimitScope
  retryAfterMs: number | null
} {
  const root = safeRecord(error)
  const response = safeRecord(safeProperty(root, 'response'))
  const headers =
    safeRecord(safeProperty(root, 'headers')) ??
    safeRecord(safeProperty(response, 'headers'))
  const detailRecords = [root, safeRecord(safeProperty(root, 'error'))].filter(
    (record): record is Record<string, unknown> => record !== null
  )
  const safeText = detailRecords
    .flatMap((record) =>
      ['message', 'reason', 'code', 'quotaMetric', 'quota_metric', 'quotaId', 'quota_id']
        .map((key) => safeProperty(record, key))
        .filter((value): value is string => typeof value === 'string')
    )
    .join(' ')
  const rateLimitScope: RateLimitScope =
    /\b(?:tpm|tokens?\s+per\s+minute)\b|token[^\n]{0,80}(?:per[_ -]?minute|minute)/iu.test(
      safeText
    )
      ? 'tpm'
      : /\b(?:rpd|requests?\s+per\s+day)\b|request[^\n]{0,80}(?:per[_ -]?day|daily)/iu.test(
            safeText
          )
        ? 'rpd'
        : /\b(?:rpm|requests?\s+per\s+minute)\b|request[^\n]{0,80}(?:per[_ -]?minute|minute)/iu.test(
              safeText
            )
          ? 'rpm'
          : /capacity|resource[_ -]?exhausted|overload|server\s+busy/iu.test(
                safeText
              )
            ? 'capacity'
            : 'unknown'

  const explicitMs =
    safeProperty(root, 'retryAfterMs') ?? safeProperty(root, 'retry_after_ms')
  let retryAfterMs = parseRetryAfterValue(explicitMs, 'ms')
  if (retryAfterMs === null) {
    const seconds =
      safeProperty(root, 'retryAfter') ??
      safeProperty(root, 'retry_after') ??
      safeProperty(headers, 'retry-after') ??
      safeProperty(headers, 'Retry-After')
    retryAfterMs = parseRetryAfterValue(seconds, 'seconds')
  }
  if (retryAfterMs === null) {
    const messageDuration = safeText.match(
      /retry\s+(?:after|in)\s+(\d+(?:\.\d+)?)\s*(ms|milliseconds?|s|seconds?|m|minutes?)/iu
    )
    if (messageDuration) {
      const amount = Number(messageDuration[1])
      const unit = messageDuration[2].toLowerCase()
      retryAfterMs = boundedRetryAfterMs(
        amount * (unit.startsWith('m') && unit !== 'ms' && !unit.startsWith('milli')
          ? 60_000
          : unit.startsWith('s')
            ? 1_000
            : 1)
      )
    }
  }
  return { rateLimitScope, retryAfterMs }
}

function observingProvider(
  inner: AIProvider,
  context: {
    attemptStartedAt: number
    deadlineAt: number
    outerSignal: AbortSignal
    outerDeadlineReached: () => boolean
  }
): ObservedProvider {
  const errors: unknown[] = []
  const internalCalls: InternalModelCallObservation[] = []
  let successfulCalls = 0
  let terminalError: unknown | null = null
  const beginCall = () => {
    const callStartedAt = Date.now()
    const callIndex = internalCalls.length + 1
    return { callStartedAt, callIndex }
  }
  const classifyFailure = (
    error: unknown,
    requestId: string,
    signal?: AbortSignal
  ): Pick<
    InternalModelCallObservation,
    'outcome' | 'errorCode' | 'rateLimitScope' | 'retryAfterMs'
  > => {
    const abortLike =
      signal?.aborted === true ||
      (error instanceof Error &&
        (error.name === 'AbortError' || error.name === 'APIUserAbortError'))
    if (!abortLike) {
      const errorCode = mapStreamingErrorToPayload(requestId, error).code
      return {
        outcome: 'provider_error',
        errorCode,
        ...(errorCode === 'rate_limited'
          ? rateLimitMetadata(error)
          : { rateLimitScope: null, retryAfterMs: null })
      }
    }
    if (context.outerDeadlineReached()) {
      return {
        outcome: 'deadline_abort',
        errorCode: 'deadline_abort',
        rateLimitScope: null,
        retryAfterMs: null
      }
    }
    if (context.outerSignal.aborted) {
      return {
        outcome: 'caller_abort',
        errorCode: 'caller_abort',
        rateLimitScope: null,
        retryAfterMs: null
      }
    }
    return {
      outcome: 'deadline_abort',
      errorCode: 'deadline_abort',
      rateLimitScope: null,
      retryAfterMs: null
    }
  }
  const finishCall = (input: {
    callStartedAt: number
    callIndex: number
    outcome: InternalModelCallOutcome
    errorCode: string | null
    rateLimitScope: RateLimitScope | null
    retryAfterMs: number | null
    responseText: string
    usage?: AIExplanationResponse['usage']
  }) => {
    internalCalls.push({
      callIndex: input.callIndex,
      purpose: input.callIndex === 1 ? 'initial_combined' : 'provider_retry',
      startedOffsetMs: Math.max(
        0,
        input.callStartedAt - context.attemptStartedAt
      ),
      remainingDeadlineMsAtStart: Math.max(
        0,
        context.deadlineAt - input.callStartedAt
      ),
      durationMs: Math.max(0, Date.now() - input.callStartedAt),
      outcome: input.outcome,
      errorCode: input.errorCode,
      rateLimitScope: input.rateLimitScope,
      retryAfterMs: input.retryAfterMs,
      responseFingerprint: input.responseText
        ? sha256(input.responseText)
        : null,
      responseCharCount: input.responseText.length,
      responseChineseCharCount: countChineseCharacters(input.responseText),
      usage: input.usage
        ? {
            inputTokens: input.usage.inputTokens,
            outputTokens: input.usage.outputTokens
          }
        : null,
      validationCodes: []
    })
  }
  return {
    id: inner.id,
    displayName: inner.displayName,
    errors,
    internalCalls,
    get successfulCalls() {
      return successfulCalls
    },
    get terminalError() {
      return terminalError
    },
    async generateExplanation(
      request: AIExplanationRequest,
      signal?: AbortSignal
    ): Promise<AIExplanationResponse> {
      const call = beginCall()
      try {
        const response = await inner.generateExplanation(request, signal)
        successfulCalls += 1
        terminalError = null
        finishCall({
          ...call,
          outcome: 'success',
          errorCode: null,
          rateLimitScope: null,
          retryAfterMs: null,
          responseText: response.text,
          usage: response.usage
        })
        return response
      } catch (error) {
        errors.push(error)
        terminalError = error
        finishCall({
          ...call,
          ...classifyFailure(error, request.metadata.requestId, signal),
          responseText: ''
        })
        throw error
      }
    },
    async *generateExplanationStream(
      request: AIExplanationRequest,
      signal: AbortSignal
    ): AsyncIterable<AIExplanationStreamChunk> {
      const call = beginCall()
      let responseText = ''
      let usage: AIExplanationResponse['usage']
      try {
        for await (const chunk of inner.generateExplanationStream(request, signal)) {
          if (chunk.type === 'text_delta') responseText += chunk.deltaText
          if (chunk.type === 'done') usage = chunk.usage
          yield chunk
        }
        successfulCalls += 1
        terminalError = null
        finishCall({
          ...call,
          outcome: 'success',
          errorCode: null,
          rateLimitScope: null,
          retryAfterMs: null,
          responseText,
          usage
        })
      } catch (error) {
        errors.push(error)
        terminalError = error
        finishCall({
          ...call,
          ...classifyFailure(error, request.metadata.requestId, signal),
          responseText,
          usage
        })
        throw error
      }
    }
  }
}

function traceSummary(trace: HarnessTrace | null): TraceSummary | null {
  return trace
    ? {
        status: trace.status,
        modelCalls: trace.modelCalls,
        engineRounds: trace.engineRounds,
        validationErrors: [...trace.validationErrors]
      }
    : null
}

function stableValidationCodes(trace: HarnessTrace | null): string[] {
  const codes = new Set<string>()
  for (const message of trace?.validationErrors ?? []) {
    if (/內部軟時限|模型階段超過|一次性審查與寫作超過/u.test(message)) {
      codes.add('internal_phase_timeout')
    } else if (/AI 服務未完成/u.test(message)) {
      codes.add('provider_delivery')
    } else if (/JSON/u.test(message)) {
      codes.add('invalid_json')
    } else if (/正文只有|字數|漢字|汉字/u.test(message)) {
      codes.add('min_han')
    } else if (/模型呼叫上限/u.test(message)) {
      codes.add('model_call_limit')
    } else if (/引擎加深輪數上限/u.test(message)) {
      codes.add('engine_round_limit')
    } else if (/保守版|引擎快照直接回答|引擎證據版|fallback/iu.test(message)) {
      codes.add('safe_fallback')
    } else if (/證據|引用|主線|雙引擎|候選著法/u.test(message)) {
      codes.add('audit_grounding')
    } else if (/品質|未達標|修正後/u.test(message)) {
      codes.add('quality_gate')
    } else {
      codes.add('other_validation_issue')
    }
  }
  return [...codes]
}

function attachValidationCodes(
  calls: InternalModelCallObservation[],
  codes: string[]
): void {
  const candidate = calls.find((call) => call.outcome === 'success')
  if (candidate) candidate.validationCodes = [...codes]
}

function attemptCompletionMode(
  result: HarnessRunResult | null,
  trace: HarnessTrace | null,
  calls: InternalModelCallObservation[],
  validationCodes: string[]
): AttemptCompletionMode {
  if (!result) return 'none'
  if (fallbackUsed(trace)) return 'engine_evidence_fallback'
  if (
    calls.some((call) => call.outcome === 'success') &&
    validationCodes.includes('min_han')
  ) {
    return 'grounded_completion'
  }
  if (calls.some((call) => call.outcome === 'success')) return 'model_response'
  return 'engine_evidence_fallback'
}

function completionHasModelBacking(
  mode: AttemptCompletionMode,
  validationCodes: string[]
): boolean {
  return (
    (mode === 'model_response' && validationCodes.length === 0) ||
    (mode === 'grounded_completion' &&
      validationCodes.length > 0 &&
      validationCodes.every((code) => code === 'min_han'))
  )
}

function terminalServiceClassification(input: {
  requestId: string
  timedOut: boolean
  harnessReturned: boolean
  lastServiceError: unknown | null
}): ServiceErrorClassification | null {
  if (input.timedOut) {
    return { code: 'timeout', message: `AI request exceeded ${AI_TIMEOUT_MS}ms.` }
  }
  if (input.harnessReturned) return null
  if (input.lastServiceError) {
    const mapped = mapStreamingErrorToPayload(
      input.requestId,
      input.lastServiceError
    )
    return { code: mapped.code, message: mapped.message }
  }
  return {
    code: 'harness_no_result',
    message: 'The Harness did not return a result.'
  }
}

function findTrace(
  traceStore: HarnessTraceStore,
  traceId: string | null,
  requestId: string
): HarnessTrace | null {
  return (
    traceStore
      .list()
      .find((trace) => trace.id === traceId || trace.requestId === requestId) ?? null
  )
}

async function runHarnessAttempt(input: {
  requestId: string
  attempt: number
  modelRole: 'primary' | 'reference'
  purpose: AcceptanceAttempt['purpose']
  model: string
  apiKey: string
  entry: AcceptanceCase
  session: AnalysisSession
  primary: EngineAnalysis
  registry: EngineRegistryService
  traceStore: HarnessTraceStore
}): Promise<AcceptanceAttempt> {
  const requestId = input.requestId
  const payload: GenerateExplanationStartPayload = {
    requestId,
    analysisId: input.session.analysisId,
    provider: PROVIDER,
    model: input.model,
    userLevel: 'intermediate',
    explanationStyle: 'long_analytical',
    language: 'zh-TW',
    attachedMove: input.entry.actualMove.uci,
    answerMode: 'research',
    budget: {
      engineTimeMs: 20_000,
      maxEngineRounds: 3,
      maxModelCalls: 6,
      maxOutputTokens: 10_000
    },
    engineId: input.session.primaryEngineId,
    verificationEngineId: input.session.verificationEngineId,
    reuseEvidence: true
  }
  const prompt = buildExplanationPrompt({
    engineAnalysis: input.primary,
    moveComparison: input.session.moveComparison,
    userLevel: payload.userLevel,
    explanationStyle: payload.explanationStyle,
    language: payload.language
  })
  const controller = new AbortController()
  activeAbortController = controller
  let timedOut = false
  const startedAt = Date.now()
  const provider = observingProvider(getAIProvider(PROVIDER), {
    attemptStartedAt: startedAt,
    deadlineAt: startedAt + AI_TIMEOUT_MS,
    outerSignal: controller.signal,
    outerDeadlineReached: () => timedOut
  })
  const timeout = setTimeout(() => {
    timedOut = true
    controller.abort()
  }, AI_TIMEOUT_MS)
  let harnessResult: HarnessRunResult | null = null
  try {
    harnessResult = await runExplanationHarness(payload, {
      provider,
      apiKey: input.apiKey,
      model: input.model,
      session: input.session,
      registry: input.registry,
      traceStore: input.traceStore,
      signal: controller.signal,
      onProgress: () => undefined,
      explanationPrompt: prompt
    })
  } catch {
    // The Harness trace and observed provider retain the diagnostic category.
  } finally {
    clearTimeout(timeout)
    if (activeAbortController === controller) activeAbortController = null
  }
  const aiDurationMs = Date.now() - startedAt
  const trace = findTrace(
    input.traceStore,
    harnessResult?.traceId ?? null,
    requestId
  )
  const validationCodes = stableValidationCodes(trace)
  attachValidationCodes(provider.internalCalls, validationCodes)
  const successfulInternalCalls = provider.successfulCalls
  const firstCandidateObserved = successfulInternalCalls > 0
  const timeoutStage: AttemptTimeoutStage = timedOut
    ? 'outer_deadline'
    : provider.internalCalls.some((call) => call.outcome === 'deadline_abort')
      ? 'internal_model_phase'
      : null
  const completionMode = attemptCompletionMode(
    harnessResult,
    trace,
    provider.internalCalls,
    validationCodes
  )
  const lastServiceError = provider.terminalError
  const serviceErrorClassification = terminalServiceClassification({
    requestId,
    timedOut,
    harnessReturned: harnessResult !== null,
    lastServiceError
  })
  if (!harnessResult || serviceErrorClassification) {
    const rubricCriteria = emptyRubric()
    rubricCriteria.exactlyOneUserClickRequest = input.purpose === 'user_click'
    return {
      requestId,
      attempt: input.attempt,
      modelRole: input.modelRole,
      purpose: input.purpose,
      provider: PROVIDER,
      model: input.model,
      aiDurationMs,
      deliveryStatus: 'terminal_service',
      timeoutStage,
      serviceErrorClassification,
      transientServiceErrorCount: Math.max(
        0,
        provider.errors.length - (serviceErrorClassification ? 1 : 0)
      ),
      internalCalls: provider.internalCalls,
      successfulInternalCalls,
      firstCandidateObserved,
      initialModelCandidatePass: firstCandidateObserved ? false : null,
      initialModelIssueCodes: validationCodes,
      completionMode,
      modelBackedQualityPass: false,
      finalDisplayedQualityPass: false,
      safeDisplayedFallbackPass: false,
      finalText: harnessResult?.finalText ?? null,
      finalTextFingerprint: harnessResult ? sha256(harnessResult.finalText) : null,
      trace: traceSummary(trace),
      chineseCharCount: harnessResult
        ? countChineseCharacters(harnessResult.finalText)
        : null,
      structuralChecks: null,
      forbiddenInfoChecks: null,
      rubricCriteria,
      rubricScore0to10: rubricCriteria.exactlyOneUserClickRequest ? 1 : 0,
      majorErrorFlags: [
        serviceErrorClassification
          ? `service_${serviceErrorClassification.code}`
          : 'harness_did_not_return'
      ],
      displayedRubricCriteria: rubricCriteria,
      displayedRubricScore0to10:
        rubricCriteria.exactlyOneUserClickRequest ? 1 : 0,
      displayedMajorErrorFlags: [
        serviceErrorClassification
          ? `service_${serviceErrorClassification.code}`
          : 'harness_did_not_return'
      ],
      firstClickQualityPass: false,
      passed: false
    }
  }
  const checked = evaluateText(
    harnessResult.finalText,
    harnessResult,
    trace,
    input.entry,
    input.primary
  )
  const rubric = scoreRubric({
    finalText: harnessResult.finalText,
    trace,
    result: harnessResult,
    structural: checked.structural,
    forbidden: checked.forbidden,
    entry: input.entry,
    primary: input.primary,
    purpose: input.purpose
  })
  const displayedRubric = scoreRubric({
    finalText: harnessResult.finalText,
    trace,
    result: harnessResult,
    structural: checked.structural,
    forbidden: checked.forbidden,
    entry: input.entry,
    primary: input.primary,
    purpose: input.purpose,
    requireModelBacked: false
  })
  const displayedOutputPassed = displayedOutputPass({
    structural: checked.structural,
    forbidden: checked.forbidden,
    rubric: displayedRubric,
    purpose: input.purpose
  })
  const displayedQuality = displayedQualitySignals(
    completionMode,
    displayedOutputPassed
  )
  const modelBackedQualityPass =
    completionHasModelBacking(completionMode, validationCodes) &&
    checked.structural.noFallback &&
    checked.structural.modelCallsWithinInitialLimit &&
    checked.structural.zeroEngineRounds &&
    displayedOutputPass({
      structural: checked.structural,
      forbidden: checked.forbidden,
      rubric,
      purpose: input.purpose
    })
  return {
    requestId,
    attempt: input.attempt,
    modelRole: input.modelRole,
    purpose: input.purpose,
    provider: PROVIDER,
    model: input.model,
    aiDurationMs,
    deliveryStatus: 'completed',
    timeoutStage,
    serviceErrorClassification: null,
    transientServiceErrorCount: provider.errors.length,
    internalCalls: provider.internalCalls,
    successfulInternalCalls,
    firstCandidateObserved,
    initialModelCandidatePass:
      firstCandidateObserved &&
      completionMode === 'model_response' &&
      validationCodes.length === 0
        ? modelBackedQualityPass
        : firstCandidateObserved
          ? false
          : null,
    initialModelIssueCodes: validationCodes,
    completionMode,
    modelBackedQualityPass,
    ...displayedQuality,
    finalText: harnessResult.finalText,
    finalTextFingerprint: sha256(harnessResult.finalText),
    trace: traceSummary(trace),
    chineseCharCount: checked.chineseCharCount,
    structuralChecks: checked.structural,
    forbiddenInfoChecks: checked.forbidden,
    rubricCriteria: rubric.criteria,
    rubricScore0to10: rubric.score,
    majorErrorFlags: rubric.majorErrorFlags,
    displayedRubricCriteria: displayedRubric.criteria,
    displayedRubricScore0to10: displayedRubric.score,
    displayedMajorErrorFlags: displayedRubric.majorErrorFlags,
    firstClickQualityPass:
      input.purpose === 'user_click' && modelBackedQualityPass,
    passed: modelBackedQualityPass
  }
}

function interruptedAttempt(start: AcceptanceAttemptStart): AcceptanceAttempt {
  const rubricCriteria = emptyRubric()
  rubricCriteria.exactlyOneUserClickRequest = start.purpose === 'user_click'
  return {
    ...start,
    aiDurationMs: 0,
    deliveryStatus: 'terminal_service',
    timeoutStage: null,
    serviceErrorClassification: {
      code: 'indeterminate_interrupted_request',
      message:
        'The request was durably started but no completion was saved; it was not replayed.'
    },
    transientServiceErrorCount: 0,
    internalCalls: [],
    successfulInternalCalls: 0,
    firstCandidateObserved: false,
    initialModelCandidatePass: null,
    initialModelIssueCodes: [],
    completionMode: 'none',
    modelBackedQualityPass: false,
    finalDisplayedQualityPass: false,
    safeDisplayedFallbackPass: false,
    finalText: null,
    finalTextFingerprint: null,
    trace: null,
    chineseCharCount: null,
    structuralChecks: null,
    forbiddenInfoChecks: null,
    rubricCriteria,
    rubricScore0to10: rubricCriteria.exactlyOneUserClickRequest ? 1 : 0,
    majorErrorFlags: ['service_indeterminate_interrupted_request'],
    displayedRubricCriteria: rubricCriteria,
    displayedRubricScore0to10:
      rubricCriteria.exactlyOneUserClickRequest ? 1 : 0,
    displayedMajorErrorFlags: ['service_indeterminate_interrupted_request'],
    firstClickQualityPass: false,
    passed: false
  }
}

function appendCheckpoint(path: string, record: CheckpointRecord): void {
  if (existsSync(path)) {
    const info = lstatSync(path)
    if (info.isSymbolicLink() || !info.isFile()) {
      throw new Error('Refusing to append to a non-regular soak checkpoint.')
    }
  }
  const fd = openSync(path, 'a', 0o600)
  try {
    appendFileSync(fd, `${JSON.stringify(record)}\n`, 'utf8')
    fsyncSync(fd)
  } finally {
    closeSync(fd)
  }
}

function readCheckpoint(path: string, runKey: string): {
  attemptStarts: Map<
    string,
    Array<{ start: AcceptanceAttemptStart; evidenceFingerprint: string }>
  >
  attempts: Map<
    string,
    Array<{ attempt: AcceptanceAttempt; evidenceFingerprint: string }>
  >
  evidence: Map<
    string,
    NonNullable<CheckpointRecord['evidence']>
  >
  completed: Map<string, CaseResult>
} {
  const attemptStarts = new Map<
    string,
    Array<{ start: AcceptanceAttemptStart; evidenceFingerprint: string }>
  >()
  const attempts = new Map<
    string,
    Array<{ attempt: AcceptanceAttempt; evidenceFingerprint: string }>
  >()
  const evidence = new Map<
    string,
    NonNullable<CheckpointRecord['evidence']>
  >()
  const completed = new Map<string, CaseResult>()
  if (!existsSync(path)) return { attemptStarts, attempts, evidence, completed }
  const info = lstatSync(path)
  if (info.isSymbolicLink() || !info.isFile()) {
    throw new Error('Refusing to read a non-regular soak checkpoint.')
  }
  const bytes = readFileSync(path)
  const lastNewline = bytes.lastIndexOf(0x0a)
  const validLength = lastNewline >= 0 ? lastNewline + 1 : 0
  if (validLength < bytes.length) {
    truncateSync(path, validLength)
    console.warn(
      `Recovered soak checkpoint by discarding ${bytes.length - validLength} truncated trailing bytes.`
    )
  }
  const lines = bytes
    .subarray(0, validLength)
    .toString('utf8')
    .split(/\r?\n/)
    .filter(Boolean)
  for (const line of lines) {
    const record = JSON.parse(line) as CheckpointRecord
    if (record.schemaVersion !== 1 || record.runKey !== runKey) {
      throw new Error(
        'Existing soak checkpoint belongs to a different manifest, engine, model, or check version.'
      )
    }
    if (
      !['meta', 'evidence', 'attempt_started', 'attempt', 'case_complete'].includes(
        record.type
      )
    ) {
      throw new Error('Soak checkpoint contains an unknown record type.')
    }
    if (
      record.type === 'evidence' &&
      (!record.caseId || !record.evidenceFingerprint || !record.evidence)
    ) {
      throw new Error('Soak checkpoint contains an incomplete evidence record.')
    }
    if (
      record.type === 'attempt_started' &&
      (!record.caseId || !record.evidenceFingerprint || !record.attemptStart)
    ) {
      throw new Error('Soak checkpoint contains an incomplete attempt start record.')
    }
    if (
      record.type === 'attempt' &&
      (!record.caseId || !record.evidenceFingerprint || !record.attempt)
    ) {
      throw new Error('Soak checkpoint contains an incomplete attempt record.')
    }
    if (
      record.type === 'case_complete' &&
      (!record.caseId || !record.evidenceFingerprint || !record.result)
    ) {
      throw new Error('Soak checkpoint contains an incomplete completion record.')
    }
    if (
      record.type === 'evidence' &&
      record.caseId &&
      record.evidenceFingerprint &&
      record.evidence
    ) {
      if (
        fingerprintEvidence(record.evidence.packet) !==
        record.evidenceFingerprint
      ) {
        throw new Error(`${record.caseId} checkpoint evidence fingerprint is invalid.`)
      }
      if (!savedAnalysesMatchPacket(record.evidence)) {
        throw new Error(`${record.caseId} checkpoint saved analyses are invalid.`)
      }
      evidence.set(record.caseId, record.evidence)
    }
    if (
      record.type === 'attempt_started' &&
      record.caseId &&
      record.attemptStart &&
      record.evidenceFingerprint
    ) {
      const list = attemptStarts.get(record.caseId) ?? []
      list.push({
        start: record.attemptStart,
        evidenceFingerprint: record.evidenceFingerprint
      })
      attemptStarts.set(record.caseId, list)
    }
    if (
      record.type === 'attempt' &&
      record.caseId &&
      record.attempt &&
      record.evidenceFingerprint
    ) {
      const list = attempts.get(record.caseId) ?? []
      list.push({
        attempt: record.attempt,
        evidenceFingerprint: record.evidenceFingerprint
      })
      attempts.set(record.caseId, list)
    }
    if (
      record.type === 'case_complete' &&
      record.caseId &&
      record.evidenceFingerprint &&
      record.result
    ) {
      if (
        fingerprintEvidence(record.result.evidence) !==
          record.result.evidenceFingerprint ||
        record.evidenceFingerprint !== record.result.evidenceFingerprint
      ) {
        throw new Error(`${record.caseId} completed checkpoint evidence is invalid.`)
      }
      completed.set(record.caseId, record.result)
    }
  }
  for (const [caseId, savedAttempts] of attempts) {
    const savedEvidence = evidence.get(caseId)
    if (!savedEvidence) {
      throw new Error(`${caseId} has attempts without a saved evidence packet.`)
    }
    const fingerprint = fingerprintEvidence(savedEvidence.packet)
    if (
      savedAttempts.some(
        (savedAttempt) => savedAttempt.evidenceFingerprint !== fingerprint
      )
    ) {
      throw new Error(`${caseId} checkpoint attempts mix different engine evidence.`)
    }
    if (
      new Set(savedAttempts.map((entry) => entry.attempt.requestId)).size !==
      savedAttempts.length
    ) {
      throw new Error(`${caseId} checkpoint repeats a completed request ID.`)
    }
    const savedStarts = attemptStarts.get(caseId)
    if (!savedStarts) {
      throw new Error(`${caseId} has attempts without fsynced start records.`)
    }
    for (const { attempt } of savedAttempts) {
      const start = savedStarts.find(
        (entry) => entry.start.requestId === attempt.requestId
      )?.start
      if (
        !start ||
        start.attempt !== attempt.attempt ||
        start.modelRole !== attempt.modelRole ||
        start.purpose !== attempt.purpose ||
        start.provider !== attempt.provider ||
        start.model !== attempt.model
      ) {
        throw new Error(`${caseId} checkpoint attempt does not match its start record.`)
      }
    }
  }
  for (const [caseId, starts] of attemptStarts) {
    const savedEvidence = evidence.get(caseId)
    if (!savedEvidence) {
      throw new Error(`${caseId} has attempt starts without a saved evidence packet.`)
    }
    const fingerprint = fingerprintEvidence(savedEvidence.packet)
    if (starts.some((entry) => entry.evidenceFingerprint !== fingerprint)) {
      throw new Error(`${caseId} checkpoint attempt starts mix different engine evidence.`)
    }
    const requestIds = starts.map((entry) => entry.start.requestId)
    if (new Set(requestIds).size !== requestIds.length) {
      throw new Error(`${caseId} checkpoint repeats an attempt request ID.`)
    }
    const completedRequestIds = new Set(
      (attempts.get(caseId) ?? []).map((entry) => entry.attempt.requestId)
    )
    if (
      [...completedRequestIds].some(
        (requestId) => !requestIds.includes(requestId)
      )
    ) {
      throw new Error(`${caseId} checkpoint has an attempt without a matching start.`)
    }
  }
  for (const [caseId, result] of completed) {
    const savedEvidence = evidence.get(caseId)
    if (!savedEvidence) {
      throw new Error(`${caseId} completion record has no saved evidence.`)
    }
    if (fingerprintEvidence(savedEvidence.packet) !== result.evidenceFingerprint) {
      throw new Error(`${caseId} completion record mixes different engine evidence.`)
    }
    const savedCaseAttempts = (attempts.get(caseId) ?? []).map(
      (entry) => entry.attempt
    )
    if (JSON.stringify(savedCaseAttempts) !== JSON.stringify(result.attempts)) {
      throw new Error(`${caseId} completion record does not match saved attempts.`)
    }
    const finishedRequestIds = new Set(
      (attempts.get(caseId) ?? []).map((entry) => entry.attempt.requestId)
    )
    if (
      (attemptStarts.get(caseId) ?? []).some(
        (entry) => !finishedRequestIds.has(entry.start.requestId)
      )
    ) {
      throw new Error(`${caseId} completion record has an unfinished request.`)
    }
  }
  return { attemptStarts, attempts, evidence, completed }
}

function failedCheckNames(result: CaseResult): string[] {
  const failed: string[] = []
  if (result.userClickRequestCount !== 1) failed.push('user_click.count_not_one')
  if (!result.modelBackedQualityPass) {
    failed.push('quality.model_backed_failed')
  }
  if (!result.finalDisplayedQualityPass) {
    failed.push('quality.final_displayed_failed')
  }
  if (result.rubricScore0to10 < 8) failed.push('rubric.score_below_8')
  failed.push(...result.majorErrorFlags.map((flag) => `major.${flag}`))
  if (result.responsibility === 'engine_local') failed.push('engine.local_execution')
  if (result.responsibility === 'model') {
    failed.push('responsibility.model')
  }
  if (result.responsibility === 'data_or_loop') {
    failed.push('responsibility.data_or_loop')
  }
  for (const [name, value] of Object.entries(result.structuralChecks ?? {})) {
    if (name !== 'productionQualityIssues' && name !== 'passed' && value === false) {
      failed.push(`structural.${name}`)
    }
  }
  for (const [name, value] of Object.entries(result.forbiddenInfoChecks ?? {})) {
    if (name !== 'passed' && value === false) failed.push(`forbidden.${name}`)
  }
  if (result.fallbackUsed) failed.push('fallbackUsed')
  if (result.serviceErrorClassification) {
    failed.push(`service.${result.serviceErrorClassification.code}`)
  }
  return failed
}

function aggregate(cases: CaseResult[]): ResultArtifact['aggregate'] {
  return {
    completedCases: cases.length,
    initialModelCandidatePasses: cases.filter(
      (entry) => entry.initialModelCandidatePass === true
    ).length,
    firstClickQualityPasses: cases.filter(
      (entry) => entry.firstClickQualityPass
    ).length,
    finalDisplayedQualityPasses: cases.filter(
      (entry) => entry.finalDisplayedQualityPass
    ).length,
    safeDisplayedFallbackPasses: cases.filter(
      (entry) => entry.safeDisplayedFallbackPass
    ).length,
    exactOneUserClickCases: cases.filter(
      (entry) => entry.userClickRequestCount === 1
    ).length,
    engineDuration: timingSummary(
      cases.map((entry) => entry.engineDurationMs)
    ),
    aiDuration: timingSummary(cases.map((entry) => entry.aiDurationMs)),
    firstClickRubric: {
      medianScore0to10: percentile(
        cases.map((entry) => entry.rubricScore0to10),
        0.5
      ),
      minimumScore0to10:
        cases.length > 0
          ? Math.min(...cases.map((entry) => entry.rubricScore0to10))
          : null,
      below8Cases: cases.filter((entry) => entry.rubricScore0to10 < 8).length,
      majorErrorCases: cases.filter(
        (entry) => entry.majorErrorFlags.length > 0
      ).length
    },
    failures: cases
      .filter((entry) => !entry.passed)
      .map((entry) => ({
        caseId: entry.caseId,
        responsibility: entry.responsibility,
        serviceCode: entry.serviceErrorClassification?.code ?? null,
        failedChecks: failedCheckNames(entry)
      }))
  }
}

function writeResultArtifact(
  path: string,
  base: Omit<ResultArtifact, 'status' | 'cases' | 'aggregate' | 'completedAt'>,
  cases: CaseResult[],
  complete: boolean
): void {
  writeJsonFileAtomic(
    path,
    {
      ...base,
      status: complete ? 'complete' : 'in_progress',
      ...(complete ? { completedAt: new Date().toISOString() } : {}),
      cases,
      aggregate: aggregate(cases)
    } satisfies ResultArtifact,
    RESULT_MAX_BYTES
  )
}

function primaryDeliveryUnavailable(attempts: AcceptanceAttempt[]): boolean {
  const primaryAttempts = attempts.filter(
    (attempt) => attempt.modelRole === 'primary'
  )
  return (
    primaryAttempts.length > 0 &&
    primaryAttempts.every((attempt) => !attempt.firstCandidateObserved) &&
    primaryAttempts.some((attempt) =>
      attempt.internalCalls.some((call) => call.outcome !== 'success')
    )
  )
}

function primaryClickDeliveryFallbackIsTerminal(
  attempts: AcceptanceAttempt[]
): boolean {
  const firstClick = attempts.find(
    (attempt) =>
      attempt.modelRole === 'primary' && attempt.purpose === 'user_click'
  )
  return Boolean(
    firstClick &&
      firstClick.deliveryStatus === 'completed' &&
      firstClick.completionMode === 'engine_evidence_fallback' &&
      firstClick.finalText &&
      !firstClick.firstCandidateObserved &&
      firstClick.internalCalls.length > 0 &&
      firstClick.internalCalls.every((call) => call.outcome !== 'success')
  )
}

function serviceClassificationFromAttempts(
  attempts: AcceptanceAttempt[]
): ServiceErrorClassification | null {
  const terminal = attempts.find(
    (attempt) => attempt.serviceErrorClassification !== null
  )?.serviceErrorClassification
  const deliveryUnavailable = primaryDeliveryUnavailable(attempts)
  if (terminal && terminal.code !== 'timeout' && terminal.code !== 'harness_no_result') {
    return terminal
  }
  if (!deliveryUnavailable) return terminal ?? null
  const primaryCalls = attempts
    .filter((attempt) => attempt.modelRole === 'primary')
    .flatMap((attempt) => attempt.internalCalls)
  const errorCodes = primaryCalls
    .map((call) => call.errorCode)
    .filter(
      (code): code is string =>
        code !== null && code !== 'deadline_abort' && code !== 'caller_abort'
    )
  const preciseCode = [
    'missing_api_key',
    'unsupported_model',
    'invalid_request',
    'rate_limited',
    'network_error',
    'provider_error',
    'unknown_error'
  ].find((code) => errorCodes.includes(code)) ?? errorCodes[0]
  if (preciseCode) {
    const messages: Record<string, string> = {
      missing_api_key: 'The exact primary model credential was unavailable.',
      unsupported_model: 'The configured primary model was unsupported.',
      invalid_request: 'The primary model request was rejected as invalid.',
      rate_limited: 'Primary model delivery was rate limited before a candidate returned.',
      network_error: 'A network error prevented the primary model candidate from returning.',
      provider_error: 'The primary model provider rejected the request before a candidate returned.',
      unknown_error: 'Primary model delivery failed before a candidate returned.'
    }
    return {
      code: preciseCode,
      message:
        messages[preciseCode] ??
        'Primary model delivery failed before a candidate returned.'
    }
  }
  if (terminal) return terminal
  const outcomes = primaryCalls.map((call) => call.outcome)
  if (outcomes.includes('deadline_abort')) {
    return {
      code: 'model_phase_timeout',
      message:
        'No primary model candidate was returned before the internal model deadlines; the Harness completed from engine evidence.'
    }
  }
  if (outcomes.includes('caller_abort')) {
    return {
      code: 'model_delivery_cancelled',
      message: 'Primary model delivery was cancelled before a candidate returned.'
    }
  }
  return {
    code: 'model_delivery_failed',
    message:
      'No primary model candidate was returned; the Harness completed from engine evidence.'
  }
}

function resultFromAttempts(input: {
  entry: AcceptanceCase
  packet: EvidencePacket
  attempts: AcceptanceAttempt[]
  responsibility: Responsibility
}): CaseResult {
  const userClickAttempts = input.attempts.filter(
    (attempt) => attempt.purpose === 'user_click'
  )
  const firstPrimary = userClickAttempts[0] ?? null
  const fallback = Boolean(
    firstPrimary?.trace?.validationErrors.some((message) =>
      /保守版|引擎快照直接回答|引擎證據版|fallback/i.test(message)
    )
  )
  return {
    caseId: input.entry.caseId,
    gameId: input.entry.gameId,
    ply: input.entry.ply,
    evidenceFingerprint: fingerprintEvidence(input.packet),
    evidence: input.packet,
    provider: PROVIDER,
    model: firstPrimary?.model ?? PRIMARY_MODEL,
    engineDurationMs: input.packet.parallelEngineDurationMs,
    aiDurationMs: firstPrimary?.aiDurationMs ?? null,
    diagnosticRetryDurationMs: input.attempts
      .filter((attempt) => attempt !== firstPrimary)
      .reduce((sum, attempt) => sum + attempt.aiDurationMs, 0),
    serviceErrorClassification: serviceClassificationFromAttempts(input.attempts),
    finalText: firstPrimary?.finalText ?? null,
    finalTextFingerprint: firstPrimary?.finalTextFingerprint ?? null,
    trace: firstPrimary?.trace ?? null,
    structuralChecks: firstPrimary?.structuralChecks ?? null,
    forbiddenInfoChecks: firstPrimary?.forbiddenInfoChecks ?? null,
    chineseCharCount: firstPrimary?.chineseCharCount ?? null,
    fallbackUsed: fallback,
    userClickRequestCount: userClickAttempts.length,
    rubricCriteria: firstPrimary?.rubricCriteria ?? emptyRubric(),
    rubricScore0to10: firstPrimary?.rubricScore0to10 ?? 0,
    majorErrorFlags: firstPrimary?.majorErrorFlags ?? ['missing_user_click'],
    displayedRubricCriteria:
      firstPrimary?.displayedRubricCriteria ?? emptyRubric(),
    displayedRubricScore0to10:
      firstPrimary?.displayedRubricScore0to10 ?? 0,
    displayedMajorErrorFlags:
      firstPrimary?.displayedMajorErrorFlags ?? ['missing_user_click'],
    initialModelCandidatePass:
      firstPrimary?.initialModelCandidatePass ?? null,
    modelBackedQualityPass: Boolean(firstPrimary?.modelBackedQualityPass),
    finalDisplayedQualityPass: Boolean(firstPrimary?.finalDisplayedQualityPass),
    safeDisplayedFallbackPass: Boolean(firstPrimary?.safeDisplayedFallbackPass),
    firstClickQualityPass:
      userClickAttempts.length === 1 &&
      Boolean(firstPrimary?.firstClickQualityPass),
    attempts: input.attempts,
    responsibility: input.responsibility,
    diagnosisLimitations:
      input.responsibility === 'data_or_loop' &&
      !input.attempts.some((attempt) => attempt.modelRole === 'reference')
        ? ['reference_model_exact_credential_unavailable']
        : [],
    passed:
      userClickAttempts.length === 1 &&
      Boolean(firstPrimary?.firstClickQualityPass)
  }
}

function invalidAttemptHistory(
  attempts: AcceptanceAttempt[],
  referenceModel: string | null
): string | null {
  if (attempts.length === 0) return null
  const primaryAttempts = attempts.filter(
    (attempt) => attempt.modelRole === 'primary'
  )
  const referenceAttempts = attempts.filter(
    (attempt) => attempt.modelRole === 'reference'
  )
  if (
    primaryAttempts.length === 0 ||
    primaryAttempts.length > PRIMARY_CONTENT_ATTEMPTS ||
    referenceAttempts.length > 1 ||
    attempts.some((attempt, index) =>
      index < primaryAttempts.length
        ? attempt.modelRole !== 'primary'
        : attempt.modelRole !== 'reference'
    )
  ) {
    return 'attempt role ordering is invalid'
  }
  const terminalServiceIndex = attempts.findIndex(
    (attempt) => attempt.serviceErrorClassification !== null
  )
  if (terminalServiceIndex >= 0 && terminalServiceIndex !== attempts.length - 1) {
    return 'an attempt followed a terminal service failure'
  }
  for (const [index, attempt] of primaryAttempts.entries()) {
    if (
      attempt.attempt !== index + 1 ||
      attempt.provider !== PROVIDER ||
      attempt.model !== PRIMARY_MODEL ||
      attempt.purpose !== (index === 0 ? 'user_click' : 'diagnostic_replay')
    ) {
      return 'primary attempt sequence is invalid'
    }
  }
  const first = primaryAttempts[0]!
  if (
    primaryAttempts.length > 1 &&
    (first.firstClickQualityPass ||
      first.serviceErrorClassification !== null ||
      primaryClickDeliveryFallbackIsTerminal([first]))
  ) {
    return 'diagnostic replay followed a terminal first click'
  }
  const reference = referenceAttempts[0]
  if (
    reference &&
    (!referenceModel ||
      reference.provider !== PROVIDER ||
      reference.model !== referenceModel ||
      reference.attempt !== 1 ||
      reference.purpose !== 'reference_diagnosis' ||
      primaryAttempts.length !== PRIMARY_CONTENT_ATTEMPTS ||
      primaryAttempts.some(
        (attempt) => attempt.passed || attempt.serviceErrorClassification !== null
      ))
  ) {
    return 'reference attempt sequence is invalid'
  }
  return null
}

async function analyzeCase(input: {
  entry: AcceptanceCase
  config: AnalysisConfig
  primaryAdapter: PikafishAdapter
  verificationAdapter: PikafishAdapter
  enginePaths: string[]
}): Promise<
  | {
      ok: true
      primary: EngineAnalysis
      verification: EngineAnalysis
      packet: EvidencePacket
    }
  | { ok: false; packet: EvidencePacket }
> {
  const engineStartedAt = Date.now()
  const controller = new AbortController()
  activeAbortController = controller
  const [primaryResult, verificationResult] = await Promise.allSettled([
    input.primaryAdapter.analyzePosition(
      { positionFen: input.entry.preMoveFen, userMove: input.entry.actualMove.uci },
      input.config,
      { signal: controller.signal }
    ),
    input.verificationAdapter.analyzePosition(
      { positionFen: input.entry.preMoveFen, userMove: input.entry.actualMove.uci },
      input.config,
      { signal: controller.signal }
    )
  ])
  if (activeAbortController === controller) activeAbortController = null
  const primaryPacket =
    primaryResult.status === 'fulfilled'
      ? successfulEnginePacket(primaryResult.value)
      : failedEnginePacket(primaryResult.reason, input.enginePaths)
  const verificationPacket =
    verificationResult.status === 'fulfilled'
      ? successfulEnginePacket(verificationResult.value)
      : failedEnginePacket(verificationResult.reason, input.enginePaths)
  const packet = evidencePacket(
    input.entry,
    input.config,
    Date.now() - engineStartedAt,
    primaryResult.status === 'fulfilled' &&
      verificationResult.status === 'fulfilled'
      ? fingerprintAnalyses(primaryResult.value, verificationResult.value)
      : null,
    primaryPacket,
    verificationPacket
  )
  if (primaryResult.status !== 'fulfilled' || verificationResult.status !== 'fulfilled') {
    return { ok: false, packet }
  }
  return {
    ok: true,
    primary: primaryResult.value,
    verification: verificationResult.value,
    packet
  }
}

function buildSession(
  entry: AcceptanceCase,
  primary: EngineAnalysis,
  primaryEngineId: string
): AnalysisSession {
  const now = Date.now()
  return {
    analysisId: randomUUID(),
    requestId: `engine-acceptance-${randomUUID()}`,
    createdAt: new Date(now).toISOString(),
    expiresAt: new Date(now + 2 * 60 * 60 * 1000).toISOString(),
    positionFen: entry.preMoveFen,
    userMove: entry.actualMove.uci,
    primaryEngineId,
    engineAnalysis: primary,
    moveComparison: compareMove(primary)
  }
}

async function runLive(input: {
  suite: LoadedSuite
  primaryApiKey: string
  referenceModel: string | null
  referenceApiKey: string | null
  registry: EngineRegistryService
  primary: EngineInstallation
  acceptanceCrossCheck: AcceptanceCrossCheckEngine
  primarySha256: string
  crossCheckSha256: string
}): Promise<number> {
  const runKey = sha256(
    JSON.stringify({
      sourceFingerprint: input.suite.sourceFingerprint,
      analysisConfig: input.suite.analysisConfig,
      primarySha256: input.primarySha256,
      crossCheckSha256: input.crossCheckSha256,
      primaryModel: PRIMARY_MODEL,
      referenceModel: input.referenceModel,
      aiTimeoutMs: AI_TIMEOUT_MS,
      checkVersion: CHECK_VERSION
    })
  )
  const generatedAt = new Date().toISOString()
  const base: Omit<
    ResultArtifact,
    'status' | 'cases' | 'aggregate' | 'completedAt'
  > = {
    ...artifactVersionMetadata(),
    suite: input.suite.name,
    generatedAt,
    sourceFingerprint: input.suite.sourceFingerprint,
    runKey,
    provider: PROVIDER,
    primaryModel: PRIMARY_MODEL,
    referenceModel: input.referenceModel,
    credentialBinding: 'exact_provider_model',
    aiTimeoutMs: AI_TIMEOUT_MS,
    harnessEngineMode: 'configured_primary_only',
    initialRequestContract: 'exactly_one_user_click_per_case',
    qualityAxes: {
      initialModelCandidatePass:
        'raw_first_model_candidate_before_local_completion',
      firstClickQualityPass:
        'model_response_or_grounded_completion_without_engine_fallback',
      finalDisplayedQualityPass:
        'visible_full_five_section_explanation_excluding_engine_fallback',
      safeDisplayedFallbackPass:
        'safe_visible_engine_evidence_fallback_not_full_explanation_quality',
      rubricScore0to10: 'model_backed',
      displayedRubricScore0to10:
        'displayed_content_criteria_not_full_explanation_acceptance'
    },
    analysisConfig: input.suite.analysisConfig,
    engines: {
      primary: {
        id: input.primary.id,
        name: input.primary.detectedName ?? input.primary.displayName,
        binarySha256: input.primarySha256
      },
      acceptanceCrossCheck: {
        id: input.acceptanceCrossCheck.id,
        name: input.acceptanceCrossCheck.displayName,
        binarySha256: input.crossCheckSha256,
        purpose: 'acceptance_cross_check_same_package_cpu_build'
      }
    },
    expectedCases: input.suite.cases.length
  }
  const checkpoint = input.suite.checkpointPath
    ? readCheckpoint(input.suite.checkpointPath, runKey)
    : {
        attemptStarts: new Map<
          string,
          Array<{ start: AcceptanceAttemptStart; evidenceFingerprint: string }>
        >(),
        attempts: new Map<
          string,
          Array<{ attempt: AcceptanceAttempt; evidenceFingerprint: string }>
        >(),
        evidence: new Map<
          string,
          NonNullable<CheckpointRecord['evidence']>
        >(),
        completed: new Map<string, CaseResult>()
      }
  if (input.suite.checkpointPath && !existsSync(input.suite.checkpointPath)) {
    appendCheckpoint(input.suite.checkpointPath, {
      schemaVersion: 1,
      runKey,
      type: 'meta',
      at: generatedAt
    })
  }

  const tempDir = mkdtempSync(join(tmpdir(), 'xqa-ai-acceptance-'))
  const traceStore = new HarnessTraceStore(new StorageService(tempDir))
  const primaryAdapter = new PikafishAdapter(
    input.primary.executablePath,
    input.primary.protocol,
    input.primary.displayName,
    input.primary.id
  )
  const verificationAdapter = new PikafishAdapter(
    input.acceptanceCrossCheck.executablePath,
    input.acceptanceCrossCheck.protocol,
    input.acceptanceCrossCheck.displayName,
    input.acceptanceCrossCheck.id
  )
  const results: CaseResult[] = []
  try {
    const [primaryTest, verificationTest] = await Promise.all([
      primaryAdapter.test(),
      verificationAdapter.test()
    ])
    if (!primaryTest.ok || !verificationTest.ok) {
      throw new Error(
        'Primary or acceptance cross-check engine self-test failed; no AI request was sent.'
      )
    }
    if (
      primaryTest.engineName &&
      verificationTest.engineName &&
      primaryTest.engineName !== verificationTest.engineName
    ) {
      throw new Error(
        'Acceptance cross-check build reports a different engine version.'
      )
    }
    base.engines.primary.name =
      primaryTest.engineName ?? base.engines.primary.name
    base.engines.acceptanceCrossCheck.name =
      verificationTest.engineName ?? base.engines.acceptanceCrossCheck.name

    for (const [index, entry] of input.suite.cases.entries()) {
      if (shutdownRequested) throw new Error('Acceptance runner interrupted.')
      const completed = checkpoint.completed.get(entry.caseId)
      if (completed) {
        const historyError = invalidAttemptHistory(
          completed.attempts,
          input.referenceModel
        )
        const canonical = resultFromAttempts({
          entry,
          packet: completed.evidence,
          attempts: completed.attempts,
          responsibility: completed.responsibility
        })
        if (historyError || JSON.stringify(completed) !== JSON.stringify(canonical)) {
          throw new Error(
            `${entry.caseId} completed checkpoint is not a canonical acceptance result${historyError ? `: ${historyError}` : ''}.`
          )
        }
        results.push(completed)
        console.log(`[${index + 1}/${input.suite.cases.length}] ${entry.caseId} resumed`)
        continue
      }
      const savedEvidence = checkpoint.evidence.get(entry.caseId)
      const analyzed = savedEvidence
        ? savedEvidence.primaryAnalysis &&
          savedEvidence.acceptanceCrossCheckAnalysis
          ? {
              ok: true as const,
              primary: savedEvidence.primaryAnalysis,
              verification: savedEvidence.acceptanceCrossCheckAnalysis,
              packet: savedEvidence.packet
            }
          : { ok: false as const, packet: savedEvidence.packet }
        : await analyzeCase({
            entry,
            config: input.suite.analysisConfig,
            primaryAdapter,
            verificationAdapter,
            enginePaths: [
              input.primary.executablePath,
              input.acceptanceCrossCheck.executablePath
            ]
          })
      if (shutdownRequested) throw new Error('Acceptance runner interrupted.')
      const currentEvidenceFingerprint = fingerprintEvidence(analyzed.packet)
      if (!savedEvidence && input.suite.checkpointPath) {
        appendCheckpoint(input.suite.checkpointPath, {
          schemaVersion: 1,
          runKey,
          type: 'evidence',
          at: new Date().toISOString(),
          caseId: entry.caseId,
          evidenceFingerprint: currentEvidenceFingerprint,
          evidence: {
            packet: analyzed.packet,
            primaryAnalysis: analyzed.ok
              ? checkpointAnalysis(analyzed.primary)
              : null,
            acceptanceCrossCheckAnalysis: analyzed.ok
              ? checkpointAnalysis(analyzed.verification)
              : null
          }
        })
      }
      if (!analyzed.ok) {
        const result = resultFromAttempts({
          entry,
          packet: analyzed.packet,
          attempts: [],
          responsibility: 'engine_local'
        })
        results.push(result)
        if (input.suite.checkpointPath) {
          appendCheckpoint(input.suite.checkpointPath, {
            schemaVersion: 1,
            runKey,
            type: 'case_complete',
            at: new Date().toISOString(),
            caseId: entry.caseId,
            evidenceFingerprint: result.evidenceFingerprint,
            result
          })
        }
        writeResultArtifact(input.suite.resultPath, base, results, false)
        console.log(`[${index + 1}/${input.suite.cases.length}] ${entry.caseId} engine_local`)
        continue
      }

      const session = buildSession(
        entry,
        analyzed.primary,
        input.primary.id
      )
      const savedAttempts = checkpoint.attempts.get(entry.caseId) ?? []
      if (
        savedAttempts.some(
          (savedAttempt) =>
            savedAttempt.evidenceFingerprint !== currentEvidenceFingerprint
        )
      ) {
        throw new Error(`${entry.caseId} checkpoint evidence changed.`)
      }
      const savedAttemptByRequestId = new Map(
        savedAttempts.map((savedAttempt) => [
          savedAttempt.attempt.requestId,
          savedAttempt.attempt
        ])
      )
      const attempts: AcceptanceAttempt[] = []
      for (const savedStart of checkpoint.attemptStarts.get(entry.caseId) ?? []) {
        const savedAttempt = savedAttemptByRequestId.get(savedStart.start.requestId)
        if (savedAttempt) {
          attempts.push(savedAttempt)
          continue
        }
        const interrupted = interruptedAttempt(savedStart.start)
        attempts.push(interrupted)
        if (input.suite.checkpointPath) {
          appendCheckpoint(input.suite.checkpointPath, {
            schemaVersion: 1,
            runKey,
            type: 'attempt',
            at: new Date().toISOString(),
            caseId: entry.caseId,
            evidenceFingerprint: currentEvidenceFingerprint,
            fallbackUsed: false,
            attempt: interrupted
          })
        }
      }
      const historyError = invalidAttemptHistory(attempts, input.referenceModel)
      if (historyError) {
        throw new Error(`${entry.caseId} checkpoint ${historyError}.`)
      }
      const executeAttempt = async (start: AcceptanceAttemptStart, apiKey: string) => {
        if (input.suite.checkpointPath) {
          appendCheckpoint(input.suite.checkpointPath, {
            schemaVersion: 1,
            runKey,
            type: 'attempt_started',
            at: new Date().toISOString(),
            caseId: entry.caseId,
            evidenceFingerprint: currentEvidenceFingerprint,
            attemptStart: start
          })
        }
        const attempt = await runHarnessAttempt({
          ...start,
          apiKey,
          entry,
          session,
          primary: analyzed.primary,
          registry: input.registry,
          traceStore
        })
        if (input.suite.checkpointPath) {
          appendCheckpoint(input.suite.checkpointPath, {
            schemaVersion: 1,
            runKey,
            type: 'attempt',
            at: new Date().toISOString(),
            caseId: entry.caseId,
            evidenceFingerprint: currentEvidenceFingerprint,
            fallbackUsed: Boolean(
              attempt.trace?.validationErrors.some((message) =>
                /保守版|引擎快照直接回答|引擎證據版|fallback/i.test(message)
              )
            ),
            attempt
          })
        }
        return attempt
      }
      let terminalService = attempts.some(
        (attempt) => attempt.serviceErrorClassification !== null
      ) || primaryClickDeliveryFallbackIsTerminal(attempts)
      let firstClickQualityPass = attempts.some(
        (attempt) =>
          attempt.purpose === 'user_click' && attempt.firstClickQualityPass
      )
      let diagnosticPrimaryPassed = attempts.some(
        (attempt) =>
          attempt.purpose === 'diagnostic_replay' && attempt.passed
      )
      while (
        !terminalService &&
        !firstClickQualityPass &&
        attempts.filter((attempt) => attempt.modelRole === 'primary').length <
          PRIMARY_CONTENT_ATTEMPTS
      ) {
        const attemptNumber =
          attempts.filter((attempt) => attempt.modelRole === 'primary').length + 1
        const attempt = await executeAttempt({
          requestId: `ai-acceptance-${randomUUID()}`,
          attempt: attemptNumber,
          modelRole: 'primary',
          purpose: attemptNumber === 1 ? 'user_click' : 'diagnostic_replay',
          provider: PROVIDER,
          model: PRIMARY_MODEL,
        }, input.primaryApiKey)
        attempts.push(attempt)
        terminalService =
          attempt.serviceErrorClassification !== null ||
          primaryClickDeliveryFallbackIsTerminal(attempts)
        firstClickQualityPass =
          firstClickQualityPass || attempt.firstClickQualityPass
        diagnosticPrimaryPassed =
          diagnosticPrimaryPassed ||
          (attempt.purpose === 'diagnostic_replay' && attempt.passed)
        if (shutdownRequested) throw new Error('Acceptance runner interrupted.')
      }

      let referencePassed = false
      if (
        !terminalService &&
        !firstClickQualityPass &&
        !diagnosticPrimaryPassed &&
        input.referenceModel &&
        input.referenceApiKey
      ) {
        const existingReference = attempts.find(
          (attempt) => attempt.modelRole === 'reference'
        )
        const reference =
          existingReference ??
          (await executeAttempt({
            requestId: `ai-acceptance-${randomUUID()}`,
            attempt: 1,
            modelRole: 'reference',
            purpose: 'reference_diagnosis',
            provider: PROVIDER,
            model: input.referenceModel,
          }, input.referenceApiKey))
        if (shutdownRequested) throw new Error('Acceptance runner interrupted.')
        if (!existingReference) {
          attempts.push(reference)
        }
        terminalService = reference.serviceErrorClassification !== null
        referencePassed = reference.passed
      }

      const responsibility: Responsibility =
        terminalService || primaryDeliveryUnavailable(attempts)
        ? 'service'
        : firstClickQualityPass
          ? 'passed'
          : diagnosticPrimaryPassed || referencePassed
            ? 'model'
            : 'data_or_loop'
      const result = resultFromAttempts({
        entry,
        packet: analyzed.packet,
        attempts,
        responsibility
      })
      results.push(result)
      if (input.suite.checkpointPath) {
        appendCheckpoint(input.suite.checkpointPath, {
          schemaVersion: 1,
          runKey,
          type: 'case_complete',
          at: new Date().toISOString(),
          caseId: entry.caseId,
          evidenceFingerprint: result.evidenceFingerprint,
          result
        })
      }
      writeResultArtifact(input.suite.resultPath, base, results, false)
      console.log(
        `[${index + 1}/${input.suite.cases.length}] ${entry.caseId} ${responsibility} ${result.aiDurationMs ?? 0}ms`
      )
    }
    writeResultArtifact(input.suite.resultPath, base, results, true)
    const summary = aggregate(results)
    console.log(
      `Completed ${results.length}/${input.suite.cases.length}; initial-candidate-pass=${summary.initialModelCandidatePasses}; model-backed-pass=${summary.firstClickQualityPasses}; full-displayed-pass=${summary.finalDisplayedQualityPasses}; safe-fallback-pass=${summary.safeDisplayedFallbackPasses}; one-user-click=${summary.exactOneUserClickCases}; median=${summary.aiDuration.medianMs ?? 'n/a'}ms; p95=${summary.aiDuration.p95Ms ?? 'n/a'}ms; failures=${summary.failures.length}`
    )
    return summary.failures.length === 0 ? 0 : 1
  } finally {
    rmSync(tempDir, { recursive: true, force: true })
  }
}

async function runOfflineSelfTests(): Promise<number> {
  const fixed = loadSuite('fixed')
  const soak = loadSuite('soak')
  assert.equal(fixed.cases.length, 6)
  assert.equal(soak.cases.length, EXPECTED_SOAK_AI_PLIES)

  const entry = fixed.cases[0]!
  const primary: EngineAnalysis = {
    positionFen: entry.preMoveFen,
    sideToMove: 'red',
    userMove: entry.actualMove.uci,
    displayUserMove: entry.actualMove.chinese,
    bestMove: 'c3c4',
    displayBestMove: '兵七進一',
    scoreAfterUserMove: null,
    scoreAfterBestMove: null,
    evaluationAfterUserMove: null,
    evaluationAfterBestMove: null,
    userMoveEvaluationSource: 'unavailable',
    userMovePrincipalVariation: [entry.actualMove.uci, 'h7g7'],
    displayUserMovePrincipalVariation: [entry.actualMove.chinese, '炮8平7'],
    depth: 15,
    candidateMoves: [],
    principalVariation: ['c3c4', 'h7g7'],
    displayPrincipalVariation: ['兵七進一', '炮8平7'],
    analysisTimeMs: 100,
    incomplete: false,
    warnings: [],
    engineId: 'primary-self-test',
    engineName: 'Pikafish self-test',
    rawAnalysis: { root: ['not persisted'] }
  }
  const acceptanceCrossCheck: EngineAnalysis = {
    ...primary,
    bestMove: 'h2e2',
    displayBestMove: '炮二平五',
    principalVariation: ['h2e2', 'h7g7'],
    displayPrincipalVariation: ['炮二平五', '炮8平7'],
    engineId: 'cross-check-self-test'
  }
  const analysesFingerprint = fingerprintAnalyses(
    primary,
    acceptanceCrossCheck
  )
  const packet = evidencePacket(
    entry,
    fixed.analysisConfig,
    100,
    analysesFingerprint,
    successfulEnginePacket(primary),
    successfulEnginePacket(acceptanceCrossCheck)
  )
  assert.ok(!availableDisplayMoves(primary).includes('炮二平五'))
  assert.deepEqual(mentionedChineseMoves('炮二平五與炮八平五'), [
    '炮二平五',
    '炮八平五'
  ])

  const structural: StructuralChecks = {
    requiredHeadingsPresentOnce: true,
    requiredHeadingsInOrder: true,
    mentionsActualMove: true,
    mentionsBestMove: true,
    atLeastTwoEvidenceMoves: true,
    noSelfQuestionAnswer: true,
    noFallback: true,
    productionQualityScreenPassed: true,
    productionQualityIssues: [],
    modelCallsWithinInitialLimit: true,
    zeroEngineRounds: true,
    noClarification: true,
    chineseLengthWithinTarget: true,
    passed: true
  }
  const forbidden: ForbiddenInfoChecks = {
    noFen: true,
    noUci: true,
    noEvidenceIds: true,
    noRawScores: true,
    noInternalDiagnostics: true,
    noUnsupportedChineseMoves: true,
    passed: true
  }
  const rubricInput = {
    finalText: `### 直接結論\n${entry.actualMove.chinese}因為改變中路控制，所以需要檢討。\n### 實戰步問題\n${entry.actualMove.chinese}\n### AI 首選\n兵七進一\n### 對手利用與後果\n炮8平7導致中路受壓。\n### 實戰原則\n先核對主線。`,
    trace: { status: 'completed' } as HarnessTrace,
    result: { clarificationRequired: false } as HarnessRunResult,
    structural,
    forbidden,
    entry,
    primary,
    purpose: 'user_click' as const
  }
  const passingRubric = scoreRubric(rubricInput)
  assert.equal(passingRubric.criteria.directActualMoveReason, true)
  assert.equal(passingRubric.pass, true)
  const directReasonSuffix = rubricInput.finalText.slice(
    rubricInput.finalText.indexOf('### 實戰步問題')
  )
  for (const directReason of [
    `${entry.actualMove.chinese}過於消極防守而失先。`,
    `${entry.actualMove.chinese}過早暴露車的位置，使紅方得以搶先。`,
    `${entry.actualMove.chinese}的問題是放棄中路控制。`,
    `${entry.actualMove.chinese}的問題在於放棄中路控制。`,
    `${entry.actualMove.chinese}錯在未能限制對手。`,
    `${entry.actualMove.chinese}失去主動權。`
  ]) {
    const checkedReason = scoreRubric({
      ...rubricInput,
      finalText: `### 直接結論\n${directReason}\n${directReasonSuffix}`
    })
    assert.equal(
      checkedReason.criteria.directActualMoveReason,
      true,
      directReason
    )
  }
  const fabricatedRubric = scoreRubric({
    ...rubricInput,
    forbidden: { ...forbidden, noUnsupportedChineseMoves: false, passed: false }
  })
  assert.equal(fabricatedRubric.criteria.noFabricationTurnOrFenError, false)
  assert.ok(
    fabricatedRubric.majorErrorFlags.includes(
      'fabrication_turn_fen_or_validation_failure'
    )
  )
  const fallbackStructural = {
    ...structural,
    noFallback: false,
    passed: false
  }
  const fallbackModelRubric = scoreRubric({
    ...rubricInput,
    structural: fallbackStructural
  })
  const fallbackDisplayedRubric = scoreRubric({
    ...rubricInput,
    structural: fallbackStructural,
    requireModelBacked: false
  })
  assert.equal(fallbackModelRubric.pass, false)
  assert.ok(
    !fallbackModelRubric.majorErrorFlags.includes(
      'fabrication_turn_fen_or_validation_failure'
    )
  )
  const fallbackDisplayedOutputPassed = displayedOutputPass({
    structural: fallbackStructural,
    forbidden,
    rubric: fallbackDisplayedRubric,
    purpose: 'user_click'
  })
  assert.equal(fallbackDisplayedOutputPassed, true)
  assert.deepEqual(
    displayedQualitySignals(
      'engine_evidence_fallback',
      fallbackDisplayedOutputPassed
    ),
    {
      finalDisplayedQualityPass: false,
      safeDisplayedFallbackPass: true
    }
  )
  assert.deepEqual(displayedQualitySignals('model_response', true), {
    finalDisplayedQualityPass: true,
    safeDisplayedFallbackPass: false
  })
  assert.deepEqual(displayedQualitySignals('none', true), {
    finalDisplayedQualityPass: false,
    safeDisplayedFallbackPass: false
  })
  assert.deepEqual(artifactVersionMetadata(), {
    schemaVersion: 1,
    checkVersion: CHECK_VERSION
  })
  assert.equal(
    completionHasModelBacking('grounded_completion', ['min_han']),
    true
  )
  assert.equal(
    completionHasModelBacking('grounded_completion', [
      'min_han',
      'audit_grounding'
    ]),
    false
  )
  assert.equal(
    completionHasModelBacking('engine_evidence_fallback', []),
    false
  )
  assert.deepEqual(
    stableValidationCodes({
      validationErrors: [
        'AI 服務未完成一次性審查與寫作，已改用目前引擎證據完成說明。'
      ]
    } as HarnessTrace),
    ['provider_delivery']
  )
  const internalTimeoutError = Object.assign(new Error('internal timeout'), {
    name: 'AbortError'
  })
  assert.equal(
    terminalServiceClassification({
      requestId: 'soft-timeout-with-result',
      timedOut: false,
      harnessReturned: true,
      lastServiceError: internalTimeoutError
    }),
    null
  )
  assert.equal(
    terminalServiceClassification({
      requestId: 'outer-timeout-with-result',
      timedOut: true,
      harnessReturned: true,
      lastServiceError: internalTimeoutError
    })?.code,
    'timeout'
  )

  const sentinelPrompt = 'SENTINEL_PROMPT_FEN_UCI'
  const sentinelKey = 'SENTINEL_API_KEY'
  const sentinelBody = 'SENTINEL_RESPONSE_BODY'
  const observerStartedAt = Date.now()
  const observerController = new AbortController()
  const observed = observingProvider(
    {
      id: PROVIDER,
      displayName: 'offline-observer-self-test',
      async generateExplanation(request) {
        assert.equal(request.prompt, sentinelPrompt)
        assert.equal(request.apiKey, sentinelKey)
        return {
          text: sentinelBody,
          provider: PROVIDER,
          model: PRIMARY_MODEL,
          usage: { inputTokens: 12, outputTokens: 34 },
          createdAt: Date.now(),
          groundedOnEngineData: true
        }
      },
      async *generateExplanationStream() {
        yield { type: 'text_delta', deltaText: sentinelBody }
        yield { type: 'done', usage: { inputTokens: 12, outputTokens: 34 } }
      }
    },
    {
      attemptStartedAt: observerStartedAt,
      deadlineAt: observerStartedAt + AI_TIMEOUT_MS,
      outerSignal: observerController.signal,
      outerDeadlineReached: () => false
    }
  )
  await observed.generateExplanation(
    {
      provider: PROVIDER,
      model: PRIMARY_MODEL,
      apiKey: sentinelKey,
      prompt: sentinelPrompt,
      metadata: {
        requestId: 'sentinel-request',
        analysisId: 'sentinel-analysis',
        userLevel: 'intermediate',
        explanationStyle: 'long_analytical'
      }
    },
    observerController.signal
  )
  assert.equal(observed.internalCalls.length, 1)
  assert.equal(observed.internalCalls[0]?.errorCode, null)
  assert.equal(observed.internalCalls[0]?.responseFingerprint, sha256(sentinelBody))
  assert.deepEqual(observed.internalCalls[0]?.usage, {
    inputTokens: 12,
    outputTokens: 34
  })
  const serializedObservation = JSON.stringify(observed.internalCalls)
  for (const secret of [sentinelPrompt, sentinelKey, sentinelBody]) {
    assert.ok(!serializedObservation.includes(secret))
  }
  assert.doesNotMatch(serializedObservation, /apiKey|prompt|body|\bfen\b|\buci\b/i)

  const rateLimitSentinel =
    'SENTINEL_RATE_LIMIT_MESSAGE (429): requests per minute; retry in 1.25s'
  const rateLimitPropertySentinel = 'SENTINEL_RATE_LIMIT_PROPERTY'
  const rateLimited = observingProvider(
    {
      id: PROVIDER,
      displayName: 'offline-rate-limit-self-test',
      async generateExplanation() {
        throw Object.assign(new Error(rateLimitSentinel), {
          status: 429,
          retryAfterMs: 1_234,
          rawProviderDetail: rateLimitPropertySentinel
        })
      },
      async *generateExplanationStream() {
        throw Object.assign(new Error(rateLimitSentinel), {
          status: 429,
          retryAfterMs: 1_234,
          rawProviderDetail: rateLimitPropertySentinel
        })
      }
    },
    {
      attemptStartedAt: observerStartedAt,
      deadlineAt: observerStartedAt + AI_TIMEOUT_MS,
      outerSignal: observerController.signal,
      outerDeadlineReached: () => false
    }
  )
  await assert.rejects(
    rateLimited.generateExplanation(
      {
        provider: PROVIDER,
        model: PRIMARY_MODEL,
        apiKey: sentinelKey,
        prompt: sentinelPrompt,
        metadata: {
          requestId: 'rate-limit-request',
          analysisId: 'rate-limit-analysis',
          userLevel: 'intermediate',
          explanationStyle: 'long_analytical'
        }
      },
      observerController.signal
    )
  )
  assert.equal(rateLimited.internalCalls[0]?.outcome, 'provider_error')
  assert.equal(rateLimited.internalCalls[0]?.errorCode, 'rate_limited')
  assert.equal(rateLimited.internalCalls[0]?.rateLimitScope, 'rpm')
  assert.equal(rateLimited.internalCalls[0]?.retryAfterMs, 1_234)
  const serializedRateLimit = JSON.stringify(rateLimited.internalCalls)
  for (const secret of [rateLimitSentinel, rateLimitPropertySentinel]) {
    assert.ok(!serializedRateLimit.includes(secret))
  }
  assert.deepEqual(
    rateLimitMetadata(
      Object.assign(new Error('tokens per minute'), {
        retryAfterMs: Number.MAX_SAFE_INTEGER
      })
    ),
    { rateLimitScope: 'tpm', retryAfterMs: MAX_OBSERVED_RETRY_AFTER_MS }
  )

  const tempDir = mkdtempSync(join(tmpdir(), 'xqa-ai-acceptance-self-test-'))
  try {
    const path = join(tempDir, 'checkpoint.jsonl')
    const runKey = 'offline-self-test'
    const evidenceFingerprint = fingerprintEvidence(packet)
    const start: AcceptanceAttemptStart = {
      requestId: 'self-test-request',
      attempt: 1,
      modelRole: 'primary',
      purpose: 'user_click',
      provider: PROVIDER,
      model: PRIMARY_MODEL
    }
    const attempt = interruptedAttempt(start)
    const softTimeoutFallbackAttempt: AcceptanceAttempt = {
      ...attempt,
      deliveryStatus: 'completed',
      timeoutStage: 'internal_model_phase',
      serviceErrorClassification: null,
      internalCalls: [
        {
          callIndex: 1,
          purpose: 'initial_combined',
          startedOffsetMs: 0,
          remainingDeadlineMsAtStart: AI_TIMEOUT_MS,
          durationMs: 24_000,
          outcome: 'deadline_abort',
          errorCode: 'deadline_abort',
          rateLimitScope: null,
          retryAfterMs: null,
          responseFingerprint: null,
          responseCharCount: 0,
          responseChineseCharCount: 0,
          usage: null,
          validationCodes: ['internal_phase_timeout', 'safe_fallback']
        }
      ],
      initialModelIssueCodes: ['internal_phase_timeout', 'safe_fallback'],
      completionMode: 'engine_evidence_fallback',
      finalText: '完整的安全引擎證據說明',
      finalTextFingerprint: sha256('完整的安全引擎證據說明'),
      majorErrorFlags: ['fallbackUsed']
    }
    assert.equal(primaryDeliveryUnavailable([softTimeoutFallbackAttempt]), true)
    assert.equal(
      primaryClickDeliveryFallbackIsTerminal([softTimeoutFallbackAttempt]),
      true
    )
    assert.equal(
      serviceClassificationFromAttempts([softTimeoutFallbackAttempt])?.code,
      'model_phase_timeout'
    )
    const rateLimitedFallbackAttempt: AcceptanceAttempt = {
      ...softTimeoutFallbackAttempt,
      requestId: 'rate-limited-fallback',
      attempt: 1,
      timeoutStage: null,
      internalCalls: [
        {
          ...softTimeoutFallbackAttempt.internalCalls[0]!,
          durationMs: 10,
          outcome: 'provider_error',
          errorCode: 'rate_limited',
          rateLimitScope: 'rpm',
          retryAfterMs: 1_234,
          validationCodes: ['safe_fallback']
        }
      ],
      initialModelIssueCodes: ['safe_fallback']
    }
    assert.equal(
      primaryClickDeliveryFallbackIsTerminal([rateLimitedFallbackAttempt]),
      true
    )
    assert.equal(
      serviceClassificationFromAttempts([rateLimitedFallbackAttempt])?.code,
      'rate_limited'
    )
    assert.equal(
      serviceClassificationFromAttempts([
        softTimeoutFallbackAttempt,
        rateLimitedFallbackAttempt
      ])?.code,
      'rate_limited'
    )
    for (const errorCode of ['network_error', 'provider_error']) {
      assert.equal(
        serviceClassificationFromAttempts([
          softTimeoutFallbackAttempt,
          {
            ...rateLimitedFallbackAttempt,
            internalCalls: [
              {
                ...rateLimitedFallbackAttempt.internalCalls[0]!,
                errorCode
              }
            ]
          }
        ])?.code,
        errorCode
      )
    }
    const contentFailureAttempt: AcceptanceAttempt = {
      ...softTimeoutFallbackAttempt,
      requestId: 'content-failure',
      timeoutStage: null,
      completionMode: 'model_response',
      successfulInternalCalls: 1,
      firstCandidateObserved: true,
      initialModelCandidatePass: false,
      internalCalls: [
        {
          ...softTimeoutFallbackAttempt.internalCalls[0]!,
          durationMs: 10,
          outcome: 'success',
          errorCode: null,
          rateLimitScope: null,
          retryAfterMs: null,
          responseFingerprint: sha256('model content candidate'),
          responseCharCount: 23,
          responseChineseCharCount: 0,
          validationCodes: ['quality_gate']
        }
      ],
      initialModelIssueCodes: ['quality_gate']
    }
    const eligibleDiagnostic: AcceptanceAttempt = {
      ...contentFailureAttempt,
      requestId: 'eligible-diagnostic',
      attempt: 2,
      purpose: 'diagnostic_replay'
    }
    assert.equal(
      primaryClickDeliveryFallbackIsTerminal([contentFailureAttempt]),
      false
    )
    assert.equal(
      invalidAttemptHistory([contentFailureAttempt, eligibleDiagnostic], null),
      null
    )
    assert.equal(
      invalidAttemptHistory(
        [softTimeoutFallbackAttempt, eligibleDiagnostic],
        null
      ),
      'diagnostic replay followed a terminal first click'
    )
    const result = resultFromAttempts({
      entry,
      packet,
      attempts: [attempt],
      responsibility: 'service'
    })
    const modelFailedChecks = failedCheckNames({
      ...result,
      responsibility: 'model'
    })
    assert.ok(modelFailedChecks.includes('responsibility.model'))
    assert.ok(!modelFailedChecks.includes('model.primary_failed_reference_passed'))
    const unresolvedFailedChecks = failedCheckNames({
      ...result,
      responsibility: 'data_or_loop'
    })
    assert.ok(unresolvedFailedChecks.includes('responsibility.data_or_loop'))
    assert.ok(
      !unresolvedFailedChecks.includes(
        'data_or_loop.reference_did_not_clear_failure'
      )
    )
    const fallbackFailedChecks = failedCheckNames({
      ...result,
      fallbackUsed: true,
      majorErrorFlags: []
    })
    assert.ok(fallbackFailedChecks.includes('fallbackUsed'))
    assert.ok(
      !fallbackFailedChecks.includes(
        'major.fabrication_turn_fen_or_validation_failure'
      )
    )
    assert.equal(
      aggregate([{ ...result, initialModelCandidatePass: true }])
        .initialModelCandidatePasses,
      1
    )
    const displayedAggregate = aggregate([
      {
        ...result,
        finalDisplayedQualityPass: true,
        safeDisplayedFallbackPass: false
      },
      {
        ...result,
        finalDisplayedQualityPass: false,
        safeDisplayedFallbackPass: true
      }
    ])
    assert.equal(displayedAggregate.finalDisplayedQualityPasses, 1)
    assert.equal(displayedAggregate.safeDisplayedFallbackPasses, 1)
    const records: CheckpointRecord[] = [
      { schemaVersion: 1, runKey, type: 'meta', at: new Date(0).toISOString() },
      {
        schemaVersion: 1,
        runKey,
        type: 'evidence',
        at: new Date(0).toISOString(),
        caseId: entry.caseId,
        evidenceFingerprint,
        evidence: {
          packet,
          primaryAnalysis: checkpointAnalysis(primary),
          acceptanceCrossCheckAnalysis: checkpointAnalysis(
            acceptanceCrossCheck
          )
        }
      },
      {
        schemaVersion: 1,
        runKey,
        type: 'attempt_started',
        at: new Date(0).toISOString(),
        caseId: entry.caseId,
        evidenceFingerprint,
        attemptStart: start
      },
      {
        schemaVersion: 1,
        runKey,
        type: 'attempt',
        at: new Date(0).toISOString(),
        caseId: entry.caseId,
        evidenceFingerprint,
        attempt
      },
      {
        schemaVersion: 1,
        runKey,
        type: 'case_complete',
        at: new Date(0).toISOString(),
        caseId: entry.caseId,
        evidenceFingerprint,
        result
      }
    ]
    for (const record of records) appendCheckpoint(path, record)
    appendFileSync(path, '{"truncated":', 'utf8')
    const recovered = readCheckpoint(path, runKey)
    assert.equal(recovered.completed.get(entry.caseId)?.caseId, entry.caseId)
    assert.ok(readFileSync(path, 'utf8').endsWith('\n'))
    assert.ok(!readFileSync(path, 'utf8').includes('rawAnalysis'))

    const tamperedPath = join(tempDir, 'tampered.jsonl')
    appendCheckpoint(tamperedPath, records[0]!)
    const tamperedPrimary = {
      ...checkpointAnalysis(primary),
      depth: 99
    }
    appendCheckpoint(tamperedPath, {
      ...records[1]!,
      evidence: {
        packet,
        primaryAnalysis: tamperedPrimary,
        acceptanceCrossCheckAnalysis: checkpointAnalysis(
          acceptanceCrossCheck
        )
      }
    })
    assert.throws(
      () => readCheckpoint(tamperedPath, runKey),
      /saved analyses are invalid/
    )

    const invalidReference: AcceptanceAttempt = {
      ...attempt,
      requestId: 'self-test-reference',
      modelRole: 'reference',
      purpose: 'reference_diagnosis',
      model: 'gemini-3.1-pro-preview'
    }
    assert.match(
      invalidAttemptHistory(
        [attempt, invalidReference],
        'gemini-3.1-pro-preview'
      ) ?? '',
      /service failure/
    )
  } finally {
    rmSync(tempDir, { recursive: true, force: true })
  }
  console.log(
    `AI acceptance runner offline self-test passed (fixed=${fixed.cases.length}, soak=${soak.cases.length}).`
  )
  return 0
}

async function main(): Promise<number> {
  const options = parseArgs(process.argv.slice(2))
  if (options.mode === 'help') {
    console.log(usage())
    return 0
  }
  if (options.mode === 'self-test') return runOfflineSelfTests()
  const suite = loadSuite(options.suite)
  const storage = new StorageService()
  const registry = new EngineRegistryService(storage)
  const primary = configuredPrimary(registry)
  const crossCheck = resolveAcceptanceCrossCheck({
    registry,
    primary,
    explicitPath: options.crossCheckPath,
    expectedHashes: suite.expectedEngineBinarySha256
  })
  const secretStore = new SecretStore()
  if (!secretStore.isEncryptionAvailable()) {
    throw new Error('Electron safeStorage encryption is unavailable.')
  }
  const primaryApiKey = exactModelApiKey(secretStore, PRIMARY_MODEL)
  if (!primaryApiKey) {
    throw new Error(
      `A decryptable exact ${PROVIDER}/${PRIMARY_MODEL} credential is required.`
    )
  }
  const referenceApiKey = REFERENCE_MODEL_CANDIDATE
    ? exactModelApiKey(secretStore, REFERENCE_MODEL_CANDIDATE)
    : null
  const referenceModel = referenceApiKey
    ? REFERENCE_MODEL_CANDIDATE
    : null
  modelRegistry.getModel(PROVIDER, PRIMARY_MODEL)
  if (referenceModel) modelRegistry.getModel(PROVIDER, referenceModel)

  console.log(
    `Preflight OK: suite=${suite.name}, cases=${suite.cases.length}, configured-primary=${primary.displayName}, acceptance-cross-check=${crossCheck.crossCheck.displayName}, model=${PRIMARY_MODEL}, exact-reference=${referenceModel ?? 'none'}`
  )
  console.log(
    `Engine fingerprints: primary=${crossCheck.primarySha256.slice(0, 12)}, acceptance-cross-check=${crossCheck.crossCheckSha256.slice(0, 12)}`
  )
  if (options.mode === 'dry-run') {
    console.log('Dry run complete. No engine process or network request was started.')
    return 0
  }
  return runLive({
    suite,
    primaryApiKey,
    referenceModel,
    referenceApiKey,
    registry,
    primary,
    acceptanceCrossCheck: crossCheck.crossCheck,
    primarySha256: crossCheck.primarySha256,
    crossCheckSha256: crossCheck.crossCheckSha256
  })
}

function requestShutdown(): void {
  shutdownRequested = true
  activeAbortController?.abort()
}

process.on('SIGINT', requestShutdown)
process.on('SIGTERM', requestShutdown)

void app
  .whenReady()
  .then(main)
  .then((code) => {
    app.releaseSingleInstanceLock()
    process.exit(code)
  })
  .catch((error: unknown) => {
    console.error(`Acceptance runner failed: ${sanitizeOperationalMessage(error)}`)
    app.releaseSingleInstanceLock()
    process.exit(2)
  })
