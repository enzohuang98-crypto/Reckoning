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
import { MISTAKE_LEVEL_LABELS } from '@shared/types/MoveComparisonResult'
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

interface AnswerRequirements {
  hasUserMove: boolean
  mistakeLabel: string
  requireContinuation: boolean
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
    userMovePrincipalVariation:
      analysis.displayUserMovePrincipalVariation ??
      analysis.userMovePrincipalVariation ??
      [],
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
    if (answer.sections.length < 3) {
      errors.push('回答太簡略，至少需要三個問答段落。')
    }
    if (answer.sections.some((section) => !/^問[：:]/.test(section.heading.trim()))) {
      errors.push('每個段落標題都必須使用「問：」格式。')
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
  if (
    requirements.requireContinuation &&
    !/(後續|接下來|續走|主要變例|怎麼走)/.test(prose)
  ) {
    errors.push('回答缺少後續主線說明。')
  }
  const mistakeKeyword = requirements.mistakeLabel.split(/[／/]/)[0]
  if (
    requirements.hasUserMove &&
    mistakeKeyword &&
    !prose.includes(mistakeKeyword)
  ) {
    errors.push(`回答沒有解釋「${requirements.mistakeLabel}」的判定。`)
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
  evidence: HarnessEvidence[]
): HarnessAnswer {
  const analysis = session.engineAnalysis
  const comparison = session.moveComparison
  const evidenceId = evidence[0]?.id
  const evidenceIds = evidenceId ? [evidenceId] : []
  const label = MISTAKE_LEVEL_LABELS[comparison.mistakeLevel]
  const scoreGap =
    comparison.scoreDifference === null
      ? '目前無法可靠計算評分差'
      : `評分差為 ${comparison.scoreDifference.toFixed(2)}`
  const bestLine = (analysis.displayPrincipalVariation ?? []).slice(0, 8)
  const userLine = (analysis.displayUserMovePrincipalVariation ?? []).slice(0, 8)
  const bestLineText =
    bestLine.length > 0 ? bestLine.join('、') : '引擎沒有提供足夠的中文主線'
  const userLineText =
    userLine.length > 1 ? userLine.join('、') : '引擎沒有提供足夠的使用者著法後續主線'
  const userMove = analysis.displayUserMove ?? '這步'
  const bestMove = analysis.displayBestMove ?? '引擎首選'

  return {
    mode,
    title: '你問我答：著法分析',
    directAnswer: analysis.userMove
      ? `引擎把${userMove}判為「${label}」，直接依據是它與${bestMove}的比較結果：${scoreGap}。這表示它不一定立即輸棋，但比引擎首選少保留了一部分局面價值；真正差異要連同兩條後續主線一起看。`
      : `引擎目前首選${bestMove}。以下依現有評分與主要變例說明原因及後續。`,
    directAnswerEvidenceIds: evidenceIds,
    sections: [
      {
        heading: analysis.userMove
          ? `問：為什麼這步是${label}？`
          : '問：為什麼引擎選這步？',
        claims: [
          {
            id: 'F1',
            text: analysis.userMove
              ? `${userMove}與${bestMove}相比，${scoreGap}；錯誤等級因此顯示為「${label}」。這是引擎評估差距的分類，不代表單看一步名稱就能推定特定戰術。`
              : `引擎把${bestMove}列為目前局面的首選，評估為${analysis.scoreAfterBestMove?.displayText ?? '未提供'}。`,
            evidenceIds
          }
        ]
      },
      {
        heading: '問：最佳著法和我的著法後續差在哪裡？',
        claims: [
          {
            id: 'F2',
            text: `最佳著法主線是：${bestLineText}。`,
            evidenceIds
          },
          {
            id: 'F3',
            text: analysis.userMove
              ? `你的著法後續主線是：${userLineText}。應從兩條線的回應順序比較，而不是只看第一手。`
              : '目前沒有提交使用者著法，因此只能解釋最佳著法主線。',
            evidenceIds
          }
        ]
      },
      {
        heading: '問：走了我的著法後，雙方接下來怎麼走？',
        claims: [
          {
            id: 'F4',
            text:
              userLine.length > 1
                ? `依引擎提供的順序，後續是：${userLineText}。每一手依序代表雙方在前一手之後的最佳回應；目前證據只支持顯示到這條主線的長度。`
                : '目前引擎證據不足，沒有提供可逐手解釋的使用者著法後續主線。',
            evidenceIds
          }
        ]
      },
      {
        heading: '問：下次遇到類似局面要先問自己什麼？',
        claims: [
          {
            id: 'F5',
            text: '先問：我的著法之後，對手最強回應是什麼？再問：和引擎首選相比，兩條後續主線在哪一手開始分歧？最後確認評分差是否足以改變原本計畫。',
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
  const canonicalMove =
    payload.attachedMove ??
    deps.session.userMove ??
    deps.session.engineAnalysis.userMove
  const mistakeLabel =
    MISTAKE_LEVEL_LABELS[deps.session.moveComparison.mistakeLevel]
  const answerRequirements: AnswerRequirements = {
    hasUserMove: Boolean(canonicalMove),
    mistakeLabel,
    requireContinuation: true
  }
  const coachingOutline = canonicalMove
    ? `1. 為什麼使用者著法被判為「${mistakeLabel}」，具體比較最佳著法、分數差與後續主線。
2. 最佳著法和使用者著法的後續有何差別。
3. 走了使用者著法後，雙方接下來怎麼走；依主線逐手解釋，證據有資料時至少涵蓋 4 個半回合。
4. 下次遇到類似局面，使用者應先問自己哪些問題。`
    : `1. 為什麼引擎推薦最佳著法。
2. 最佳著法之後，雙方接下來怎麼走；依主線逐手解釋，證據有資料時至少涵蓋 4 個半回合。
3. 其他候選著法與最佳著法有何評分差異。
4. 下次遇到類似局面，使用者應先問自己哪些問題。`

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
              purpose: `比較使用者著法與最佳著法，確認「${mistakeLabel}」原因及後續主線`
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
回答必須完整而不是只報分數，directAnswer 寫 2 至 4 句，每個問答段落寫 2 至 4 個 claims。
每個 section.heading 必須以「問：」開頭，並依序回答：
${coachingOutline}
不得把沒有出現在引擎主線中的戰術或意圖當成事實。

使用者程度：${payload.userLevel}
問題：${payload.followUpQuestion?.trim() || '完整解釋目前局面'}
模式：${mode}
著法比較：${JSON.stringify({
      bestMove: deps.session.engineAnalysis.displayBestMove,
      userMove: deps.session.engineAnalysis.displayUserMove,
      mistakeLevel: mistakeLabel,
      scoreDifference: deps.session.moveComparison.scoreDifference,
      confidence: deps.session.moveComparison.confidence,
      uncertaintyReasons: deps.session.moveComparison.uncertaintyReasons
    })}
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
  "directAnswer":"直接回答為什麼是這個錯誤等級，以及後續主線的核心差異。",
  "directAnswerEvidenceIds":["E1"],
  "sections":[
    {"heading":"問：為什麼這步是${mistakeLabel}？","claims":[
      {"id":"C1","text":"依分數差和主線作中文解釋。","evidenceIds":["E1"]}
    ]},
    {"heading":"問：走了這步後，雙方接下來怎麼走？","claims":[
      {"id":"C2","text":"依使用者著法後續主線逐手說明。","evidenceIds":["E1"]}
    ]},
    {"heading":"問：下次遇到類似局面要先問自己什麼？","claims":[
      {"id":"C3","text":"根據本局引擎比較整理可操作問題。","evidenceIds":["E1"]}
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
      answer = buildFallbackAnswer(mode, deps.session, evidence)
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
        answer = buildFallbackAnswer(mode, deps.session, evidence)
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
