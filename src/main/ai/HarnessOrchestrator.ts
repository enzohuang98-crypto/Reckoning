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

interface SemanticReview {
  unsupportedClaimIds: string[]
  reasons: string[]
}

type ConsequenceCategory =
  | 'initiative_loss'
  | 'piece_restriction'
  | 'king_safety'
  | 'structure_damage'
  | 'opponent_development'
  | 'material_or_tactical'

interface ConsequenceFinding {
  id: string
  category: ConsequenceCategory
  summary: string
  opponentUse: string
  boardImpact: string
  supportingMoves: string[]
  evidenceIds: string[]
  verified: boolean
}

interface ConsequenceAudit {
  bestMovePurpose: string
  userMoveProblem: string
  consequences: ConsequenceFinding[]
  contradictions: string[]
  enoughEvidence: boolean
}

interface AnswerRequirements {
  hasUserMove: boolean
  requiredHeadings: string[]
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
  }>
}

const PROGRESS_DELAY_MS = 20_000
const PROGRESS_INTERVAL_MS = 5_000
const STAGNATION_MS = 60_000
const MIN_RESEARCH_ROUND_MS = 20_000
const MAX_RESEARCH_ROUND_MS = 60_000
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
    enoughEvidence: raw.enoughEvidence === true
  }
}

function scoreUsedAsReason(text: string): boolean {
  return /(因為|理由|所以|代表).{0,30}(分數|評分|數值).{0,20}(較高|較低|比較高|比較低|領先|落後)/.test(
    text
  )
}

