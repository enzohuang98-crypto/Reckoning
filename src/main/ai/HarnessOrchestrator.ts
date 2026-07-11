import { randomUUID } from 'node:crypto'
import type { AIProvider, TokenUsage } from '@shared/types/AIProviderTypes'
import type { GenerateExplanationStartPayload } from '@shared/types/ipc'
import type {
  HarnessAnswer,
  HarnessClaim,
  HarnessEvidence,
  HarnessPhase,
  HarnessProgressPayload,
  HarnessTrace
} from '@shared/types/Harness'
import type { EngineAnalysis } from '@shared/types/EngineAnalysis'
import { parseFen } from '@shared/logic/fen'
import { legalMoveCheck } from '@shared/logic/moves'
import {
  CONCRETE_TERM_EXAMPLES,
  containsConcreteXiangqiTerm
} from '@shared/logic/xiangqiTerms'
import {
  formatXiangqiKnowledgeForPrompt,
  selectXiangqiKnowledge
} from '@shared/logic/xiangqiKnowledge'
import { buildDualEngineComparison } from '@shared/logic/DualEngineComparison'
import type { DualEngineComparison } from '@shared/types/DualEngine'
import {
  compactChineseText,
  distinctMentionedMoves,
  looksVagueConsequenceText,
  looksVaguePurposeText,
  scoreExplanationAnswer,
  scoreUsedAsReason,
  SECTION_KEYS,
  textSimilarity,
  type QualityReport
} from '@shared/logic/ExplanationQualityScorer'
import type { CausalChain } from '@shared/types/Harness'
import type { AnalysisSession } from '../storage/AnalysisSessionStore'
import type { EngineRegistryService } from '../engine/EngineRegistryService'
import type { HarnessTraceStore } from '../storage/HarnessTraceStore'

interface HarnessTask {
  kind: 'root' | 'evaluate_move'
  move?: string
  purpose: string
}

interface PlannerResult {
  clarification?: string
  tasks: HarnessTask[]
}

export type ConsequenceCategory =
  | 'initiative_loss'
  | 'piece_restriction'
  | 'king_safety'
  | 'structure_damage'
  | 'opponent_development'
  | 'material_or_tactical'

export interface ConsequenceFinding {
  id: string
  category: ConsequenceCategory
  summary: string
  opponentUse: string
  boardImpact: string
  supportingMoves: string[]
  evidenceIds: string[]
  verified: boolean
}

export interface ConsequenceAudit {
  bestMovePurpose: string
  userMoveProblem: string
  consequences: ConsequenceFinding[]
  contradictions: string[]
  enoughEvidence: boolean
  dualEngineAdjudication?: DualEngineAdjudication
}

export interface DualEngineAdjudication {
  preferredMove: string | null
  preferredDisplayMove: string | null
  verdict: 'primary' | 'verification' | 'uncertain'
  humanControlComparison: string
  longTermComparison: string
  decisionReason: string
  evidenceIds: string[]
}

export interface AnswerRequirements {
  hasUserMove: boolean
  requiredHeadings: string[]
  dualEngineDisagreement?: boolean
  verifiedFindingIds?: string[]
}

export interface HarnessRunResult {
  finalText: string
  evidence: HarnessEvidence[]
  warnings: string[]
  traceId: string
  clarificationRequired: boolean
  usage?: TokenUsage
}

interface HarnessDependencies {
  provider: AIProvider
  apiKey: string
  model: string
  session: AnalysisSession
  registry: EngineRegistryService
  traceStore: HarnessTraceStore
  signal: AbortSignal
  onProgress: (payload: Omit<HarnessProgressPayload, 'requestId'>) => void
  waitForContinuation?: () => Promise<void>
  timing?: Partial<{
    progressDelayMs: number
    progressIntervalMs: number
    stagnationMs: number
    minResearchRoundMs: number
    maxResearchRoundMs: number
    continuationTimeoutMs: number
  }>
}

const PROGRESS_DELAY_MS = 20_000
const PROGRESS_INTERVAL_MS = 5_000
const STAGNATION_MS = 60_000
const MIN_RESEARCH_ROUND_MS = 20_000
const MAX_RESEARCH_ROUND_MS = 60_000
/** 使用者未於此時限內回應「是否繼續」，自動改用目前證據收尾（不可直接失敗）。 */
const CONTINUATION_TIMEOUT_MS = 120_000

/** waitForUserContinuation 逾時的專屬訊號；外層 catch 會改用現有證據收尾，不視為失敗。 */
class HarnessContinuationTimeoutError extends Error {
  constructor() {
    super('使用者未於時限內回應，已自動改用目前證據收尾。')
    this.name = 'HarnessContinuationTimeoutError'
  }
}

function isAbortLikeError(error: unknown): boolean {
  return (
    (error instanceof DOMException && error.name === 'AbortError') ||
    (error instanceof Error &&
      (error.name === 'AbortError' || error.name === 'APIUserAbortError'))
  )
}

function rethrowAbortLikeError(error: unknown): void {
  if (isAbortLikeError(error)) throw error
}

function isTransientModelError(error: unknown): boolean {
  if (!(error instanceof Error) || isAbortLikeError(error)) return false
  return /(\b429\b|\b500\b|\b502\b|\b503\b|\b504\b|rate.?limit|timeout|timed out|temporar|ECONNRESET|fetch failed)/i.test(
    error.message
  )
}

async function delayWithAbort(ms: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) throw new DOMException('Request cancelled', 'AbortError')
  await new Promise<void>((resolve, reject) => {
    const onAbort = (): void => {
      clearTimeout(timer)
      reject(new DOMException('Request cancelled', 'AbortError'))
    }
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort)
      resolve()
    }, ms)
    signal.addEventListener('abort', onAbort, { once: true })
  })
}

/** 已達模型呼叫上限的專屬訊號，讓呼叫端可以選擇改用 fallback 而不是整個失敗。 */
class HarnessModelBudgetExceededError extends Error {
  constructor() {
    super('已達模型呼叫上限。')
    this.name = 'HarnessModelBudgetExceededError'
  }
}
const CONSEQUENCE_CATEGORIES = new Set<ConsequenceCategory>([
  'initiative_loss',
  'piece_restriction',
  'king_safety',
  'structure_damage',
  'opponent_development',
  'material_or_tactical'
])

function jsonFromText<T>(text: string): T {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1]
  const candidate = fenced ?? text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1)
  return JSON.parse(candidate) as T
}

function publicAnalysis(analysis: EngineAnalysis): object {
  return {
    engineId: analysis.engineId,
    engineName: analysis.engineName,
    bestMove: analysis.bestMove,
    displayBestMove: analysis.displayBestMove,
    score: analysis.scoreAfterBestMove?.displayText ?? null,
    rawScore: analysis.scoreAfterBestMove?.raw ?? null,
    userMove: analysis.userMove,
    displayUserMove: analysis.displayUserMove,
    userMoveScore: analysis.scoreAfterUserMove?.displayText ?? null,
    rawUserMoveScore: analysis.scoreAfterUserMove?.raw ?? null,
    userMovePrincipalVariation:
      analysis.displayUserMovePrincipalVariation ??
      analysis.userMovePrincipalVariation ??
      [],
    depth: analysis.depth,
    candidates: analysis.candidateMoves.map((candidate) => ({
      move: candidate.move,
      displayMove: candidate.displayMove,
      score: candidate.score?.displayText ?? null,
      rawScore: candidate.score?.raw ?? null,
      depth: candidate.depth,
      principalVariation:
        candidate.displayPrincipalVariation ?? candidate.principalVariation
    })),
    principalVariation:
      analysis.displayPrincipalVariation ?? analysis.principalVariation,
    warnings: analysis.warnings
  }
}

function makeEvidence(
  id: string,
  analysis: EngineAnalysis,
  purpose: string,
  move?: string
): HarnessEvidence {
  return {
    id,
    engineId: analysis.engineId ?? 'unknown-engine',
    engineName: analysis.engineName,
    purpose,
    positionFen: analysis.positionFen,
    move,
    displayMove:
      move === analysis.userMove ? analysis.displayUserMove : analysis.displayBestMove,
    depth: analysis.depth,
    score:
      move === analysis.userMove
        ? analysis.scoreAfterUserMove
        : analysis.scoreAfterBestMove,
    displayPrincipalVariation:
      move === analysis.userMove
        ? analysis.displayUserMovePrincipalVariation ??
          analysis.userMovePrincipalVariation ??
          []
        : analysis.displayPrincipalVariation ?? analysis.principalVariation,
    analysis
  }
}

function isAmbiguousQuestion(question: string | undefined, attachedMove?: string): boolean {
  if (!question?.trim() || attachedMove) return false
  return /(這步|這一手|那步|那一手|這裡|那裡|它|this move|that move)/i.test(
    question
  )
}

function validateTask(
  task: HarnessTask,
  session: AnalysisSession
): HarnessTask | null {
  if (task.kind === 'root') {
    return { kind: 'root', purpose: task.purpose.slice(0, 160) || '分析局面' }
  }
  if (
    task.kind !== 'evaluate_move' ||
    typeof task.move !== 'string' ||
    !/^[a-i][0-9][a-i][0-9]$/.test(task.move)
  ) {
    return null
  }
  const parsed = parseFen(session.positionFen)
  if (!parsed.valid) return null
  const legality = legalMoveCheck(
    parsed.board.grid,
    parsed.board.sideToMove,
    task.move
  )
  if (!legality.ok) return null
  return {
    kind: 'evaluate_move',
    move: task.move,
    purpose: task.purpose.slice(0, 160) || '驗證指定著法'
  }
}

