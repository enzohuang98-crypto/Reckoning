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
}

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
    userMove: analysis.userMove,
    displayUserMove: analysis.displayUserMove,
    userMoveScore: analysis.scoreAfterUserMove?.displayText ?? null,
    depth: analysis.depth,
    candidates: analysis.candidateMoves.map((candidate) => ({
      move: candidate.move,
      displayMove: candidate.displayMove,
      score: candidate.score?.displayText ?? null,
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
      analysis.displayPrincipalVariation ?? analysis.principalVariation,
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

function validateAnswer(
  answer: HarnessAnswer,
  evidence: HarnessEvidence[]
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
  if (!Array.isArray(answer.sections)) errors.push('回答段落格式錯誤。')
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
    ...claims.map((claim) => claim.text)
  ].join(' ')
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

function renderAnswer(answer: HarnessAnswer): string {
  const lines = [
    `## ${answer.title}`,
    '',
    `${answer.directAnswer} ${answer.directAnswerEvidenceIds
      .map((id) => `[${id}]`)
      .join(' ')}`
  ]
  for (const section of answer.sections) {
    lines.push('', `### ${section.heading}`)
    for (const claim of section.claims) {
      lines.push(
        `- ${claim.text} ${claim.evidenceIds.map((id) => `[${id}]`).join(' ')}`
      )
    }
  }
  if (answer.warnings.length > 0) {
    lines.push('', '### 注意', ...answer.warnings.map((warning) => `- ${warning}`))
  }
  return lines.join('\n')
}

export async function runExplanationHarness(
  payload: GenerateExplanationStartPayload,
  deps: HarnessDependencies
): Promise<HarnessRunResult> {
  const mode = payload.answerMode ?? 'research'
  const budget = payload.budget ?? {
    engineTimeMs: 10_000,
    maxEngineRounds: 3,
    maxModelCalls: mode === 'research' ? 6 : 4,
    maxOutputTokens: mode === 'research' ? 10_000 : 4_000
  }
  let modelCalls = 0
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

  const progress = (phase: HarnessPhase, message: string): void => {
    phases.push({ phase, at: new Date().toISOString(), message })
    deps.onProgress({
      phase,
      message,
      modelCallsUsed: modelCalls,
      engineRoundsUsed: engineRounds,
      evidenceCount: evidence.length
    })
  }

  const saveTrace = (status: HarnessTrace['status']): void => {
    deps.traceStore.save({
      id: traceId,
      createdAt: new Date().toISOString(),
      positionFen: deps.session.positionFen,
      question: payload.followUpQuestion,
      attachedMove: payload.attachedMove,
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
    if (modelCalls >= budget.maxModelCalls) {
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

  try {
    progress('understanding', '正在理解問題與局面。')
    if (isAmbiguousQuestion(payload.followUpQuestion, payload.attachedMove)) {
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
    const plannerText = await callModel(`
你是象棋研究任務規劃器。只輸出 JSON，不要輸出推理過程。
允許的任務只有：
1. {"kind":"root","purpose":"..."}
2. {"kind":"evaluate_move","move":"h2e2","purpose":"..."}
若問題資訊不足，輸出 clarification 並讓 tasks 為空陣列。
所有 move 必須是 UCI 四字元座標；系統會另行驗證合法性。

問題：${payload.followUpQuestion?.trim() || '請完整解釋目前局面與使用者著法'}
附加著法：${payload.attachedMove ?? '無'}
局面 FEN：${deps.session.positionFen}
現有主引擎摘要：${JSON.stringify(publicAnalysis(deps.session.engineAnalysis))}

輸出格式：
{"clarification":"","tasks":[{"kind":"root","purpose":"確認主線"}]}
`)
    let plan: PlannerResult
    try {
      plan = normalizePlannerResult(
        jsonFromText<PlannerResult>(plannerText),
        deps.session,
        payload.attachedMove
      )
    } catch {
      plan = normalizePlannerResult(
        { tasks: [{ kind: 'root', purpose: '確認目前局面的主要判斷' }] },
        deps.session,
        payload.attachedMove
      )
      validationErrors.push('規劃器輸出格式無效，已改用安全的根局面任務。')
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
    const uniqueTasks = plan.tasks
      .filter(
        (task, index, tasks) =>
          tasks.findIndex(
            (candidate) =>
              candidate.kind === task.kind && candidate.move === task.move
          ) === index
      )
      .slice(0, budget.maxEngineRounds)

    for (const task of uniqueTasks) {
      if (!primaryAdapter || engineRounds >= budget.maxEngineRounds) break
      progress(
        verificationAdapter ? 'cross_verification' : 'engine_research',
        `正在由引擎驗證「${task.purpose}」。`
      )
      const config = {
        rootAnalysisMovetimeMs: budget.engineTimeMs,
        userMoveEvalMovetimeMs: budget.engineTimeMs,
        multiPv: mode === 'research' ? 3 : 1
      }
      const [primary, verification] = await Promise.all([
        primaryAdapter.analyzePosition(
          {
            positionFen: deps.session.positionFen,
            userMove: task.kind === 'evaluate_move' ? task.move : undefined
          },
          config,
          { signal: deps.signal }
        ),
        verificationAdapter
          ? verificationAdapter.analyzePosition(
              {
                positionFen: deps.session.positionFen,
                userMove: task.kind === 'evaluate_move' ? task.move : undefined
              },
              config,
              { signal: deps.signal }
            )
          : Promise.resolve(undefined)
      ])
      engineRounds += 1
      evidence.push(
        makeEvidence(
          `E${evidence.length + 1}`,
          primary,
          task.purpose,
          task.kind === 'evaluate_move' ? task.move : undefined
        )
      )
      if (verification) {
        evidence.push(
          makeEvidence(
            `E${evidence.length + 1}`,
            verification,
            `${task.purpose}（複核）`,
            task.kind === 'evaluate_move' ? task.move : undefined
          )
        )
      }
    }

    progress('writing', '正在依引擎證據撰寫中文說明。')
    const writerText = await callModel(`
你是象棋教練，但只能重述下方引擎證據，不能加入自己的棋力判斷。
只輸出 JSON，不要輸出推理過程。所有具體棋力主張都必須放在 claims，
且 evidenceIds 至少引用一個存在的證據。著法必須使用證據中的中文 displayMove，
不得在中文正文顯示 h2e2 之類座標。若證據不足，明確說「目前引擎證據不足」。

使用者程度：${payload.userLevel}
問題：${payload.followUpQuestion?.trim() || '完整解釋目前局面'}
模式：${mode}
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
  "title":"局面分析",
  "directAnswer":"一句直接回答",
  "directAnswerEvidenceIds":["E1"],
  "sections":[
    {"heading":"關鍵判斷","claims":[
      {"id":"C1","text":"中文敘述","evidenceIds":["E1"]}
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
      answer = {
        mode,
        title: '局面分析',
        directAnswer: '目前模型未能產生可驗證的結構化解說。',
        directAnswerEvidenceIds: [],
        sections: [],
        evidence,
        warnings: ['模型輸出格式無效，已停止顯示未驗證內容。']
      }
      validationErrors.push('寫作者輸出不是有效 JSON。')
    }

    progress('validating', '正在檢查每項敘述的證據引用。')
    let deterministicErrors = validateAnswer(answer, evidence)
    validationErrors.push(...deterministicErrors)
    let review: SemanticReview = { unsupportedClaimIds: [], reasons: [] }
    if (modelCalls < budget.maxModelCalls) {
      try {
        review = jsonFromText<SemanticReview>(
          await callModel(`
你是嚴格的象棋證據審查器。只輸出 JSON，不要輸出推理過程。
逐項檢查 directAnswer 與 claims 是否能由 evidence 直接支持。
若 directAnswer 不受支持，把 "DIRECT" 放入 unsupportedClaimIds。
不要用你自己的象棋知識補足。
回答：${JSON.stringify({ ...answer, evidence: [] })}
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
      modelCalls < budget.maxModelCalls
    ) {
      progress('repairing', '正在移除或修正沒有證據支持的敘述。')
      try {
        const repaired = jsonFromText<HarnessAnswer>(
          await callModel(`
只輸出修正後 JSON，不要輸出推理過程。依下列錯誤修正回答：
${JSON.stringify([...deterministicErrors, ...validationErrors])}
禁止新增證據中沒有的棋力判斷；無法支持的 claim 直接刪除。
原回答：${JSON.stringify({ ...answer, evidence: [] })}
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
          sections: Array.isArray(repaired.sections) ? repaired.sections : [],
          warnings: Array.isArray(repaired.warnings)
            ? repaired.warnings.map(String)
            : answer.warnings,
          evidence
        }
      } catch {
        answer = removeUnsupportedClaims(answer, unsupported)
      }
      deterministicErrors = validateAnswer(answer, evidence)
    }

    if (deterministicErrors.length > 0 || unsupported.size > 0) {
      answer = removeUnsupportedClaims(answer, unsupported)
      const remainingErrors = validateAnswer(answer, evidence)
      if (remainingErrors.length > 0) {
        answer = {
          mode,
          title: '局面分析',
          directAnswer: '目前引擎證據不足，無法產生通過驗證的完整說明。',
          directAnswerEvidenceIds: [],
          sections: [],
          evidence,
          warnings: ['未通過證據驗證的敘述已隱藏。']
        }
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
