import type { ConversationMessage } from '@shared/types/AppData'
import type {
  ExplanationAnswerStrategy,
  ExplanationInteractionKind,
  HarnessAnswerMode
} from '@shared/types/Harness'
import { EXPLANATION_EXECUTION_SEMANTICS_VERSION } from '@shared/types/Harness'
import type { GenerateExplanationStartPayload } from '@shared/types/ipc'
import { parseFen } from '@shared/logic/board/fen'
import { findQuestionMove } from '@shared/logic/ai/questionMove'
import type { AnalysisSession } from '../storage/AnalysisSessionStore'

const PREPARED_EXECUTION = Symbol('PreparedExplanationExecution')

/**
 * 診斷紀錄（HarnessTrace.mode）沿用的答題模式。v1 Harness 刪除後（P4-1）只剩這一種，
 * 保留欄位讓新舊診斷紀錄格式一致。
 */
const ANSWER_MODE: HarnessAnswerMode = 'research'

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
  readonly engineId?: string
  readonly session: Readonly<AnalysisSession>
}

export type PreparedExplanationExecution = Readonly<{
  readonly [PREPARED_EXECUTION]: true
  interactionKind: ExplanationInteractionKind
  answerStrategy: ExplanationAnswerStrategy
  effective: Readonly<EffectiveExplanationInput>
  executionSemanticsVersion: typeof EXPLANATION_EXECUTION_SEMANTICS_VERSION
}>

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
  const focusedQuestion = question?.trim() ?? ''
  const asksOverview =
    /完整|全面|整體|整体|full|complete|overview|^(?:請|请)?(?:解釋|解释|分析|講解|讲解)(?:一下)?(?:目前|當前|当前|這個|这个)?局面[。.!！]?$|^(?:please )?(?:explain|analy[sz]e) (?:the )?(?:current )?position[.!]?$/i.test(
      focusedQuestion
    )
  // 棋手直接打字的問題就該直接回答那一題；只有明確要求「完整解說」時才走完整比較。
  if (focusedQuestion && (history.length > 0 || !asksOverview)) {
    return 'conversation-follow-up'
  }
  return attachedMove ? 'move-comparison' : 'position-explanation'
}

export function prepareExplanationExecution(
  validatedPayload: GenerateExplanationStartPayload,
  authoritativeSession: AnalysisSession,
  resolvedModel: string
): PreparedExplanationExecution {
  const session = cloneAndFreeze(authoritativeSession)
  const sourceHistory = cloneAndFreeze(validatedPayload.conversationHistory ?? [])
  const question = validatedPayload.followUpQuestion
  // 棋手在問題裡直接寫了一步（「為什麼要走炮二平五？」）：分析問題裡的那一步。
  // 問的就是那一步，所以優先於「你的走法」或棋譜上選到的著法；問題沒寫著法時照舊。
  const parsedPosition = question ? parseFen(authoritativeSession.positionFen) : null
  const questionMove =
    question && parsedPosition?.valid ? findQuestionMove(parsedPosition.board, question) : undefined
  const attachedMove =
    questionMove ??
    validatedPayload.attachedMove ??
    authoritativeSession.userMove ??
    authoritativeSession.engineAnalysis.userMove
  const answerStrategy = ordinaryStrategy(question, sourceHistory, attachedMove)

  const effective = cloneAndFreeze({
    requestId: validatedPayload.requestId,
    analysisId: validatedPayload.analysisId,
    provider: validatedPayload.provider,
    model: resolvedModel,
    ...(validatedPayload.baseUrl ? { baseUrl: validatedPayload.baseUrl } : {}),
    userLevel: validatedPayload.userLevel,
    explanationStyle: validatedPayload.explanationStyle,
    language: validatedPayload.language,
    conversationHistory: sourceHistory,
    ...(question ? { followUpQuestion: question } : {}),
    ...(attachedMove ? { attachedMove } : {}),
    ...(validatedPayload.userMoveReason
      ? { userMoveReason: validatedPayload.userMoveReason }
      : {}),
    answerMode: ANSWER_MODE,
    ...(validatedPayload.engineId ? { engineId: validatedPayload.engineId } : {}),
    session
  }) satisfies Readonly<EffectiveExplanationInput>

  return freezeDeep({
    [PREPARED_EXECUTION]: true as const,
    interactionKind: 'ordinary' as const,
    answerStrategy,
    effective,
    executionSemanticsVersion: EXPLANATION_EXECUTION_SEMANTICS_VERSION
  })
}
