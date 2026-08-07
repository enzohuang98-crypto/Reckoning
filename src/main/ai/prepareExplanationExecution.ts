import type { ConversationMessage } from '@shared/types/AppData'
import type {
  ExplanationAnswerStrategy,
  ExplanationInteractionKind,
  HarnessAnswerMode,
  HarnessBudget,
  HarnessEvaluationLinkV1,
  TeacherTestCaseIdentityV1,
  TeacherTestRunManifestV1
} from '@shared/types/Harness'
import { EXPLANATION_EXECUTION_SEMANTICS_VERSION } from '@shared/types/Harness'
import type { GenerateExplanationStartPayload } from '@shared/types/ipc'
import { normalizeTeacherTestQuestion } from '@shared/logic/teacherTestEvaluation'
import type { AnalysisSession } from '../storage/AnalysisSessionStore'
import {
  findFrozenTeacherTestCase,
  TEACHER_CASE_SET_ID,
  TEACHER_CASE_SET_STATUS,
  TeacherTestCatalogError
} from '../teacherTest/TeacherTestCatalog'

const PREPARED_EXECUTION = Symbol('PreparedExplanationExecution')

interface TeacherRunEvaluationCapability {
  getActiveManifest(): TeacherTestRunManifestV1 | null
  createEvaluationLink(
    input: TeacherTestCaseIdentityV1
  ): HarnessEvaluationLinkV1 | undefined
}

export interface EffectiveExplanationInput {
  readonly requestId: string
  readonly analysisId: string
  readonly provider: GenerateExplanationStartPayload['provider']
  readonly model: string
  readonly baseUrl?: string
  readonly userLevel: GenerateExplanationStartPayload['userLevel']
  readonly explanationStyle: GenerateExplanationStartPayload['explanationStyle']
  readonly language: GenerateExplanationStartPayload['language']
  readonly conversationHistory: readonly ConversationMessage[]
  readonly followUpQuestion?: string
  readonly attachedMove?: string
  readonly userMoveReason?: string
  readonly answerMode: HarnessAnswerMode
  readonly budget?: Readonly<HarnessBudget>
  readonly engineId?: string
  readonly verificationEngineId?: string
  readonly reuseEvidence?: boolean
  readonly session: Readonly<AnalysisSession>
}

export type PreparedExplanationExecution = Readonly<{
  readonly [PREPARED_EXECUTION]: true
  interactionKind: ExplanationInteractionKind
  answerStrategy: ExplanationAnswerStrategy
  effective: Readonly<EffectiveExplanationInput>
  evaluation?: Readonly<HarnessEvaluationLinkV1>
  teacherCase?: Readonly<{
    caseSetId: typeof TEACHER_CASE_SET_ID
    caseSetStatus: typeof TEACHER_CASE_SET_STATUS
    caseKey: string
  }>
  formalAttemptKey?: string
  executionSemanticsVersion: typeof EXPLANATION_EXECUTION_SEMANTICS_VERSION
}>

export class TeacherCaseRejectedError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'TeacherCaseRejectedError'
  }
}

export class TeacherCaseBusyError extends Error {
  constructor() {
    super('同一個老師凍結案例正在執行，請等待完成後再重試。')
    this.name = 'TeacherCaseBusyError'
  }
}

function cloneAndFreeze<T>(value: T): T {
  const cloned = structuredClone(value)
  freezeDeep(cloned)
  return cloned
}

function freezeDeep<T>(value: T): T {
  const freeze = (item: unknown): void => {
    if (typeof item !== 'object' || item === null || Object.isFrozen(item)) return
    for (const nested of Object.values(item)) freeze(nested)
    Object.freeze(item)
  }
  freeze(value)
  return value
}

function ordinaryStrategy(
  question: string | undefined,
  history: readonly ConversationMessage[],
  attachedMove: string | undefined
): ExplanationAnswerStrategy {
  if (question && history.length > 0) return 'conversation-follow-up'
  return attachedMove ? 'move-comparison' : 'position-explanation'
}

function assertFormalSessionMatches(
  session: AnalysisSession,
  positionFen: string,
  attachedMove: string
): void {
  const fenValues = [
    session.positionFen,
    session.engineAnalysis.positionFen,
    session.moveComparison.positionFen,
    session.verificationEngineAnalysis?.positionFen
  ].filter((value): value is string => value !== undefined)
  const moveValues = [
    session.userMove,
    session.engineAnalysis.userMove,
    session.moveComparison.userMove,
    session.verificationEngineAnalysis?.userMove
  ].filter((value): value is string => value !== undefined)
  if (
    fenValues.length < 3 ||
    fenValues.some((value) => value !== positionFen) ||
    moveValues.length < 3 ||
    moveValues.some((value) => value !== attachedMove)
  ) {
    throw new TeacherCaseRejectedError(
      '凍結案例與目前引擎分析資料不一致，請重新載入案例並重新分析。'
    )
  }
}