function normalizePlannerResult(
  raw: PlannerResult,
  session: AnalysisSession,
  attachedMove?: string
): PlannerResult {
  const tasks = Array.isArray(raw.tasks)
    ? raw.tasks
        .map((task) => validateTask(task, session))
        .filter((task): task is HarnessTask => task !== null)
    : []
  if (attachedMove) {
    const attached = validateTask(
      { kind: 'evaluate_move', move: attachedMove, purpose: '驗證使用者附加著法' },
      session
    )
    if (attached && !tasks.some((task) => task.move === attachedMove)) {
      tasks.unshift(attached)
    }
  }
  return {
    clarification:
      typeof raw.clarification === 'string'
        ? raw.clarification.trim().slice(0, 500)
        : undefined,
    tasks
  }
}

function normalizeConsequenceAudit(raw: ConsequenceAudit): ConsequenceAudit {
  const dual = raw.dualEngineAdjudication
  return {
    bestMovePurpose: String(raw.bestMovePurpose ?? '').trim().slice(0, 2000),
    userMoveProblem: String(raw.userMoveProblem ?? '').trim().slice(0, 2000),
    consequences: Array.isArray(raw.consequences)
      ? raw.consequences.slice(0, 8).map((item, index) => ({
          id: String(item.id || `K${index + 1}`).slice(0, 80),
          category: CONSEQUENCE_CATEGORIES.has(item.category)
            ? item.category
            : 'material_or_tactical',
          summary: String(item.summary ?? '').trim().slice(0, 2000),
          opponentUse: String(item.opponentUse ?? '').trim().slice(0, 2000),
          boardImpact: String(item.boardImpact ?? '').trim().slice(0, 2000),
          supportingMoves: Array.isArray(item.supportingMoves)
            ? item.supportingMoves.map(String).slice(0, 16)
            : [],
          evidenceIds: Array.isArray(item.evidenceIds)
            ? item.evidenceIds.map(String).slice(0, 10)
            : [],
          verified: item.verified === true
        }))
      : [],
    contradictions: Array.isArray(raw.contradictions)
      ? raw.contradictions.map(String).filter(Boolean).slice(0, 10)
      : [],
    enoughEvidence: raw.enoughEvidence === true,
    dualEngineAdjudication:
      dual && typeof dual === 'object'
        ? {
            preferredMove:
              typeof dual.preferredMove === 'string'
                ? dual.preferredMove.slice(0, 16)
                : null,
            preferredDisplayMove:
              typeof dual.preferredDisplayMove === 'string'
                ? dual.preferredDisplayMove.slice(0, 80)
                : null,
            verdict:
              dual.verdict === 'primary' ||
              dual.verdict === 'verification' ||
              dual.verdict === 'uncertain'
                ? dual.verdict
                : 'uncertain',
            humanControlComparison: String(
              dual.humanControlComparison ?? ''
            )
              .trim()
              .slice(0, 2000),
            longTermComparison: String(dual.longTermComparison ?? '')
              .trim()
              .slice(0, 2000),
            decisionReason: String(dual.decisionReason ?? '')
              .trim()
              .slice(0, 2000),
            evidenceIds: Array.isArray(dual.evidenceIds)
              ? dual.evidenceIds.map(String).slice(0, 10)
              : []
          }
        : undefined
  }
}

function normalizeCausal(raw: unknown): CausalChain | undefined {
  if (typeof raw !== 'object' || raw === null) return undefined
  const value = raw as Record<string, unknown>
  const field = (key: string): string => String(value[key] ?? '').trim().slice(0, 600)
  const causal: CausalChain = {
    cause: field('cause'),
    mechanism: field('mechanism'),
    affected: field('affected'),
    opponentUse: field('opponentUse'),
    consequence: field('consequence')
  }
  return Object.values(causal).some((text) => text.length > 0) ? causal : undefined
}

function normalizeClaim(claim: {
  id?: unknown
  text?: unknown
  evidenceIds?: unknown
  findingIds?: unknown
  causal?: unknown
}): HarnessClaim {
  return {
    id: String(claim.id || randomUUID()).slice(0, 80),
    text: String(claim.text || '').slice(0, 2000),
    evidenceIds: Array.isArray(claim.evidenceIds)
      ? claim.evidenceIds.map(String).slice(0, 10)
      : [],
    findingIds: Array.isArray(claim.findingIds)
      ? claim.findingIds.map(String).slice(0, 10)
      : [],
    causal: normalizeCausal(claim.causal)
  }
}

function normalizeSections(raw: unknown): HarnessAnswer['sections'] {
  return Array.isArray(raw)
    ? raw.slice(0, 8).map((section) => ({
        heading: String(section.heading || '問：補充說明').slice(0, 100),
        claims: Array.isArray(section.claims)
          ? section.claims.slice(0, 30).map(normalizeClaim)
          : []
      }))
    : []
}

function normalizeGeneralNotes(raw: unknown): string[] {
  return Array.isArray(raw)
    ? raw
        .map((note) => String(note).trim().slice(0, 300))
        .filter(Boolean)
        .slice(0, 3)
    : []
}

function attachVerifiedFindingIds(
  answer: HarnessAnswer,
  findings: readonly ConsequenceFinding[]
): HarnessAnswer {
  const coreKeys = [
    SECTION_KEYS.missed,
    SECTION_KEYS.opponent,
    SECTION_KEYS.consequences,
    SECTION_KEYS.comparison
  ]
  return {
    ...answer,
    sections: answer.sections.map((section) => {
      if (!coreKeys.some((key) => section.heading.includes(key))) return section
      return {
        ...section,
        claims: section.claims.map((claim) => {
          if ((claim.findingIds?.length ?? 0) > 0) return claim
          const matching = findings
            .filter((finding) =>
              finding.evidenceIds.some((id) => claim.evidenceIds.includes(id))
            )
            .map((finding) => finding.id)
          return matching.length > 0
            ? { ...claim, findingIds: matching }
            : claim
        })
      }
    })
  }
}

/** 品質修正迴圈的最大輪數：超過即改用保守 fallback，不無限重試。 */
const MAX_SECTION_REWRITES = 2

/** heading 寬鬆比對：容忍「問：」前綴與標點差異，避免模型微調標題導致合併失敗。 */
function sectionHeadingMatches(a: string, b: string): boolean {
  const keyA = compactChineseText(a.replace(/^問[：:]\s*/, '')).replace(/？|\?/g, '')
  const keyB = compactChineseText(b.replace(/^問[：:]\s*/, '')).replace(/？|\?/g, '')
  if (!keyA || !keyB) return false
  return keyA === keyB || keyA.includes(keyB) || keyB.includes(keyA)
}

const DUPLICATE_FIELD_SIMILARITY = 0.75
const DUPLICATE_FIELD_MIN_LENGTH = 10

/** 解說可引用的全部中文著法：主線、使用者著法主線，以及各候選著法與其變例。 */
function collectDisplayMoves(evidence: HarnessEvidence[]): string[] {
  return evidence
    .flatMap((item) => [
      ...item.displayPrincipalVariation,
      ...(item.analysis.displayPrincipalVariation ?? []),
      ...(item.analysis.displayUserMovePrincipalVariation ?? []),
      ...item.analysis.candidateMoves.flatMap((candidate) => [
        ...(candidate.displayMove ? [candidate.displayMove] : []),
        ...(candidate.displayPrincipalVariation ?? [])
      ])
    ])
    .filter(Boolean)
}

/**
 * 單項後果的具體性檢查（validateConsequenceAudit 與 concreteVerifiedConsequences 共用，
 * 兩邊標準必須一致）：三段正文合起來要連回至少兩步主線著法、用到具體象棋詞彙，
 * 且三段各自說明不同層面。回傳空陣列代表通過。
 */
function consequenceTextIssues(finding: ConsequenceFinding): string[] {
  const issues: string[] = []
  const combined = [finding.summary, finding.opponentUse, finding.boardImpact].join(' ')
  if (
    looksVagueConsequenceText(finding.summary, finding.supportingMoves) ||
    looksVagueConsequenceText(finding.opponentUse, finding.supportingMoves) ||
    looksVagueConsequenceText(finding.boardImpact, finding.supportingMoves)
  ) {
    issues.push('仍然太空泛，必須說出主線著法如何造成具體後果。')
  }
  if (distinctMentionedMoves(combined, finding.supportingMoves) < 2) {
    issues.push('沒有把後果連回至少兩步實際主線著法（正文必須逐字出現這些著法）。')
  }
  if (!containsConcreteXiangqiTerm(combined)) {
    issues.push(
      `沒有使用具體象棋詞彙（例如：${CONCRETE_TERM_EXAMPLES}）指出位置、棋子關係或威脅。`
    )
  }
  const fields: Array<[string, string]> = [
    ['summary', finding.summary],
    ['opponentUse', finding.opponentUse],
    ['boardImpact', finding.boardImpact]
  ]
  for (let i = 0; i < fields.length; i++) {
    for (let j = i + 1; j < fields.length; j++) {
      const [nameA, textA] = fields[i]
      const [nameB, textB] = fields[j]
      if (
        compactChineseText(textA).length >= DUPLICATE_FIELD_MIN_LENGTH &&
        compactChineseText(textB).length >= DUPLICATE_FIELD_MIN_LENGTH &&
        textSimilarity(textA, textB) >= DUPLICATE_FIELD_SIMILARITY
      ) {
        issues.push(
          `${nameA} 與 ${nameB} 內容高度重複，必須分別說明後果本身、對手利用方式與盤面影響。`
        )
      }
    }
  }
  return issues
}

