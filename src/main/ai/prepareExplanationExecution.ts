import type { ConversationMessage } from '@shared/types/AppData'
import type {
  ExplanationAnswerStrategy,
  ExplanationInteractionKind,
  HarnessAnswerMode,
  HarnessBudget
} from '@shared/types/Harness'
import { EXPLANATION_EXECUTION_SEMANTICS_VERSION } from '@shared/types/Harness'
import type { GenerateExplanationStartPayload } from '@shared/types/ipc'
import type { AnalysisSession } from '../storage/AnalysisSessionStore'

const PREPARED_EXECUTION = Symbol('PreparedExplanationExecution')

/** main 內部的 Harness 參數；不屬於 IPC 契約，只有 main（與測試、驗收工具）可以指定。 */
export interface HarnessRequestOptions {
  answerMode?: HarnessAnswerMode
  budget?: HarnessBudget
  reuseEvidence?: boolean
}

export type ExplanationExecutionRequest = GenerateExplanationStartPayload & HarnessRequestOptions

/**
 * 一般解說使用的固定 Harness 參數（P4-4：取代原本使用者可調的設定頁）。
 * 數值等於移除前設定頁的預設值，讓 v1 回滾路徑的行為不變。
 */
export const FIXED_HARNESS_OPTIONS: Readonly<Required<HarnessRequestOptions>> = Object.freeze({
  answerMode: 'research',
  budget: Object.freeze({
    engineTimeMs: 20_000,
    maxEngineRounds: 3,
    maxModelCalls: 6,
    maxOutputTokens: 10_000
  }),
  reuseEvidence: true
})

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
  readonly reuseEvidence?: boolean
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
  validatedPayload: ExplanationExecutionRequest,
  authoritativeSession: AnalysisSession,
  resolvedModel: string
): PreparedExplanationExecution {
  const session = cloneAndFreeze(authoritativeSession)
  const sourceHistory = cloneAndFreeze(validatedPayload.conversationHistory ?? [])
  const answerMode = validatedPayload.answerMode ?? 'research'
  const attachedMove =
    validatedPayload.attachedMove ??
    authoritativeSession.userMove ??
    authoritativeSession.engineAnalysis.userMove
  const question = validatedPayload.followUpQuestion
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
    answerMode,
    ...(validatedPayload.budget ? { budget: validatedPayload.budget } : {}),
    ...(validatedPayload.engineId ? { engineId: validatedPayload.engineId } : {}),
    ...(validatedPayload.reuseEvidence !== undefined
      ? { reuseEvidence: validatedPayload.reuseEvidence }
      : {}),
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