function validateConsequenceAudit(
  audit: ConsequenceAudit,
  evidence: HarnessEvidence[],
  hasUserMove: boolean
): string[] {
  const errors: string[] = []
  const evidenceIds = new Set(evidence.map((item) => item.id))
  const availableMoves = new Set(
    evidence.flatMap((item) => [
      ...item.displayPrincipalVariation,
      ...(item.analysis.displayPrincipalVariation ?? []),
      ...(item.analysis.displayUserMovePrincipalVariation ?? [])
    ])
  )
  if (!audit.bestMovePurpose) errors.push('缺少最佳著法的具體目的。')
  if (hasUserMove && !audit.userMoveProblem) {
    errors.push('缺少使用者著法錯失機會的解釋。')
  }
  const verified = audit.consequences.filter((item) => item.verified)
  if (verified.length < 2) errors.push('至少需要兩項已驗證的具體後果。')
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
    if (consequence.supportingMoves.length === 0) {
      errors.push(`${consequence.id} 沒有指出對應著法。`)
    } else if (
      consequence.supportingMoves.some((move) => !availableMoves.has(move))
    ) {
      errors.push(`${consequence.id} 使用了引擎主線中沒有的著法。`)
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
  return errors
}

function evidenceSignature(evidence: HarnessEvidence[]): string {
  const latestBySource = new Map<string, HarnessEvidence>()
  for (const item of evidence) {
    latestBySource.set(`${item.engineId}:${item.move ?? 'root'}`, item)
  }
  return [...latestBySource.values()]
    .sort((a, b) =>
      `${a.engineId}:${a.move ?? 'root'}`.localeCompare(
        `${b.engineId}:${b.move ?? 'root'}`
      )
    )
    .map((item) =>
      [
        item.engineId,
        item.move ?? 'root',
        item.depth ?? 'none',
        ...item.displayPrincipalVariation.slice(0, 16)
      ].join('|')
    )
    .join('::')
}

function validateAnswer(
  answer: HarnessAnswer,
  evidence: HarnessEvidence[],
  requirements: AnswerRequirements
): string[] {
  const errors: string[] = []
  const evidenceIds = new Set(evidence.map((item) => item.id))
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
  const prose = [
    answer.title,
    answer.directAnswer,
    ...(answer.sections ?? []).map((section) => section.heading),
    ...claims.map((claim) => claim.text)
  ].join(' ')
  if (!/(後續|接下來|續走|主要變例|具體後果)/.test(prose)) {
    errors.push('回答缺少後續主線與具體後果。')
  }
  if (requirements.hasUserMove && !/(錯失|不好|問題|不對)/.test(prose)) {
    errors.push('回答沒有說明使用者著法為什麼不好。')
  }
  if (scoreUsedAsReason(prose)) errors.push('回答以分數高低代替棋理原因。')
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
  const findings = audit?.consequences.filter((item) => item.verified) ?? []
  const firstFinding = findings[0]
  const secondFinding = findings[1]

  return {
    mode,
    title: '你問我答：著法分析',
    directAnswer:
      firstFinding && secondFinding
        ? `${userMove}的主要問題是${audit?.userMoveProblem || firstFinding.summary}。對手可以${firstFinding.opponentUse}，後續又會造成${secondFinding.boardImpact}。`
        : `目前引擎主線還不足以證明${userMove}錯失了哪兩項具體機會，因此不能只用分數高低代替解釋。`,
    directAnswerEvidenceIds: evidenceIds,
    sections: [
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
            evidenceIds
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
            evidenceIds
          }
        ]
      },
      {
        heading: '問：後續主線與具體後果是什麼？',
        claims: [
          {
            id: 'F4',
            text: `最佳著法主線：${bestLineText}。你的著法主線：${userLineText}。${firstFinding?.boardImpact ?? '目前尚未找到足夠證據說明具體盤面後果。'}`,
            evidenceIds
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
            evidenceIds
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
    ],
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
      deps.timing?.maxResearchRoundMs ?? MAX_RESEARCH_ROUND_MS
  }
  const budget = payload.budget ?? {
    engineTimeMs: 10_000,
    maxEngineRounds: 3,
    maxModelCalls: mode === 'research' ? 6 : 4,
    maxOutputTokens: mode === 'research' ? 10_000 : 4_000
  }
  let modelCalls = 0
  let modelCallLimit = budget.maxModelCalls
  let outputTokens = 0
  let engineRounds = 0
  const evidence: HarnessEvidence[] = []
  const validationErrors: string[] = []
  const phases: HarnessTrace['phases'] = []
  let usage: TokenUsage | undefined
  const traceId = randomUUID()
  const primaryEngineId =
    payload.engineId ??
    deps.session.primaryEngineId ??
    deps.registry.list().activeEngineId ??
    'unknown-engine'
  const verificationEngineId =
    payload.verificationEngineId ?? deps.session.verificationEngineId
  const canonicalMove =
    payload.attachedMove ??
    deps.session.userMove ??
    deps.session.engineAnalysis.userMove
  const answerRequirements: AnswerRequirements = {
    hasUserMove: Boolean(canonicalMove),
    requiredHeadings: canonicalMove
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

  const saveTrace = (status: HarnessTrace['status']): void => {
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
      status
    })
  }

  const callModel = async (prompt: string): Promise<string> => {
    if (deps.signal.aborted) {
      throw new DOMException('Request cancelled', 'AbortError')
    }
    if (modelCalls >= modelCallLimit) {
      throw new Error('已達模型呼叫上限。')
    }
    const remainingTokens = Math.max(256, budget.maxOutputTokens - outputTokens)
    modelCalls += 1
    const response = await deps.provider.generateExplanation(
      {
        provider: payload.provider,
        model: deps.model,
        apiKey: deps.apiKey,
        prompt,
        maxOutputTokens: remainingTokens,
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
  }

  const waitForUserContinuation = async (message: string): Promise<void> => {
    progress('waiting_for_user', message, { awaitingDecision: true })
    if (!deps.waitForContinuation) {
      throw new Error('Harness 需要使用者決定是否繼續分析。')
    }
    await deps.waitForContinuation()
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
      saveTrace('clarification_required')
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
    let plan: PlannerResult
    if (!payload.followUpQuestion?.trim()) {
      const task = canonicalMove
        ? validateTask(
            {
              kind: 'evaluate_move',
              move: canonicalMove,
              purpose: '比較最佳著法與使用者著法，追查錯失機會、對手利用方式與具體後果'
            },
            deps.session
          )
        : validateTask(
            { kind: 'root', purpose: '確認目前局面的最佳著法與後續主線' },
            deps.session
          )
      plan = { tasks: task ? [task] : [] }
    } else {
      const plannerText = await callModel(`
你是象棋研究任務規劃器。只輸出 JSON，不要輸出推理過程。
允許的任務只有：
1. {"kind":"root","purpose":"..."}
2. {"kind":"evaluate_move","move":"h2e2","purpose":"..."}
若問題資訊不足，輸出 clarification 並讓 tasks 為空陣列。
所有 move 必須是 UCI 四字元座標；系統會另行驗證合法性。

問題：${payload.followUpQuestion?.trim() || '請完整解釋目前局面與使用者著法'}
附加著法：${canonicalMove ?? '無'}
局面 FEN：${deps.session.positionFen}
現有主引擎摘要：${JSON.stringify(publicAnalysis(deps.session.engineAnalysis))}

輸出格式：
{"clarification":"","tasks":[{"kind":"root","purpose":"確認主線"}]}
`)
      try {
        plan = normalizePlannerResult(
          jsonFromText<PlannerResult>(plannerText),
          deps.session,
          canonicalMove
        )
      } catch {
        plan = normalizePlannerResult(
          { tasks: [{ kind: 'root', purpose: '確認目前局面的主要判斷' }] },
          deps.session,
          canonicalMove
        )
        validationErrors.push('規劃器輸出格式無效，已改用安全的根局面任務。')
      }
    }
    if (plan.clarification && plan.tasks.length === 0) {
      progress('completed', '問題需要補充資訊。')
      saveTrace('clarification_required')
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
      payload.followUpQuestion &&
      payload.reuseEvidence !== true &&
      !plan.tasks.some((task) => task.kind === 'root')
    ) {
      plan.tasks.unshift({
        kind: 'root',
        purpose: '追問前重新確認目前局面的引擎判斷'
      })
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
    if (deps.session.verificationEngineAnalysis) {
      evidence.push(
        makeEvidence(
          `E${evidence.length + 1}`,
          deps.session.verificationEngineAnalysis,
          '初始複核引擎分析'
        )
      )
    }

    const primaryAdapter = deps.registry.getAdapter(primaryEngineId)
    const verificationAdapter = verificationEngineId
      ? deps.registry.getAdapter(verificationEngineId)
      : null
    const researchMove = canonicalMove
    let audit: ConsequenceAudit = {
      bestMovePurpose: '',
      userMoveProblem: '',
      consequences: [],
      contradictions: [],
      enoughEvidence: false
    }
    let auditErrors: string[] = []
    let previousSignature = evidenceSignature(evidence)
    let lastNovelEvidenceAt = Date.now()
    let shouldResearch = primaryAdapter !== null

    while (true) {
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
          const [primary, verification] = await Promise.all([
            primaryAdapter.analyzePosition(
              {
                positionFen: deps.session.positionFen,
                userMove: researchMove
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
            ),
            verificationAdapter
              ? verificationAdapter.analyzePosition(
                  {
                    positionFen: deps.session.positionFen,
                    userMove: researchMove
                  },
                  config,
                  { signal: deps.signal }
                )
              : Promise.resolve(undefined)
          ])
          engineRounds += 1
          latestDepth = primary.depth
          latestVariation =
            primary.displayUserMovePrincipalVariation ??
            primary.displayPrincipalVariation ??
            []
          evidence.push(
            makeEvidence(
              `E${evidence.length + 1}`,
              primary,
              `第 ${engineRounds} 輪加深研究：最佳著法目的、錯失機會、對手利用與盤面後果`,
              researchMove
            )
          )
          if (verification) {
            evidence.push(
              makeEvidence(
                `E${evidence.length + 1}`,
                verification,
                `第 ${engineRounds} 輪交叉驗證具體後果`,
                researchMove
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
        } else if (Date.now() - lastNovelEvidenceAt >= timing.stagnationMs) {
          await waitForUserContinuation(
            '連續 60 秒沒有提升深度或發現新變例。要繼續加深，還是取消本次分析？'
          )
          lastNovelEvidenceAt = Date.now()
        }
        progress(
          'consequence_review',
          `本輪引擎研究完成（${((Date.now() - roundStartedAt) / 1000).toFixed(1)} 秒），正在檢查是否已有兩項具體後果。`
        )
      }

      if (modelCalls >= modelCallLimit - 2) {
        await waitForUserContinuation(
          `AI 品質檢查已使用 ${modelCalls} 次模型呼叫。繼續會產生額外 API 用量；要繼續研究，還是取消？`
        )
        modelCallLimit += budget.maxModelCalls
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
若兩項解釋互相矛盾，放入 contradictions，enoughEvidence 必須是 false。
禁止以「分數較高／較低」作為任何原因；原始分數只供查證。

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
  "enoughEvidence":true
}
`)
          )
        )
        auditErrors = validateConsequenceAudit(
          audit,
          evidence,
          Boolean(canonicalMove)
        )
      } catch {
        auditErrors = ['具體後果審查器沒有輸出有效 JSON。']
      }
      verifiedConsequenceCount = audit.consequences.filter(
        (item) => item.verified
      ).length
      validationErrors.push(...auditErrors)
      if (auditErrors.length === 0) break
      progress(
        'consequence_review',
        `目前只確認 ${verifiedConsequenceCount} 項具體後果，證據仍不足，繼續加深引擎。`
      )
      if (!primaryAdapter) break
      shouldResearch = true
    }

    progress('writing', '正在依引擎證據撰寫中文說明。')
    const writerText = await callModel(`
你是象棋教練。只輸出 JSON，不要輸出推理過程。
你只能使用「已驗證具體後果」與引擎證據，不得自行新增戰術事實。
正文完全禁止使用分數高低、評估差距或可信度作為理由，也不要報告這些數字。
著法只能使用證據中的中文名稱，不得顯示 h2e2 之類座標。

先用 directAnswer 寫一段短結論：這步為什麼不好、錯失什麼、對手如何利用、最後造成什麼。
接著固定依序寫完整六個問答區塊：
1. 問：最佳著法想做什麼？
2. 問：你的著法錯失什麼？
3. 問：對手如何利用？
4. 問：後續主線與具體後果是什麼？
5. 問：兩種著法完整比較後，差別在哪裡？
6. 問：下次遇到類似局面要先問自己什麼？

第四區要按引擎主線順序，盡可能逐手說明每一步目的與盤面影響，一直寫到具體後果出現。
第五區要先說最佳著法的目的，再逐步對照使用者著法錯失什麼、為什麼不好。
每項 claims 都必須引用 supporting evidenceIds。若資料不足，直接說證據不足，不能猜。

使用者程度：${payload.userLevel}
問題：${payload.followUpQuestion?.trim() || '完整解釋目前局面'}
模式：${mode}
已驗證具體後果：${JSON.stringify(audit)}
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
      {"id":"C2","text":"錯失的機會以及為什麼不好。","evidenceIds":["E1"]}
    ]},
    {"heading":"問：對手如何利用？","claims":[
      {"id":"C3","text":"對手的具體利用方式。","evidenceIds":["E1"]}
    ]},
    {"heading":"問：後續主線與具體後果是什麼？","claims":[
      {"id":"C4","text":"逐手解釋主線到具體後果。","evidenceIds":["E1"]}
    ]},
    {"heading":"問：兩種著法完整比較後，差別在哪裡？","claims":[
      {"id":"C5","text":"先說最佳目的，再完整對照使用者著法。","evidenceIds":["E1"]}
    ]},
    {"heading":"問：下次遇到類似局面要先問自己什麼？","claims":[
      {"id":"C6","text":"可操作的思考順序。","evidenceIds":["E1"]}
    ]}
  ],
  "warnings":[]
}
`)
    let answer: HarnessAnswer
    try {
      const parsed = jsonFromText<HarnessAnswer>(writerText)
      answer = {
        mode,
        title: String(parsed.title || '局面分析').slice(0, 100),
        directAnswer: String(parsed.directAnswer || '').slice(0, 4000),
        directAnswerEvidenceIds: Array.isArray(parsed.directAnswerEvidenceIds)
          ? parsed.directAnswerEvidenceIds.map(String).slice(0, 10)
          : [],
        sections: Array.isArray(parsed.sections)
          ? parsed.sections.slice(0, 8).map((section) => ({
              heading: String(section.heading || '分析').slice(0, 100),
              claims: Array.isArray(section.claims)
                ? section.claims.slice(0, 30).map(
                    (claim): HarnessClaim => ({
                      id: String(claim.id || randomUUID()).slice(0, 80),
                      text: String(claim.text || '').slice(0, 2000),
                      evidenceIds: Array.isArray(claim.evidenceIds)
                        ? claim.evidenceIds.map(String).slice(0, 10)
                        : []
                    })
                  )
                : []
            }))
          : [],
        evidence,
        warnings: Array.isArray(parsed.warnings)
          ? parsed.warnings.map(String).slice(0, 10)
          : []
      }
    } catch {
      answer = buildFallbackAnswer(mode, deps.session, evidence, audit)
      validationErrors.push('寫作者輸出不是有效 JSON。')
    }

    progress('validating', '正在檢查每項敘述的證據引用。')
    let deterministicErrors = validateAnswer(
      answer,
      evidence,
      answerRequirements
    )
    validationErrors.push(...deterministicErrors)
    let review: SemanticReview = { unsupportedClaimIds: [], reasons: [] }
    if (modelCalls < modelCallLimit) {
      try {
        review = jsonFromText<SemanticReview>(
          await callModel(`
你是嚴格的象棋證據審查器。只輸出 JSON，不要輸出推理過程。
逐項檢查 directAnswer 與 claims 是否能由 consequence audit 與 evidence 直接支持。
若 directAnswer 不受支持，把 "DIRECT" 放入 unsupportedClaimIds。
任何用分數高低代替棋理原因的敘述都視為不受支持。
不要用你自己的象棋知識補足。
回答：${JSON.stringify({ ...answer, evidence: [] })}
已驗證具體後果：${JSON.stringify(audit)}
證據：${JSON.stringify(
            evidence.map((item) => ({
              id: item.id,
              analysis: publicAnalysis(item.analysis)
            }))
          )}
輸出：{"unsupportedClaimIds":[],"reasons":[]}
`)
        )
        if (!Array.isArray(review.unsupportedClaimIds)) {
          review.unsupportedClaimIds = []
        }
        if (!Array.isArray(review.reasons)) review.reasons = []
        validationErrors.push(...review.reasons.map(String))
      } catch {
        validationErrors.push('語意審查器輸出格式無效。')
      }
    } else {
      answer.warnings.push('已達模型呼叫預算，未執行額外語意審查。')
    }

    const unsupported = new Set(review.unsupportedClaimIds.map(String))
    if (
      (deterministicErrors.length > 0 || unsupported.size > 0) &&
      modelCalls < modelCallLimit
    ) {
      progress('repairing', '正在移除或修正沒有證據支持的敘述。')
      try {
        const repaired = jsonFromText<HarnessAnswer>(
          await callModel(`
只輸出修正後 JSON，不要輸出推理過程。依下列錯誤修正回答：
${JSON.stringify([...deterministicErrors, ...validationErrors])}
禁止新增證據中沒有的棋力判斷；無法支持的 claim 直接刪除。
禁止用分數高低、評估差距或可信度作為原因。
回答必須保留六個固定問答區塊。
原回答：${JSON.stringify({ ...answer, evidence: [] })}
已驗證具體後果：${JSON.stringify(audit)}
可用 evidenceIds：${JSON.stringify(evidence.map((item) => item.id))}
`)
        )
        answer = {
          ...answer,
          title: String(repaired.title || answer.title).slice(0, 100),
          directAnswer: String(
            repaired.directAnswer || answer.directAnswer
          ).slice(0, 4000),
          directAnswerEvidenceIds: Array.isArray(
            repaired.directAnswerEvidenceIds
          )
            ? repaired.directAnswerEvidenceIds.map(String).slice(0, 10)
            : answer.directAnswerEvidenceIds,
          sections: Array.isArray(repaired.sections)
            ? repaired.sections.slice(0, 8).map((section) => ({
                heading: String(section.heading || '問：補充說明').slice(0, 100),
                claims: Array.isArray(section.claims)
                  ? section.claims.slice(0, 30).map(
                      (claim): HarnessClaim => ({
                        id: String(claim.id || randomUUID()).slice(0, 80),
                        text: String(claim.text || '').slice(0, 2000),
                        evidenceIds: Array.isArray(claim.evidenceIds)
                          ? claim.evidenceIds.map(String).slice(0, 10)
                          : []
                      })
                    )
                  : []
              }))
            : [],
          warnings: Array.isArray(repaired.warnings)
            ? repaired.warnings.map(String)
            : answer.warnings,
          evidence
        }
      } catch {
        answer = removeUnsupportedClaims(answer, unsupported)
      }
      deterministicErrors = validateAnswer(
        answer,
        evidence,
        answerRequirements
      )
    }

    if (deterministicErrors.length > 0 || unsupported.size > 0) {
      answer = removeUnsupportedClaims(answer, unsupported)
      const remainingErrors = validateAnswer(
        answer,
        evidence,
        answerRequirements
      )
      if (remainingErrors.length > 0) {
        answer = buildFallbackAnswer(mode, deps.session, evidence, audit)
      }
    }

    progress('completed', '分析與證據驗證完成。')
    saveTrace('completed')
    return {
      finalText: renderAnswer(answer),
      evidence,
      warnings: answer.warnings,
      traceId,
      clarificationRequired: false,
      usage
    }
  } catch (error) {
    saveTrace(
      error instanceof DOMException && error.name === 'AbortError'
        ? 'cancelled'
        : 'failed'
    )
    throw error
  }
}