export function validateConsequenceAudit(
  audit: ConsequenceAudit,
  evidence: HarnessEvidence[],
  hasUserMove: boolean,
  dualComparison?: DualEngineComparison | null
): string[] {
  const errors: string[] = []
  const evidenceIds = new Set(evidence.map((item) => item.id))
  const availableMoves = new Set(collectDisplayMoves(evidence))
  if (!audit.bestMovePurpose) {
    errors.push('缺少最佳著法的具體目的。')
  } else if (looksVaguePurposeText(audit.bestMovePurpose)) {
    errors.push('最佳著法的目的太空泛，必須說出具體要達成什麼。')
  }
  if (hasUserMove) {
    if (!audit.userMoveProblem) {
      errors.push('缺少使用者著法錯失機會的解釋。')
    } else if (looksVaguePurposeText(audit.userMoveProblem)) {
      errors.push('使用者著法的問題描述太空泛，必須具體說明錯失了什麼。')
    }
  }
  const verified = audit.consequences.filter((item) => item.verified)
  if (verified.length < 2) errors.push('至少需要兩項已驗證的具體後果。')
  const categoryCount = new Set(verified.map((item) => item.category)).size
  if (verified.length >= 2 && categoryCount < 2) {
    errors.push('兩項具體後果不能只是同一種類型的重述。')
  }
  if (audit.contradictions.length > 0) {
    errors.push('具體後果仍有互相矛盾的判斷。')
  }
  for (const consequence of verified) {
    if (
      !consequence.summary ||
      !consequence.opponentUse ||
      !consequence.boardImpact
    ) {
      errors.push(`${consequence.id} 缺少對手機會或盤面影響。`)
    }
    if (consequence.evidenceIds.length === 0) {
      errors.push(`${consequence.id} 沒有引擎證據。`)
    }
    for (const id of consequence.evidenceIds) {
      if (!evidenceIds.has(id)) errors.push(`${consequence.id} 引用了不存在的 ${id}。`)
    }
    if (consequence.supportingMoves.length < 2) {
      errors.push(`${consequence.id} 至少要指出兩步主線著法，不能只貼一個結果標籤。`)
    } else if (
      consequence.supportingMoves.some((move) => !availableMoves.has(move))
    ) {
      errors.push(`${consequence.id} 使用了引擎主線中沒有的著法。`)
    }
    for (const issue of consequenceTextIssues(consequence)) {
      errors.push(`${consequence.id} ${issue}`)
    }
  }
  const prose = [
    audit.bestMovePurpose,
    audit.userMoveProblem,
    ...verified.flatMap((item) => [
      item.summary,
      item.opponentUse,
      item.boardImpact
    ])
  ].join(' ')
  if (scoreUsedAsReason(prose)) {
    errors.push('不得用引擎分數高低代替棋理與盤面因果。')
  }
  if (!audit.enoughEvidence) errors.push('AI 判定目前證據仍不足。')
  if (dualComparison?.status === 'disagreement') {
    const adjudication = audit.dualEngineAdjudication
    if (!adjudication) {
      errors.push('雙引擎分歧時缺少專門的比較判斷。')
    } else {
      const candidateMoves = new Set(
        dualComparison.candidateLines.map((line) => line.move)
      )
      const candidateDisplayMoves = dualComparison.candidateLines.map(
        (line) => line.displayMove
      )
      if (
        adjudication.verdict !== 'uncertain' &&
        (!adjudication.preferredMove ||
          !candidateMoves.has(adjudication.preferredMove))
      ) {
        errors.push('雙引擎判斷選了不在分歧候選中的著法。')
      }
      if (
        adjudication.verdict === 'uncertain' &&
        adjudication.preferredMove !== null
      ) {
        errors.push('判定證據不足時不得假裝選出偏好著法。')
      }
      const comparisonText = [
        adjudication.humanControlComparison,
        adjudication.longTermComparison,
        adjudication.decisionReason
      ].join(' ')
      for (const move of candidateDisplayMoves) {
        if (move && !comparisonText.includes(move)) {
          errors.push(`雙引擎比較沒有逐字對照候選著法 ${move}。`)
        }
      }
      if (
        !/(可控|控盤|容錯|走歪|失控|強迫|强迫|分支|精度|風險|风险)/.test(
          adjudication.humanControlComparison
        )
      ) {
        errors.push('雙引擎比較沒有分析人類可控性、容錯或執行風險。')
      }
      if (
        !/(後續|长期|長期|部署|王區|王区|子力|陣形|阵形|攻勢|攻势|殘局|残局)/.test(
          adjudication.longTermComparison
        )
      ) {
        errors.push('雙引擎比較沒有分析後續局勢與長期發展。')
      }
      if (scoreUsedAsReason(comparisonText)) {
        errors.push('雙引擎比較不得以分數高低代替可控性與局面原因。')
      }
      const referencedEvidence = evidence.filter((item) =>
        adjudication.evidenceIds.includes(item.id)
      )
      if (new Set(referencedEvidence.map((item) => item.engineId)).size < 2) {
        errors.push('雙引擎比較必須同時引用兩個不同引擎的證據。')
      }
    }
  }
  return errors
}

function concreteVerifiedConsequences(
  audit: ConsequenceAudit
): ConsequenceFinding[] {
  return audit.consequences.filter(
    (item) => item.verified && consequenceTextIssues(item).length === 0
  )
}

function evidenceSignature(evidence: HarnessEvidence[]): string {
  const latestBySource = new Map<string, HarnessEvidence>()
  for (const item of evidence) {
    latestBySource.set(`${item.engineId}:${item.move ?? 'root'}`, item)
  }
  return [...latestBySource.values()]
    .sort((a, b) => a.engineId.localeCompare(b.engineId))
    .map((item) =>
      [
        item.engineId,
        item.depth ?? 'none',
        item.analysis.scoreAfterBestMove?.comparableValue ?? 'none',
        item.analysis.scoreAfterUserMove?.comparableValue ?? 'none',
        ...(item.analysis.displayPrincipalVariation ?? []).slice(0, 16),
        ...(item.analysis.displayUserMovePrincipalVariation ?? []).slice(0, 16)
      ].join('|')
    )
    .join('::')
}

export function validateAnswer(
  answer: HarnessAnswer,
  evidence: HarnessEvidence[],
  requirements: AnswerRequirements
): string[] {
  const errors: string[] = []
  const evidenceIds = new Set(evidence.map((item) => item.id))
  const explanationMoves = [...new Set(collectDisplayMoves(evidence))]
  if (!answer.directAnswer?.trim()) errors.push('缺少直接回答。')
  const directNeedsEvidence = !/目前(模型|引擎).*(不足|未能)/.test(
    answer.directAnswer
  )
  if (
    directNeedsEvidence &&
    (!Array.isArray(answer.directAnswerEvidenceIds) ||
      answer.directAnswerEvidenceIds.length === 0)
  ) {
    errors.push('直接回答沒有證據引用。')
  } else if (Array.isArray(answer.directAnswerEvidenceIds)) {
    for (const id of answer.directAnswerEvidenceIds) {
      if (!evidenceIds.has(id)) errors.push(`直接回答引用了不存在的 ${id}。`)
    }
  }
  if (!Array.isArray(answer.sections)) {
    errors.push('回答段落格式錯誤。')
  } else {
    if (answer.sections.length < requirements.requiredHeadings.length) {
      errors.push(`回答太簡略，需要完整的 ${requirements.requiredHeadings.length} 個區塊。`)
    }
    if (answer.sections.some((section) => !/^問[：:]/.test(section.heading.trim()))) {
      errors.push('每個段落標題都必須使用「問：」格式。')
    }
    for (const heading of requirements.requiredHeadings) {
      if (!answer.sections.some((section) => section.heading.includes(heading))) {
        errors.push(`回答缺少「${heading}」區塊。`)
      }
    }
  }
  const claims = Array.isArray(answer.sections)
    ? answer.sections.flatMap((section) => section.claims ?? [])
    : []
  for (const claim of claims) {
    if (!claim.id || !claim.text?.trim()) {
      errors.push('存在空白主張。')
      continue
    }
    if (!Array.isArray(claim.evidenceIds) || claim.evidenceIds.length === 0) {
      errors.push(`${claim.id} 沒有證據引用。`)
      continue
    }
    for (const id of claim.evidenceIds) {
      if (!evidenceIds.has(id)) errors.push(`${claim.id} 引用了不存在的 ${id}。`)
    }
  }
  const verifiedFindingIds = new Set(requirements.verifiedFindingIds ?? [])
  if (verifiedFindingIds.size > 0) {
    for (const section of answer.sections) {
      const isGroundedCoreSection = [
        SECTION_KEYS.missed,
        SECTION_KEYS.opponent,
        SECTION_KEYS.consequences,
        SECTION_KEYS.comparison
      ].some((key) => section.heading.includes(key))
      if (!isGroundedCoreSection) continue
      for (const claim of section.claims) {
        if (/證據不足|证据不足|無法確認|无法确认/.test(claim.text)) continue
        const findingIds = claim.findingIds ?? []
        if (findingIds.length === 0) {
          errors.push(`${claim.id} 沒有連到已驗證的具體後果 K 編號。`)
          continue
        }
        for (const id of findingIds) {
          if (!verifiedFindingIds.has(id)) {
            errors.push(`${claim.id} 引用了未通過審查的具體後果 ${id}。`)
          }
        }
      }
    }
  }
  const prose = [
    answer.title,
    answer.directAnswer,
    ...(answer.sections ?? []).map((section) => section.heading),
    ...claims.map((claim) => claim.text)
  ].join(' ')
  if (requirements.hasUserMove && explanationMoves.length >= 2) {
    const mentionedMoveCount = explanationMoves.filter((move) =>
      prose.includes(move)
    ).length
    if (mentionedMoveCount < 2) {
      errors.push('回答沒有把棋理原因連回至少兩步引擎主線中的中文著法。')
    }
  }
  if (!containsConcreteXiangqiTerm(prose)) {
    errors.push(
      `回答沒有使用具體象棋詞彙（例如：${CONCRETE_TERM_EXAMPLES}）指出位置、棋子關係或威脅。`
    )
  }
  for (const note of answer.generalNotes ?? []) {
    if (/\[E\d+\]/.test(note) || /引擎(證實|证实|驗證|验证|確認|确认)/.test(note)) {
      errors.push('一般棋理補充不得引用證據編號或聲稱經過引擎驗證，必須與引擎結論分開。')
    }
  }
  if (!/(後續|接下來|續走|主要變例|具體後果)/.test(prose)) {
    errors.push('回答缺少後續主線與具體後果。')
  }
  if (requirements.hasUserMove && !/(錯失|不好|問題|不對)/.test(prose)) {
    errors.push('回答沒有說明使用者著法為什麼不好。')
  }
  if (scoreUsedAsReason(prose)) errors.push('回答以分數高低代替棋理原因。')
  if (requirements.dualEngineDisagreement) {
    const dualSection = answer.sections.find((section) =>
      section.heading.includes('雙引擎分歧')
    )
    if (!dualSection) {
      errors.push('回答缺少「雙引擎分歧」比較區塊。')
    } else {
      const dualText = dualSection.claims.map((claim) => claim.text).join(' ')
      if (
        !/(可控|控盤|容錯|走歪|失控|強迫|强迫|分支|精度|風險|风险)/.test(
          dualText
        )
      ) {
        errors.push('雙引擎分歧區塊沒有說明人類可控性或執行風險。')
      }
      const referencedEngineIds = new Set(
        dualSection.claims
          .flatMap((claim) => claim.evidenceIds)
          .map((id) => evidence.find((item) => item.id === id)?.engineId)
          .filter((id): id is string => Boolean(id))
      )
      if (referencedEngineIds.size < 2) {
        errors.push('雙引擎分歧區塊沒有同時引用兩個引擎。')
      }
    }
  }
  if (/\b[a-i][0-9][a-i][0-9]\b/.test(prose)) {
    errors.push('回答含有未翻譯的引擎座標著法。')
  }
  return errors
}

