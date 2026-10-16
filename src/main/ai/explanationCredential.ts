/**
 * 解說請求的憑證解析（v1、v2 共用）與 v1 的 AIExplanationRequest 組裝（§2.17.9）。
 * resolveExplanationCredential() 是唯一把 API key 帶進解說流程的入口；金鑰只在 main 內使用，不得 log。
 */

import type { AIProviderId } from '@shared/types/AIProviderTypes'
import type { AIExplanationRequest } from '@shared/types/AIExplanationTypes'
import type { SecretStore } from '../storage/SecretStore'
import { isLoopbackAiBaseUrl } from '../security/InputValidation'
import type { PreparedExplanationExecution } from './prepareExplanationExecution'
import { buildExplanationPrompt } from './promptBuilder'

/** API key 缺失（§2.17.9：不得用空字串或 placeholder 繼續呼叫） */
export class MissingApiKeyError extends Error {
  constructor(
    public readonly provider: AIProviderId,
    public readonly model: string,
    /** 檔案裡有金鑰但解密失敗（needsReentry），與「從未設定」區分開來 */
    public readonly needsReentry = false
  ) {
    super(`Missing API key for credential: ${provider}/${model}`)
    this.name = 'MissingApiKeyError'
  }
}

export class ProviderEndpointMismatchError extends Error {
  constructor() {
    super('OpenAI-compatible endpoint does not match the endpoint bound to the stored API key.')
    this.name = 'ProviderEndpointMismatchError'
  }
}

export function assertProviderEndpointBinding(
  provider: AIProviderId,
  requestedBaseUrl: string | undefined,
  apiKey: string,
  boundBaseUrl: string | null
): void {
  if (
    provider === 'openai-compatible' &&
    apiKey &&
    (!requestedBaseUrl || requestedBaseUrl !== boundBaseUrl)
  ) {
    throw new ProviderEndpointMismatchError()
  }
}

/**
 * buildAIExplanationRequest（§2.17.9）：
 * SecretStore、PromptBuilder、ModelRegistry、AnalysisSessionStore 的集中銜接點。
 * IPC handler 不得自己組 prompt 或讀 API key。
 */
export interface ResolvedExplanationCredential {
  provider: AIProviderId
  model: string
  apiKey: string
  baseUrl?: string
}

/**
 * 憑證解析（v1、v2 共用）：取出與這次請求相符的已存金鑰，並守住相容服務網址綁定。
 * 金鑰只在 main 內使用，不得 log。
 */
export async function resolveExplanationCredential(
  execution: PreparedExplanationExecution,
  deps: {
    secretStore: SecretStore
    credentialSnapshot?: Awaited<ReturnType<SecretStore['captureActiveCredential']>>
  }
): Promise<ResolvedExplanationCredential> {
  const payload = execution.effective
  const snapshot = deps.credentialSnapshot
  const snapshotMatches = Boolean(
    snapshot &&
      snapshot.credential.provider === payload.provider &&
      snapshot.credential.model === payload.model &&
      (snapshot.credential.baseUrl ?? '') === (payload.baseUrl ?? '')
  )
  const captured = snapshotMatches
    ? { apiKey: snapshot!.apiKey, exists: true }
    : await deps.secretStore.captureCredential(
        payload.provider,
        payload.model,
        payload.baseUrl
      )
  const apiKey = captured.apiKey ?? ''
  const hasExactCredential = captured.exists
  if (!apiKey && (
    hasExactCredential ||
    payload.provider !== 'openai-compatible' ||
    !isLoopbackAiBaseUrl(payload.baseUrl)
  )) {
    throw new MissingApiKeyError(
      payload.provider,
      payload.model,
      hasExactCredential
    )
  }
  assertProviderEndpointBinding(
    payload.provider,
    payload.baseUrl,
    apiKey,
    hasExactCredential ? payload.baseUrl ?? null : null
  )
  return {
    provider: payload.provider,
    model: payload.model,
    apiKey,
    ...(payload.baseUrl ? { baseUrl: payload.baseUrl } : {})
  }
}

/**
 * buildAIExplanationRequest（§2.17.9，v1 Harness 用）：憑證解析＋PromptBuilder 長文 prompt。
 * v2 管線只用 resolveExplanationCredential，prompt 由 explain/promptV2 組裝。
 */
export async function buildAIExplanationRequest(
  execution: PreparedExplanationExecution,
  deps: {
    secretStore: SecretStore
    credentialSnapshot?: Awaited<ReturnType<SecretStore['captureActiveCredential']>>
  }
): Promise<AIExplanationRequest> {
  const payload = execution.effective
  const { apiKey } = await resolveExplanationCredential(execution, deps)
  const session = payload.session
  const prompt = buildExplanationPrompt({
    engineAnalysis: session.engineAnalysis,
    moveComparison: session.moveComparison,
    userLevel: payload.userLevel,
    explanationStyle: payload.explanationStyle,
    language: payload.language,
    conversationHistory: payload.conversationHistory,
    followUpQuestion: payload.followUpQuestion
  })
  return {
    provider: payload.provider,
    model: payload.model,
    apiKey,
    baseUrl: payload.baseUrl,
    prompt,
    metadata: {
      requestId: payload.requestId,
      analysisId: payload.analysisId,
      userLevel: payload.userLevel,
      explanationStyle: payload.explanationStyle
    }
  }
}