export function prepareExplanationExecution(
  validatedPayload: GenerateExplanationStartPayload,
  authoritativeSession: AnalysisSession,
  resolvedModel: string,
  teacherRun: TeacherRunEvaluationCapability
): PreparedExplanationExecution {
  const session = cloneAndFreeze(authoritativeSession)
  const sourceHistory = cloneAndFreeze(validatedPayload.conversationHistory ?? [])
  const answerMode = validatedPayload.answerMode ?? 'research'
  const attachedMove =
    validatedPayload.attachedMove ??
    authoritativeSession.userMove ??
    authoritativeSession.engineAnalysis.userMove
  const activeManifest = teacherRun.getActiveManifest()
  const rawQuestion = validatedPayload.followUpQuestion

  let interactionKind: ExplanationInteractionKind = 'ordinary'
  let answerStrategy = ordinaryStrategy(rawQuestion, sourceHistory, attachedMove)
  let conversationHistory: readonly ConversationMessage[] = sourceHistory
  let effectiveQuestion = rawQuestion
  let evaluation: HarnessEvaluationLinkV1 | undefined
  let teacherCase: PreparedExplanationExecution['teacherCase']
  let formalAttemptKey: string | undefined

  if (activeManifest && !rawQuestion) {
    interactionKind = 'teacher-prelude'
  } else if (activeManifest && rawQuestion) {
    effectiveQuestion = normalizeTeacherTestQuestion(rawQuestion)
    if (!validatedPayload.attachedMove) {
      throw new TeacherCaseRejectedError('老師正式案例缺少凍結著法，請重新載入案例。')
    }
    let frozenCase
    try {
      frozenCase = findFrozenTeacherTestCase({
        positionFen: authoritativeSession.positionFen,
        question: effectiveQuestion,
        attachedMove: validatedPayload.attachedMove,
        mode: answerMode
      })
    } catch (error) {
      if (error instanceof TeacherTestCatalogError) {
        throw new TeacherCaseRejectedError(error.message)
      }
      throw error
    }
    if (!frozenCase) {
      throw new TeacherCaseRejectedError('問題、局面、著法或模式未命中凍結題目，正式案例已阻止。')
    }
    assertFormalSessionMatches(
      authoritativeSession,
      frozenCase.positionFen,
      frozenCase.attachedMove
    )
    evaluation = teacherRun.createEvaluationLink({
      positionFen: frozenCase.positionFen,
      question: effectiveQuestion,
      attachedMove: frozenCase.attachedMove,
      mode: frozenCase.mode
    })
    if (!evaluation) {
      throw new TeacherCaseRejectedError('老師實測 run 已結束，正式案例未執行。')
    }
    interactionKind = 'teacher-formal-case'
    answerStrategy = 'formal-move-comparison'
    conversationHistory = cloneAndFreeze([] as ConversationMessage[])
    teacherCase = cloneAndFreeze({
      caseSetId: TEACHER_CASE_SET_ID,
      caseSetStatus: TEACHER_CASE_SET_STATUS,
      caseKey: frozenCase.caseKey
    })
    formalAttemptKey = `${evaluation.testRunId}:${evaluation.testCaseId}`
  }

  const effective = cloneAndFreeze({
    requestId: validatedPayload.requestId,
    analysisId: validatedPayload.analysisId,
    provider: validatedPayload.provider,
    model: resolvedModel,
    ...(validatedPayload.baseUrl ? { baseUrl: validatedPayload.baseUrl } : {}),
    userLevel: validatedPayload.userLevel,
    explanationStyle: validatedPayload.explanationStyle,
    language: validatedPayload.language,
    conversationHistory,
    ...(effectiveQuestion ? { followUpQuestion: effectiveQuestion } : {}),
    ...(attachedMove ? { attachedMove } : {}),
    ...(validatedPayload.userMoveReason
      ? { userMoveReason: validatedPayload.userMoveReason }
      : {}),
    answerMode,
    ...(validatedPayload.budget ? { budget: validatedPayload.budget } : {}),
    ...(validatedPayload.engineId ? { engineId: validatedPayload.engineId } : {}),
    ...(validatedPayload.verificationEngineId
      ? { verificationEngineId: validatedPayload.verificationEngineId }
      : {}),
    ...(validatedPayload.reuseEvidence !== undefined
      ? { reuseEvidence: validatedPayload.reuseEvidence }
      : {}),
    session
  }) satisfies Readonly<EffectiveExplanationInput>

  return freezeDeep({
    [PREPARED_EXECUTION]: true as const,
    interactionKind,
    answerStrategy,
    effective,
    ...(evaluation ? { evaluation } : {}),
    ...(teacherCase ? { teacherCase } : {}),
    ...(formalAttemptKey ? { formalAttemptKey } : {}),
    executionSemanticsVersion: EXPLANATION_EXECUTION_SEMANTICS_VERSION
  })
}