function removeUnsupportedClaims(
  answer: HarnessAnswer,
  unsupportedIds: Set<string>
): HarnessAnswer {
  return {
    ...answer,
    directAnswer: unsupportedIds.has('DIRECT')
      ? '目前引擎證據不足，無法確認原本的直接回答。'
      : answer.directAnswer,
    directAnswerEvidenceIds: unsupportedIds.has('DIRECT')
      ? []
      : answer.directAnswerEvidenceIds,
    sections: answer.sections
      .map((section) => ({
        ...section,
        claims: section.claims.filter((claim) => !unsupportedIds.has(claim.id))
      }))
      .filter((section) => section.claims.length > 0),
    warnings:
      unsupportedIds.size > 0
        ? [...answer.warnings, '部分敘述因缺乏引擎證據而未顯示。']
        : answer.warnings
  }
}

function buildFallbackAnswer(
  mode: HarnessAnswer['mode'],
  session: AnalysisSession,
  evidence: HarnessEvidence[],
  audit?: ConsequenceAudit
): HarnessAnswer {
  const analysis = session.engineAnalysis
  const evidenceId = evidence[0]?.id
  const evidenceIds = evidenceId ? [evidenceId] : []
  const bestLine = (analysis.displayPrincipalVariation ?? []).slice(0, 8)
  const userLine = (analysis.displayUserMovePrincipalVariation ?? []).slice(0, 8)
  const bestLineText =
    bestLine.length > 0 ? bestLine.join('、') : '引擎沒有提供足夠的中文主線'
  const userLineText =
    userLine.length > 1 ? userLine.join('、') : '引擎沒有提供足夠的使用者著法後續主線'
  const userMove = analysis.displayUserMove ?? '這步'
  const bestMove = analysis.displayBestMove ?? '引擎首選'
  const findings = audit ? concreteVerifiedConsequences(audit) : []
  const firstFinding = findings[0]
  const secondFinding = findings[1]
  const dualComparison =
    session.dualEngineComparison ??
    buildDualEngineComparison(
      session.engineAnalysis,
      session.verificationEngineAnalysis
    )
  const sections: HarnessAnswer['sections'] = [
    {
      heading: '問：最佳著法想做什麼？',
      claims: [
        {
          id: 'F1',
          text:
            audit?.bestMovePurpose ||
            `引擎首選${bestMove}，但目前證據只能確認主線為：${bestLineText}，尚不能安全推定更具體的戰略目的。`,
          evidenceIds
        }
      ]
    },
    {
      heading: '問：你的著法錯失什麼？',
      claims: [
        {
          id: 'F2',
          text:
            audit?.userMoveProblem ||
            `目前引擎證據不足，無法確認${userMove}錯失的具體機會。`,
          evidenceIds,
          findingIds: findings.map((item) => item.id)
        }
      ]
    },
    {
      heading: '問：對手如何利用？',
      claims: [
        {
          id: 'F3',
          text:
            firstFinding?.opponentUse ||
            '目前引擎證據不足，無法確認對手可利用的具體方式。',
          evidenceIds,
          findingIds: firstFinding ? [firstFinding.id] : []
        }
      ]
    },
    {
      heading: '問：後續主線與具體後果是什麼？',
      claims: [
        {
          id: 'F4',
          text: `最佳著法主線：${bestLineText}。你的著法主線：${userLineText}。${firstFinding?.boardImpact ?? '目前尚未找到足夠證據說明具體盤面後果。'}`,
          evidenceIds,
          findingIds: findings.map((item) => item.id)
        }
      ]
    },
    {
      heading: '問：兩種著法完整比較後，差別在哪裡？',
      claims: [
        {
          id: 'F5',
          text:
            firstFinding && secondFinding
              ? `${bestMove}保留了${audit?.bestMovePurpose}；${userMove}則讓對手${firstFinding.opponentUse}，並造成${secondFinding.boardImpact}。`
              : '目前主線不足以完成兩種著法的因果比較，不能只用原始分數下結論。',
          evidenceIds,
          findingIds: findings.map((item) => item.id)
        }
      ]
    },
    {
      heading: '問：下次遇到類似局面要先問自己什麼？',
      claims: [
        {
          id: 'F6',
          text: '先問最佳著法正在爭取什麼，再檢查自己的著法是否放棄先手、限制己方棋子、削弱王區或讓對手順利完成部署；最後沿著對手最強回應看到具體後果。',
          evidenceIds
        }
      ]
    }
  ]
  if (dualComparison?.status === 'disagreement') {
    const dualEvidenceIds = evidence
      .filter((item) =>
        [
          dualComparison.primaryEngineName,
          dualComparison.verificationEngineName
        ].includes(item.engineName)
      )
      .slice(0, 4)
      .map((item) => item.id)
    const lineNames = dualComparison.candidateLines
      .map((line) => line.displayMove)
      .join('與')
    sections.splice(sections.length - 1, 0, {
      heading: '問：雙引擎分歧時，哪條線更適合人類？',
      claims: [
        {
          id: 'FD1',
          text: `${lineNames}目前仍有分歧。兩條線的人類可控性、容錯、強迫程度與後續王區風險尚缺少足夠交叉證據，因此不能平均分數或假裝選出唯一答案。`,
          evidenceIds: dualEvidenceIds
        }
      ]
    })
  }

  return {
    mode,
    title: '你問我答：著法分析',
    directAnswer:
      firstFinding && secondFinding
        ? `${userMove}的主要問題是${audit?.userMoveProblem || firstFinding.summary}。對手可以${firstFinding.opponentUse}，後續又會造成${secondFinding.boardImpact}。`
        : `目前引擎證據不足，主線還不能證明${userMove}錯失了哪兩項具體機會，因此不能只用分數高低代替解釋。`,
    directAnswerEvidenceIds: evidenceIds,
    sections,
    generalNotes: [],
    evidence,
    warnings: ['AI 結構化回答未通過驗證，已改用引擎資料產生保守版問答。']
  }
}

function renderAnswer(answer: HarnessAnswer): string {
  const lines = [
    `## ${answer.title}`,
    '',
    '### 你問：這個局面該怎麼理解？',
    '',
    `AI 答：${answer.directAnswer} ${answer.directAnswerEvidenceIds
      .map((id) => `[${id}]`)
      .join(' ')}`
  ]
  for (const section of answer.sections) {
    lines.push('', `### ${section.heading}`)
    for (const claim of section.claims) {
      lines.push(
        `AI 答：${claim.text} ${claim.evidenceIds.map((id) => `[${id}]`).join(' ')}`
      )
    }
  }
  const generalNotes = answer.generalNotes ?? []
  if (generalNotes.length > 0) {
    lines.push(
      '',
      '### 一般棋理補充（教練常識，未經引擎驗證）',
      ...generalNotes.map((note) => `- ${note}`)
    )
  }
  if (answer.warnings.length > 0) {
    lines.push('', '### 注意', ...answer.warnings.map((warning) => `- ${warning}`))
  }
  const latest = answer.evidence.at(-1)?.analysis
  if (latest) {
    lines.push('', '### 引擎原始主線（只供查證，不是原因）')
    lines.push(
      `- 最佳著法｜原始分數：${latest.scoreAfterBestMove?.raw ?? '無'}｜${(latest.displayPrincipalVariation ?? []).slice(0, 16).join('、') || '無主線'}`
    )
    if (latest.userMove) {
      lines.push(
        `- 你的著法｜原始分數：${latest.scoreAfterUserMove?.raw ?? '無'}｜${(latest.displayUserMovePrincipalVariation ?? []).slice(0, 16).join('、') || '無主線'}`
      )
    }
  }
  return lines.join('\n')
}

export async function runExplanationHarness(
  payload: GenerateExplanationStartPayload,
  deps: HarnessDependencies
): Promise<HarnessRunResult> {
  const mode = payload.answerMode ?? 'research'
  const timing = {
    progressDelayMs: deps.timing?.progressDelayMs ?? PROGRESS_DELAY_MS,
    progressIntervalMs:
      deps.timing?.progressIntervalMs ?? PROGRESS_INTERVAL_MS,
    stagnationMs: deps.timing?.stagnationMs ?? STAGNATION_MS,
    minResearchRoundMs:
      deps.timing?.minResearchRoundMs ?? MIN_RESEARCH_ROUND_MS,
    maxResearchRoundMs:
      deps.timing?.maxResearchRoundMs ?? MAX_RESEARCH_ROUND_MS,
    continuationTimeoutMs:
      deps.timing?.continuationTimeoutMs ?? CONTINUATION_TIMEOUT_MS
  }
  const budget = {
    ...(payload.budget ?? {
    engineTimeMs: 10_000,
    maxEngineRounds: 3,
    maxModelCalls: mode === 'research' ? 6 : 4,
    maxOutputTokens: mode === 'research' ? 10_000 : 4_000
    })
  }
  let modelCalls = 0
  const modelCallLimit = budget.maxModelCalls
  let outputTokens = 0
  let engineRounds = 0
  const evidence: HarnessEvidence[] = []
  const validationErrors: string[] = []
  const phases: HarnessTrace['phases'] = []
  let usage: TokenUsage | undefined
  /** 提升到函式作用域，讓逾時自動收尾（catch 區塊）也能用目前已知的具體後果產生保守版答案。 */
  let audit: ConsequenceAudit = {
    bestMovePurpose: '',
    userMoveProblem: '',
    consequences: [],
    contradictions: [],
    enoughEvidence: false
  }
  const traceId = randomUUID()
  const primaryEngineId =
    payload.engineId ??
    deps.session.primaryEngineId ??
    deps.registry.list().activeEngineId ??
    'unknown-engine'
  const verificationEngineId =
    payload.verificationEngineId ?? deps.session.verificationEngineId
  const dualComparison =
    deps.session.dualEngineComparison ??
    buildDualEngineComparison(
      deps.session.engineAnalysis,
      deps.session.verificationEngineAnalysis
    )
  const canonicalMove =
    payload.attachedMove ??
    deps.session.userMove ??
    deps.session.engineAnalysis.userMove
  const requiredHeadings = canonicalMove
      ? [
          '最佳著法想做什麼',
          '你的著法錯失什麼',
          '對手如何利用',
          '後續主線與具體後果',
          '兩種著法完整比較',
          '下次遇到類似局面'
        ]
      : [
          '最佳著法想做什麼',
          '後續主線與具體後果',
          '下次遇到類似局面'
        ]
  if (dualComparison?.status === 'disagreement') {
    requiredHeadings.splice(
      requiredHeadings.length - 1,
      0,
      '雙引擎分歧'
    )
  }
  const answerRequirements: AnswerRequirements = {
    hasUserMove: Boolean(canonicalMove),
    requiredHeadings,
    dualEngineDisagreement: dualComparison?.status === 'disagreement'
  }
  const startedAt = Date.now()
  let verifiedConsequenceCount = 0
  let latestDepth: number | null = deps.session.engineAnalysis.depth
  let latestVariation =
    deps.session.engineAnalysis.displayUserMovePrincipalVariation ??
    deps.session.engineAnalysis.displayPrincipalVariation ??
    []

  const progress = (
    phase: HarnessPhase,
    message: string,
    extra: Partial<Omit<HarnessProgressPayload, 'requestId' | 'phase' | 'message'>> = {}
  ): void => {
    phases.push({ phase, at: new Date().toISOString(), message })
    deps.onProgress({
      phase,
      message,
      modelCallsUsed: modelCalls,
      engineRoundsUsed: engineRounds,
      evidenceCount: evidence.length,
      elapsedMs: Date.now() - startedAt,
      depth: latestDepth,
      displayPrincipalVariation: latestVariation.slice(0, 12),
      verifiedConsequenceCount,
      ...extra
    })
  }

  const saveTrace = (status: HarnessTrace['status'], finalText?: string): void => {
    deps.traceStore.save({
      id: traceId,
      createdAt: new Date().toISOString(),
      positionFen: deps.session.positionFen,
      question: payload.followUpQuestion,
      attachedMove: canonicalMove,
      mode,
      primaryEngineId,
      verificationEngineId,
      phases,
      evidence,
      validationErrors,
      modelCalls,
      engineRounds,
      usage,
      status,
      finalText
    })
  }

  const callModel = async (
    prompt: string,
    preferredMaxTokens = 3_000
  ): Promise<string> => {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      if (deps.signal.aborted) {
        throw new DOMException('Request cancelled', 'AbortError')
      }
      if (modelCalls >= modelCallLimit) {
        throw new HarnessModelBudgetExceededError()
      }
      const remainingTokens = Math.max(256, budget.maxOutputTokens - outputTokens)
      modelCalls += 1
      try {
        const response = await deps.provider.generateExplanation(
          {
            provider: payload.provider,
            model: deps.model,
            apiKey: deps.apiKey,
            baseUrl: payload.baseUrl,
            prompt,
            maxOutputTokens: Math.min(remainingTokens, preferredMaxTokens),
            metadata: {
              requestId: payload.requestId,
              analysisId: payload.analysisId,
              userLevel: payload.userLevel,
              explanationStyle: payload.explanationStyle
            }
          },
          deps.signal
        )
        if (response.usage) {
          outputTokens += response.usage.outputTokens
          usage = {
            inputTokens: (usage?.inputTokens ?? 0) + response.usage.inputTokens,
            outputTokens: (usage?.outputTokens ?? 0) + response.usage.outputTokens
          }
        }
        return response.text
      } catch (error) {
        rethrowAbortLikeError(error)
        if (attempt > 0 || !isTransientModelError(error)) throw error
        progress(
          'provider_retry',
          'AI 服務暫時沒有成功回應，正在自動重試一次。'
        )
        await delayWithAbort(600, deps.signal)
      }
    }
    throw new Error('AI 服務重試後仍未回應。')
  }

  const waitForUserContinuation = async (message: string): Promise<void> => {
    progress('waiting_for_user', message, { awaitingDecision: true })
    if (!deps.waitForContinuation) {
      throw new Error('Harness 需要使用者決定是否繼續分析。')
    }
    let timedOut = false
    let timer: ReturnType<typeof setTimeout> | undefined
    try {
      const timeoutPromise = new Promise<void>((resolve) => {
        timer = setTimeout(() => {
          timedOut = true
          resolve()
        }, timing.continuationTimeoutMs)
      })
      await Promise.race([deps.waitForContinuation(), timeoutPromise])
    } finally {
      if (timer) clearTimeout(timer)
    }
    if (timedOut) {
      progress(
        'waiting_for_user',
        `已等待使用者確認超過 ${Math.round(timing.continuationTimeoutMs / 1000)} 秒，改用目前引擎證據自動收尾。`,
        { awaitingDecision: false }
      )
      throw new HarnessContinuationTimeoutError()
    }
    if (deps.signal.aborted) {
      throw new DOMException('Request cancelled', 'AbortError')
    }
    progress('engine_research', '已繼續加深引擎分析。', {
      awaitingDecision: false
    })
  }

  try {
    progress('understanding', '正在理解問題與局面。')
    if (isAmbiguousQuestion(payload.followUpQuestion, canonicalMove)) {
      const finalText = '請先在棋盤上選取你指的著法，或在問題中說明是哪一步。'
      progress('completed', '需要補充問題中的著法。')
      saveTrace('clarification_required', finalText)
      return {
        finalText,
        evidence,
        warnings: [],
        traceId,
        clarificationRequired: true,
        usage
      }
    }

    progress('planning', '正在建立可驗證的引擎研究任務。')
    // 任務種類有限，可由確定性規則完整建立；不浪費一次外接模型呼叫做規劃。
    const deterministicTasks: HarnessTask[] = []
    const rootTask = validateTask(
      {
        kind: 'root',
        purpose: payload.followUpQuestion?.trim()
          ? '追問前重新確認目前局面與主要變例'
          : '確認目前局面的最佳著法與後續主線'
      },
      deps.session
    )
    if (rootTask && (payload.reuseEvidence !== true || !canonicalMove)) {
      deterministicTasks.push(rootTask)
    }
    if (canonicalMove) {
      const task = validateTask(
        {
          kind: 'evaluate_move',
          move: canonicalMove,
          purpose: '比較最佳著法與使用者著法，追查錯失機會、對手利用方式與具體後果'
        },
        deps.session
      )
      if (task) deterministicTasks.push(task)
    }
    let plan = normalizePlannerResult(
      { tasks: deterministicTasks },
      deps.session,
      canonicalMove
    )
    if (plan.clarification && plan.tasks.length === 0) {
      progress('completed', '問題需要補充資訊。')
      saveTrace('clarification_required', plan.clarification)
      return {
        finalText: plan.clarification,
        evidence,
        warnings: [],
        traceId,
        clarificationRequired: true,
        usage
      }
    }

    if (
      deps.session.engineDisagreement &&
      deps.session.verificationEngineAnalysis
    ) {
      const conflictingMoves = [
        deps.session.engineAnalysis.bestMove,
        deps.session.verificationEngineAnalysis.bestMove
      ]
      for (const move of conflictingMoves) {
        const task = validateTask(
          {
            kind: 'evaluate_move',
            move,
            purpose: '加深驗證主引擎與複核引擎的分歧著法'
          },
          deps.session
        )
        if (task && !plan.tasks.some((item) => item.move === move)) {
          plan.tasks.push(task)
        }
      }
    }

    evidence.push(
      makeEvidence('E1', deps.session.engineAnalysis, '初始主引擎分析')
    )
    if (
      canonicalMove &&
      deps.session.engineAnalysis.userMove === canonicalMove
    ) {
      evidence.push(
        makeEvidence(
          `E${evidence.length + 1}`,
          deps.session.engineAnalysis,
          '初始主引擎使用者著法分析',
          canonicalMove
        )
      )
    }
    if (deps.session.verificationEngineAnalysis) {
      evidence.push(
        makeEvidence(
          `E${evidence.length + 1}`,
          deps.session.verificationEngineAnalysis,
          '初始複核引擎分析'
        )
      )
      if (
        canonicalMove &&
        deps.session.verificationEngineAnalysis.userMove === canonicalMove
      ) {
        evidence.push(
          makeEvidence(
            `E${evidence.length + 1}`,
            deps.session.verificationEngineAnalysis,
            '初始複核引擎使用者著法分析',
            canonicalMove
          )
        )
      }
    }
    const knowledgeQuery = [
      payload.followUpQuestion ?? '',
      deps.session.engineAnalysis.displayBestMove ?? '',
      deps.session.engineAnalysis.displayUserMove ?? '',
      ...(dualComparison?.candidateLines.map((line) => line.displayMove) ?? []),
      '最佳著法目的 錯失機會 對手利用 後續局面 人類可控性'
    ].join(' ')
    const knowledgeContext = formatXiangqiKnowledgeForPrompt(
      selectXiangqiKnowledge(knowledgeQuery, { includeCore: true, limit: 18 })
    )

    const primaryAdapter = deps.registry.getAdapter(primaryEngineId)
    const verificationAdapter = verificationEngineId
      ? deps.registry.getAdapter(verificationEngineId)
      : null
    let auditErrors: string[] = []
    let previousSignature = evidenceSignature(evidence)
    let lastNovelEvidenceAt = Date.now()
    let lastContinuationSignature: string | null = null
    let shouldResearch = primaryAdapter !== null

    while (true) {
      if (shouldResearch && engineRounds >= budget.maxEngineRounds) {
        shouldResearch = false
        validationErrors.push('已達引擎加深輪數上限，停止加深並使用目前證據。')
      }
      if (shouldResearch && primaryAdapter) {
        const roundMs = Math.min(
          timing.maxResearchRoundMs,
          Math.max(timing.minResearchRoundMs, budget.engineTimeMs) +
            engineRounds * 10_000
        )
        progress(
          verificationAdapter ? 'cross_verification' : 'engine_research',
          `正在加深比較最佳著法與你的著法，本輪至少分析 ${(roundMs / 1000).toFixed(0)} 秒。`
        )
        const roundStartedAt = Date.now()
        let liveDepth: number | null = latestDepth
        let liveVariation = latestVariation
        const reportTimer = setInterval(() => {
          const elapsedMs = Date.now() - startedAt
          if (elapsedMs < timing.progressDelayMs) return
          progress(
            verificationAdapter ? 'cross_verification' : 'engine_research',
            `仍在尋找可驗證的具體後果；目前深度 ${liveDepth ?? '—'}，已確認 ${verifiedConsequenceCount} 項。`,
            {
              elapsedMs,
              depth: liveDepth,
              displayPrincipalVariation: liveVariation.slice(0, 12)
            }
          )
        }, timing.progressIntervalMs)
        try {
          const config = {
            rootAnalysisMovetimeMs: roundMs,
            userMoveEvalMovetimeMs: roundMs,
            multiPv: mode === 'research' ? 5 : 3
          }
          // evaluate_move 任務本身也會重新分析根局面，因此有指定著法時不再另跑
          // 重複 root 任務。雙引擎分歧時，兩邊推薦著法都會由兩個引擎交叉驗證。
          const evaluationTasks = plan.tasks.filter(
            (task) => task.kind === 'evaluate_move'
          )
          const roundTasks = (
            evaluationTasks.length > 0
              ? evaluationTasks
              : plan.tasks.filter((task) => task.kind === 'root')
          ).slice(0, 4)
          const effectiveTasks: HarnessTask[] =
            roundTasks.length > 0
              ? roundTasks
              : [{ kind: 'root', purpose: '確認目前局面' }]
          const jobs: Array<{
            engine: 'primary' | 'verification'
            task: HarnessTask
            result: Promise<EngineAnalysis>
          }> = []
          for (const task of effectiveTasks) {
            jobs.push({
              engine: 'primary',
              task,
              result: primaryAdapter.analyzePosition(
                {
                  positionFen: deps.session.positionFen,
                  userMove: task.kind === 'evaluate_move' ? task.move : undefined
                },
                config,
                {
                  signal: deps.signal,
                  onProgress: (live) => {
                    liveDepth = live.depth
                    liveVariation = live.displayPrincipalVariation
                    latestDepth = live.depth
                    latestVariation = live.displayPrincipalVariation
                  }
                }
              )
            })
            if (verificationAdapter) {
              jobs.push({
                engine: 'verification',
                task,
                result: verificationAdapter.analyzePosition(
                  {
                    positionFen: deps.session.positionFen,
                    userMove:
                      task.kind === 'evaluate_move' ? task.move : undefined
                  },
                  config,
                  { signal: deps.signal }
                )
              })
            }
          }
          const settledJobs = await Promise.all(
            jobs.map(async (job) => {
              try {
                return { ok: true as const, ...job, analysis: await job.result }
              } catch (error) {
                rethrowAbortLikeError(error)
                return { ok: false as const, ...job, error }
              }
            })
          )
          const completedJobs = settledJobs.filter(
            (job): job is Extract<(typeof settledJobs)[number], { ok: true }> =>
              job.ok
          )
          for (const failed of settledJobs.filter((job) => !job.ok)) {
            validationErrors.push(
              `${failed.engine === 'primary' ? '主引擎' : '複核引擎'}未完成「${failed.task.purpose}」，已保留其他可用證據。`
            )
          }
          engineRounds += 1
          const latestPrimary = completedJobs
            .filter((job) => job.engine === 'primary')
            .at(-1)?.analysis
          if (latestPrimary) {
            latestDepth = latestPrimary.depth
            latestVariation =
              latestPrimary.displayUserMovePrincipalVariation ??
              latestPrimary.displayPrincipalVariation ??
              []
          }
          for (const job of completedJobs) {
            evidence.push(
              makeEvidence(
                `E${evidence.length + 1}`,
                job.analysis,
                `第 ${engineRounds} 輪${job.engine === 'primary' ? '主引擎' : '複核引擎'}：${job.task.purpose}`,
                job.task.kind === 'evaluate_move' ? job.task.move : undefined
              )
            )
          }
        } finally {
          clearInterval(reportTimer)
        }

        const nextSignature = evidenceSignature(evidence)
        if (nextSignature !== previousSignature) {
          previousSignature = nextSignature
          lastNovelEvidenceAt = Date.now()
          lastContinuationSignature = null
        } else if (
          Date.now() - lastNovelEvidenceAt >= timing.stagnationMs &&
          lastContinuationSignature !== nextSignature
        ) {
          await waitForUserContinuation(
            '連續 60 秒沒有提升深度或發現新變例。要繼續加深，還是取消本次分析？'
          )
          budget.maxEngineRounds += 1
          lastContinuationSignature = nextSignature
          lastNovelEvidenceAt = Date.now()
        }
        progress(
          'consequence_review',
          `本輪引擎研究完成（${((Date.now() - roundStartedAt) / 1000).toFixed(1)} 秒），正在檢查是否已有兩項具體後果。`
        )
      }

      try {
        audit = normalizeConsequenceAudit(
          jsonFromText<ConsequenceAudit>(
            await callModel(`
你是象棋分析 Harness 的「具體後果審查器」。只輸出 JSON，不要輸出思考過程。
你可以根據棋盤 FEN 與引擎主線推導棋理，但每項結論必須指出主線中實際出現的中文著法。
目標不是比較分數，而是回答：
1. 最佳著法的具體目的。
2. 使用者著法錯失了什麼機會、為什麼不好。
3. 對手如何利用。
4. 最終造成哪些盤面影響。

可接受的具體後果類型：
- initiative_loss：失去先手
- piece_restriction：棋子受限
- king_safety：王區變弱
- structure_damage：陣形變差
- opponent_development：讓對手完成部署
- material_or_tactical：可驗證的失子、將軍或戰術後果

至少提出兩項互不重複的後果。supportingMoves 必須逐字使用 evidence 主線中的中文著法。
summary、opponentUse、boardImpact 都不能只寫「失去先手」「棋子受限」「王區變弱」「陣形變差」「讓對手完成部署」這類標籤；必須說出哪幾步主線如何造成該後果。
summary、opponentUse、boardImpact 三段合起來必須逐字出現至少兩步不同的主線著法，
並至少使用一個具體象棋詞彙（例如：${CONCRETE_TERM_EXAMPLES}）指出位置、棋子關係或威脅。
三段必須各自說明不同層面（後果本身／對手利用／盤面影響），不得互相改寫湊字數。
不在這盤引擎主線中的一般開局／中局原則不能當作 verified 後果；verified 後果只能來自引擎主線可查證的因果。
若兩項解釋互相矛盾，放入 contradictions，enoughEvidence 必須是 false。
禁止以「分數較高／較低」作為任何原因；原始分數只供查證。

以下是本機術語知識，只能幫助你理解詞義，不能當成本局引擎證據：
${knowledgeContext}

${
  dualComparison?.status === 'disagreement'
    ? `本局有雙引擎分歧。你必須另外輸出 dualEngineAdjudication，逐條比較兩個候選的：
- 人類可控性：強迫程度、容錯、容易走歪或失控的風險、是否需要連續唯一著。
- 後續發展：王區安全、子力活動、陣形、部署、長期優勢與可逆性。
- 兩個引擎對彼此候選的交叉支持；不得平均分數。
若證據仍不足，verdict 必須是 uncertain，preferredMove 與 preferredDisplayMove 必須是 null。
雙引擎確定性比較資料：${JSON.stringify(dualComparison)}`
    : '本局沒有需要裁決的雙引擎分歧，請省略 dualEngineAdjudication。'
}

局面 FEN：${deps.session.positionFen}
使用者著法：${deps.session.engineAnalysis.displayUserMove ?? '未提供'}
最佳著法：${deps.session.engineAnalysis.displayBestMove ?? '未提供'}
證據：${JSON.stringify(
              evidence.map((item) => ({
                id: item.id,
                purpose: item.purpose,
                engineName: item.engineName,
                analysis: publicAnalysis(item.analysis)
              }))
            )}

輸出格式：
{
  "bestMovePurpose":"最佳著法要達成的具體目的",
  "userMoveProblem":"使用者著法錯失什麼，以及為什麼不好",
  "consequences":[
    {
      "id":"K1",
      "category":"initiative_loss",
      "summary":"具體後果",
      "opponentUse":"對手如何利用",
      "boardImpact":"後面盤面受到什麼影響",
      "supportingMoves":["主線中的中文著法"],
      "evidenceIds":["E1"],
      "verified":true
    }
  ],
  "contradictions":[],
  "enoughEvidence":true,
  "dualEngineAdjudication":{
    "preferredMove":"候選 UCI 著法或 null",
    "preferredDisplayMove":"候選中文著法或 null",
    "verdict":"primary|verification|uncertain",
    "humanControlComparison":"逐字提到兩條中文著法並比較可控性與容錯",
    "longTermComparison":"逐字提到兩條中文著法並比較後續局勢",
    "decisionReason":"不用分數代替原因的結論",
    "evidenceIds":["兩個不同引擎的證據 ID"]
  }
}
`)
          )
        )
        auditErrors = validateConsequenceAudit(
          audit,
          evidence,
          Boolean(canonicalMove),
          dualComparison
        )
      } catch (error) {
        rethrowAbortLikeError(error)
        auditErrors = ['具體後果審查器沒有輸出有效 JSON。']
      }
      verifiedConsequenceCount = concreteVerifiedConsequences(audit).length
      validationErrors.push(...auditErrors)
      if (auditErrors.length === 0) break
      progress(
        'consequence_review',
        `目前只確認 ${verifiedConsequenceCount} 項具體後果，證據仍不足，繼續加深引擎。`
      )
      if (!primaryAdapter || engineRounds >= budget.maxEngineRounds) break
      shouldResearch = true
    }

    const concreteConsequences = concreteVerifiedConsequences(audit)
    const writerAudit: ConsequenceAudit = {
      ...audit,
      consequences: concreteConsequences,
      enoughEvidence:
        auditErrors.length === 0 &&
        concreteConsequences.length >= 2 &&
        new Set(concreteConsequences.map((item) => item.category)).size >= 2
    }
    answerRequirements.verifiedFindingIds = concreteConsequences.map(
      (item) => item.id
    )

    progress('writing', '正在依引擎證據撰寫中文說明。')
    let writerText: string | null = null
    try {
      writerText = await callModel(`
你是象棋教練。只輸出 JSON，不要輸出推理過程。
你只能使用「已驗證具體後果」與引擎證據，不得自行新增戰術事實。
正文完全禁止使用分數高低、評估差距或可信度作為理由，也不要報告這些數字。
著法只能使用證據中的中文名稱，不得顯示 h2e2 之類座標。

先用 directAnswer 寫一段短結論：這步為什麼不好、錯失什麼、對手如何利用、最後造成什麼。
接著固定依序寫完整${dualComparison?.status === 'disagreement' ? '七' : '六'}個問答區塊：
1. 問：最佳著法想做什麼？
2. 問：你的著法錯失什麼？
3. 問：對手如何利用？
4. 問：後續主線與具體後果是什麼？
5. 問：兩種著法完整比較後，差別在哪裡？
6. 問：下次遇到類似局面要先問自己什麼？

第四區要按引擎主線順序，盡可能逐手說明每一步目的與盤面影響，一直寫到具體後果出現。
第五區要先說最佳著法的目的，再逐步對照使用者著法錯失什麼、為什麼不好。
每項 claims 都必須引用 supporting evidenceIds。若資料不足，直接說證據不足，不能猜。
第 2～5 區每個非「證據不足」的 claim 還必須用 findingIds 連到已驗證具體後果的 K 編號；不得自行新增 K 編號。
每個關鍵 claim 至少要包含一個 evidence 主線中的中文著法，並說明這步棋造成的具體盤面後果；禁止只寫「失去先手」「陣形變差」這種分類詞。
第 2～5 區（錯失什麼／對手如何利用／後續後果／完整比較）的每個 claim 都必須附 "causal" 因果鏈物件，五段齊備：
- cause：因為哪一步（必須逐字使用主線中的中文著法）
- mechanism：造成什麼棋理或盤面變化
- affected：受影響的棋子、線路、王區、陣形或威脅
- opponentUse：對手下一步如何利用
- consequence：後續具體變差在哪裡
只有明確承認證據不足的 claim 可以不附 causal。
因果敘述要使用具體象棋詞彙（例如：${CONCRETE_TERM_EXAMPLES}）指出位置、棋子關係或威脅，不能只用抽象評價。
若想補充引擎主線之外的一般棋理原則（例如「無根子容易被捉」），寫進頂層 "generalNotes" 陣列：
每條一句話、最多 3 條、以一般原則的語氣書寫；不得寫進 claims、不得引用證據編號、
也不得寫成這盤棋已被引擎證實的結論。沒有需要就給空陣列。

以下是本機術語知識，只用來正確使用詞義，不能取代引擎 evidence 或 K 編號：
${knowledgeContext}

${
  dualComparison?.status === 'disagreement'
    ? `在「下次遇到類似局面」之前加一區：問：雙引擎分歧時，哪條線更適合人類？
此區必須依 dualEngineAdjudication，同時逐字提到兩條候選中文著法，比較可控性、容錯、走歪或失控風險、王區、子力活動、長期發展；至少引用兩個不同引擎 evidenceIds。不得平均分數。`
    : ''
}

使用者程度：${payload.userLevel}
問題：${payload.followUpQuestion?.trim() || '完整解釋目前局面'}
模式：${mode}
已驗證具體後果：${JSON.stringify(writerAudit)}
證據：${JSON.stringify(
      evidence.map((item) => ({
        id: item.id,
        purpose: item.purpose,
        engineName: item.engineName,
        analysis: publicAnalysis(item.analysis)
      }))
    )}

輸出格式：
{
  "mode":"${mode}",
  "title":"你問我答：著法分析",
  "directAnswer":"先講具體因果的短結論。",
  "directAnswerEvidenceIds":["E1"],
  "sections":[
    {"heading":"問：最佳著法想做什麼？","claims":[
      {"id":"C1","text":"最佳著法的具體目的。","evidenceIds":["E1"]}
    ]},
    {"heading":"問：你的著法錯失什麼？","claims":[
      {"id":"C2","text":"錯失的機會以及為什麼不好。","evidenceIds":["E1"],"findingIds":["K1"],
       "causal":{"cause":"因為走了主線中的某步中文著法","mechanism":"造成的棋理或盤面變化","affected":"受影響的棋子或線路","opponentUse":"對手下一步如何利用","consequence":"後續具體變差在哪裡"}}
    ]},
    {"heading":"問：對手如何利用？","claims":[
      {"id":"C3","text":"對手的具體利用方式。","evidenceIds":["E1"],"findingIds":["K1"]}
    ]},
    {"heading":"問：後續主線與具體後果是什麼？","claims":[
      {"id":"C4","text":"逐手解釋主線到具體後果。","evidenceIds":["E1"],"findingIds":["K1","K2"]}
    ]},
    {"heading":"問：兩種著法完整比較後，差別在哪裡？","claims":[
      {"id":"C5","text":"先說最佳目的，再完整對照使用者著法。","evidenceIds":["E1"],"findingIds":["K1","K2"]}
    ]},
    ${
      dualComparison?.status === 'disagreement'
        ? `{"heading":"問：雙引擎分歧時，哪條線更適合人類？","claims":[
      {"id":"CD1","text":"逐字比較兩條候選的可控性、容錯與長期局勢；證據不足就明說。","evidenceIds":["E1","E2"]}
    ]},`
        : ''
    }
    {"heading":"問：下次遇到類似局面要先問自己什麼？","claims":[
      {"id":"C6","text":"可操作的思考順序。","evidenceIds":["E1"]}
    ]}
  ],
  "generalNotes":[],
  "warnings":[]
}
`)
    } catch (error) {
      if (error instanceof HarnessModelBudgetExceededError) {
        validationErrors.push('已達模型呼叫上限，改用引擎資料產生保守版問答。')
      } else {
        throw error
      }
    }

    let answer: HarnessAnswer
    if (writerText === null) {
      answer = buildFallbackAnswer(mode, deps.session, evidence, writerAudit)
    } else {
      try {
        const parsed = jsonFromText<HarnessAnswer>(writerText)
        answer = attachVerifiedFindingIds({
          mode,
          title: String(parsed.title || '局面分析').slice(0, 100),
          directAnswer: String(parsed.directAnswer || '').slice(0, 4000),
          directAnswerEvidenceIds: Array.isArray(parsed.directAnswerEvidenceIds)
            ? parsed.directAnswerEvidenceIds.map(String).slice(0, 10)
            : [],
          sections: normalizeSections(parsed.sections),
          generalNotes: normalizeGeneralNotes(parsed.generalNotes),
          evidence,
          warnings: Array.isArray(parsed.warnings)
            ? parsed.warnings.map(String).slice(0, 10)
            : []
        }, concreteConsequences)
      } catch {
        answer = buildFallbackAnswer(mode, deps.session, evidence, writerAudit)
        validationErrors.push('寫作者輸出不是有效 JSON。')
      }
    }

    progress('validating', '正在檢查每項敘述的證據引用與因果鏈。')
    const availableMoves = [...new Set(collectDisplayMoves(evidence))]
    const scoreAnswer = (candidate: HarnessAnswer): QualityReport =>
      scoreExplanationAnswer({
        answer: candidate,
        availableMoves,
        bestMoveDisplay: deps.session.engineAnalysis.displayBestMove,
        userMoveDisplay: deps.session.engineAnalysis.displayUserMove,
        hasUserMove: answerRequirements.hasUserMove
      })
    let deterministicErrors = validateAnswer(
      answer,
      evidence,
      answerRequirements
    )
    let quality = scoreAnswer(answer)
    validationErrors.push(...deterministicErrors)
    // 寫作者必須逐 claim 引用 evidenceIds 與已驗證 findingIds；這兩層確定性
    // 關聯取代另一個昂貴、結果仍不穩定的「模型審查模型」呼叫。
    const unsupported = new Set<string>()

    // ---- 品質修正迴圈（loop engineering 核心）----
    // generate → validate → diagnose → 只重寫失敗區塊 → 再 validate。
    // 最多 MAX_SECTION_REWRITES 輪；超過才走保守 fallback，不整篇亂重生。
    let rewriteRounds = 0
    while (
      (deterministicErrors.length > 0 || !quality.pass || unsupported.size > 0) &&
      rewriteRounds < MAX_SECTION_REWRITES &&
      modelCalls < modelCallLimit
    ) {
      rewriteRounds += 1
      // 診斷：彙整每個失敗區塊的具體問題
      const failedHeadings = new Map<string, string[]>()
      for (const diagnosis of quality.failedSections) {
        failedHeadings.set(diagnosis.heading, [...diagnosis.issues])
      }
      for (const section of answer.sections) {
        if (section.claims.some((claim) => unsupported.has(claim.id))) {
          const issues = failedHeadings.get(section.heading) ?? []
          issues.push('含有無法由證據支持的敘述，必須刪除或改寫為有證據的內容。')
          failedHeadings.set(section.heading, issues)
        }
      }
      if (unsupported.has('DIRECT')) {
        const issues = failedHeadings.get('DIRECT') ?? []
        issues.push('直接回答無法由證據支持，必須依證據改寫。')
        failedHeadings.set('DIRECT', issues)
      }
      if (failedHeadings.size === 0 && deterministicErrors.length > 0) {
        const missingHeadings = answerRequirements.requiredHeadings.filter(
          (heading) =>
            !answer.sections.some((section) => section.heading.includes(heading))
        )
        if (missingHeadings.length > 0) {
          for (const heading of missingHeadings) {
            failedHeadings.set(`問：${heading}`, [
              `缺少「${heading}」區塊，必須新增完整區塊。`
            ])
          }
        } else {
          // 純全篇性錯誤（缺著法連結等）：指向後果與比較區塊重寫
          failedHeadings.set(SECTION_KEYS.consequences, [
            ...deterministicErrors
          ])
        }
      }

      const failedCriteria = quality.criteria.filter((criterion) => !criterion.pass)
      const failedIds = new Set(failedCriteria.map((criterion) => criterion.id))
      const loopMessage = failedIds.has('no_vague_wording')
        ? `發現解釋太空泛，正在重寫：${[...failedHeadings.keys()].join('、')}`
        : failedIds.has('opponent_exploitation')
          ? '正在驗證「對手如何利用」並重寫該區塊。'
          : failedIds.has('causal_chains')
            ? '因果鏈不完整，正在補齊原因、機制、受影響對象、對手利用與後果。'
            : failedIds.has('no_score_as_reason')
              ? '發現以分數代替理由的敘述，正在改寫為盤面因果。'
              : `正在修正未達標區塊：${[...failedHeadings.keys()].join('、')}`
      progress('repairing', `${loopMessage}（第 ${rewriteRounds}/${MAX_SECTION_REWRITES} 輪修正）`)

      const sectionsToRewrite = answer.sections.filter((section) =>
        [...failedHeadings.keys()].some((heading) =>
          sectionHeadingMatches(section.heading, heading)
        )
      )
      try {
        const rewritten = jsonFromText<{
          directAnswer?: string
          directAnswerEvidenceIds?: string[]
          sections?: HarnessAnswer['sections']
        }>(
          await callModel(`
只輸出 JSON，不要輸出推理過程。這是針對「失敗區塊」的局部重寫，不是整篇重生。
只重寫下列區塊，其他區塊不要輸出（會原樣保留）：
${JSON.stringify(
            [...failedHeadings.entries()].map(([heading, issues]) => ({
              heading,
              issues
            }))
          )}
全篇性問題（重寫時一併避免）：${JSON.stringify(deterministicErrors)}
規則：
- 禁止新增證據中沒有的棋力判斷；無法支持的敘述直接刪除或改為「證據不足」。
- 禁止用分數高低、評估差距或可信度作為原因。
- 第 2～5 區每個非證據不足 claim 必須用 findingIds 連到可用 K 編號。
- 每個核心 claim 附 "causal" 五段因果鏈（cause 必須逐字含主線中文著法；mechanism/affected 用具體象棋詞彙，例如：${CONCRETE_TERM_EXAMPLES}；consequence 說出具體變差在哪裡）。
- heading 保持原文，claims 引用可用 evidenceIds。
待重寫區塊原文：${JSON.stringify(sectionsToRewrite)}
${failedHeadings.has('DIRECT') ? `原 directAnswer：${JSON.stringify(answer.directAnswer)}（請一併輸出修正後 "directAnswer" 與 "directAnswerEvidenceIds"）` : ''}
已驗證具體後果：${JSON.stringify(writerAudit)}
可用 evidenceIds：${JSON.stringify(evidence.map((item) => item.id))}
可用 findingIds：${JSON.stringify(concreteConsequences.map((item) => item.id))}
可引用的主線中文著法：${JSON.stringify(availableMoves.slice(0, 60))}
本機術語知識（只協助用詞，不是證據）：${knowledgeContext}
輸出格式：{"directAnswer":"（僅在被要求時）","sections":[{"heading":"原標題","claims":[{"id":"C2","text":"...","evidenceIds":["E1"],"findingIds":["K1"],"causal":{"cause":"...","mechanism":"...","affected":"...","opponentUse":"...","consequence":"..."}}]}]}
`)
        )
        const replacements = normalizeSections(rewritten.sections)
        const mergedSections = answer.sections.map((section) => {
          const replacement = replacements.find((candidate) =>
            sectionHeadingMatches(candidate.heading, section.heading)
          )
          const wasFailed = [...failedHeadings.keys()].some((heading) =>
            sectionHeadingMatches(section.heading, heading)
          )
          return wasFailed && replacement
            ? { ...replacement, heading: section.heading }
            : section
        })
        const additions = replacements.filter(
          (replacement) =>
            !mergedSections.some((section) =>
              sectionHeadingMatches(section.heading, replacement.heading)
            )
        )
        if (additions.length > 0) {
          const checklistIndex = mergedSections.findIndex((section) =>
            section.heading.includes(SECTION_KEYS.checklist)
          )
          mergedSections.splice(
            checklistIndex >= 0 ? checklistIndex : mergedSections.length,
            0,
            ...additions
          )
        }
        answer = attachVerifiedFindingIds({
          ...answer,
          directAnswer:
            failedHeadings.has('DIRECT') &&
            typeof rewritten.directAnswer === 'string' &&
            rewritten.directAnswer.trim()
              ? rewritten.directAnswer.slice(0, 4000)
              : answer.directAnswer,
          directAnswerEvidenceIds:
            failedHeadings.has('DIRECT') &&
            Array.isArray(rewritten.directAnswerEvidenceIds)
              ? rewritten.directAnswerEvidenceIds.map(String).slice(0, 10)
              : answer.directAnswerEvidenceIds,
          sections: mergedSections,
          evidence
        }, concreteConsequences)
        // 區塊已重寫，舊的 unsupported claim id 不再對應；由重跑的驗證接手把關。
        unsupported.clear()
      } catch (error) {
        rethrowAbortLikeError(error)
        answer = removeUnsupportedClaims(answer, unsupported)
        unsupported.clear()
      }
      deterministicErrors = validateAnswer(answer, evidence, answerRequirements)
      quality = scoreAnswer(answer)
      if (deterministicErrors.length > 0 || !quality.pass) {
        validationErrors.push(
          `第 ${rewriteRounds} 輪修正後仍未達標：${quality.summary}`,
          ...deterministicErrors
        )
      }
    }

    if (deterministicErrors.length > 0 || !quality.pass || unsupported.size > 0) {
      answer = removeUnsupportedClaims(answer, unsupported)
      const remainingErrors = validateAnswer(
        answer,
        evidence,
        answerRequirements
      )
      if (remainingErrors.length > 0 || !scoreAnswer(answer).pass) {
        validationErrors.push(
          `已達 ${MAX_SECTION_REWRITES} 輪修正上限仍未通過品質檢查，改用引擎資料產生保守版問答。`
        )
        answer = buildFallbackAnswer(mode, deps.session, evidence, writerAudit)
      }
    } else {
      progress(
        'quality_check',
        '已通過品質檢查：最佳著法目的、錯失機會、對手利用、後續後果與完整比較均已驗證。'
      )
    }

    progress('completed', '分析與證據驗證完成。')
    const finalText = renderAnswer(answer)
    saveTrace('completed', finalText)
    return {
      finalText,
      evidence,
      warnings: answer.warnings,
      traceId,
      clarificationRequired: false,
      usage
    }
  } catch (error) {
    if (error instanceof HarnessContinuationTimeoutError) {
      const fallbackAnswer = buildFallbackAnswer(mode, deps.session, evidence, audit)
      fallbackAnswer.warnings.push(
        `已等待使用者確認超過 ${Math.round(timing.continuationTimeoutMs / 1000)} 秒，已自動使用目前引擎證據產生保守版分析。`
      )
      progress('completed', '已等待使用者確認超過時限，自動使用目前證據完成分析。')
      const finalText = renderAnswer(fallbackAnswer)
      saveTrace('completed', finalText)
      return {
        finalText,
        evidence,
        warnings: fallbackAnswer.warnings,
        traceId,
        clarificationRequired: false,
        usage
      }
    }
    saveTrace(
      isAbortLikeError(error)
        ? 'cancelled'
        : 'failed'
    )
    throw error
  }
}
