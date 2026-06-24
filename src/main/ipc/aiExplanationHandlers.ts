/**
 * AI 解釋 IPC 處理器 (aiExplanationHandlers) — SDS v0.2 §2.17
 *
 * Streaming 通道（§2.17.2）：
 *   ai:generate-explanation:start  (renderer→main)
 *   ai:generate-explanation:chunk  (main→renderer，逐段文字)
 *   ai:generate-explanation:done   (main→renderer，finalText + usage)
 *   ai:generate-explanation:error  (main→renderer)
 *   ai:generate-explanation:cancel (renderer→main)
 *
 * 規則（§2.17.10）：
 *  - buildAIExplanationRequest() 是唯一組裝 prompt 與注入 API key 的入口。
 *  - abort 檢查放在 chunk 處理之後；done 分支先設 completedNormally=true 再 reply 並 break。
 *  - catch 僅在 !completedNormally 時送 error；finally 清除 activeExplanationRequests。
 *  - cancel 必須實際呼叫 controller.abort()。
 *
 * 金鑰流向：renderer 只負責 set/has/delete；解密與使用只在 main 內進行，
 * API key 不得被 log（§2.11）。
 */

import { dialog, ipcMain } from 'electron'
import {
  IPC,
  type GenerateExplanationErrorPayload,
  type GenerateExplanationStartPayload
} from '@shared/types/ipc'
import type { AIProviderId } from '@shared/types/AIProviderTypes'
import type { AIExplanationRequest } from '@shared/types/AIExplanationTypes'
import { SecretStore } from '../storage/SecretStore'
import {
  AnalysisSessionNotFoundError,
  type AnalysisSessionStore
} from '../storage/AnalysisSessionStore'
import { getAIProvider } from '../ai/AIProvider'
import { runExplanationHarness } from '../ai/HarnessOrchestrator'
import { buildExplanationPrompt } from '../ai/promptBuilder'
import { modelRegistry, UnsupportedModelError } from '../ai/ModelRegistry'
import { logger } from '../Logger'
import { assertTrustedIpcSender } from '../security/IpcSecurity'
import {
  MAX_AI_RESPONSE_CHARS,
  normalizeApiKey,
  safeRequestId,
  SecurityValidationError,
  validateGenerateExplanationPayload
} from '../security/InputValidation'
import type { EngineRegistryService } from '../engine/EngineRegistryService'
import type { StorageService } from '../storage/StorageService'
import { HarnessTraceStore } from '../storage/HarnessTraceStore'

/** API key 缺失（§2.17.9：不得用空字串或 placeholder 繼續呼叫） */
export class MissingApiKeyError extends Error {
  constructor(public readonly provider: AIProviderId) {
    super(`Missing API key for provider: ${provider}`)
    this.name = 'MissingApiKeyError'
  }
}

/**
 * buildAIExplanationRequest（§2.17.9）：
 * SecretStore、PromptBuilder、ModelRegistry、AnalysisSessionStore 的集中銜接點。
 * IPC handler 不得自己組 prompt 或讀 API key。
 */
export async function buildAIExplanationRequest(
  payload: GenerateExplanationStartPayload,
  deps: {
    secretStore: SecretStore
    analysisSessionStore: AnalysisSessionStore
  }
): Promise<AIExplanationRequest> {
  // 不存在則丟 UnsupportedModelError（§2.19.1）
  const modelConfig = modelRegistry.getModel(payload.provider, payload.model)
  const apiKey = deps.secretStore.getApiKey(payload.provider)
  if (!apiKey) throw new MissingApiKeyError(payload.provider)
  const session = await deps.analysisSessionStore.get(payload.analysisId)
  if (!session) throw new AnalysisSessionNotFoundError(payload.analysisId)
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
    model: modelConfig.model,
    apiKey,
    prompt,
    metadata: {
      requestId: payload.requestId,
      analysisId: payload.analysisId,
      userLevel: payload.userLevel,
      explanationStyle: payload.explanationStyle
    }
  }
}

/** 錯誤分類（§2.17.6）。訊息不得含 API key。 */
export function mapStreamingErrorToPayload(
  requestId: string,
  error: unknown
): GenerateExplanationErrorPayload {
  if (error instanceof DOMException && error.name === 'AbortError') {
    return { requestId, code: 'cancelled', message: '已取消生成。' }
  }
  if (error instanceof MissingApiKeyError) {
    return {
      requestId,
      code: 'missing_api_key',
      message: `尚未設定 ${error.provider} 的 API 金鑰，請至設定頁輸入。`
    }
  }
  if (error instanceof UnsupportedModelError) {
    return {
      requestId,
      code: 'unsupported_model',
      message: `不支援的模型：${error.provider}/${error.model}。請至設定頁選擇有效模型。`
    }
  }
  if (error instanceof AnalysisSessionNotFoundError) {
    return {
      requestId,
      code: 'analysis_session_not_found',
      message: '這次分析結果已過期，請重新分析局面後再生成 AI 解釋。'
    }
  }
  if (error instanceof SecurityValidationError) {
    return {
      requestId,
      code: 'invalid_request',
      message: error.message
    }
  }
  if (error instanceof Error) {
    // Anthropic SDK 取消時丟 APIUserAbortError（非 DOMException）
    if (error.name === 'APIUserAbortError' || error.name === 'AbortError') {
      return { requestId, code: 'cancelled', message: '已取消生成。' }
    }
    const status = (error as { status?: unknown }).status
    if (status === 429 || /\(429\)/.test(error.message)) {
      return {
        requestId,
        code: 'rate_limited',
        message: '模型呼叫被限流 (rate limit)，請稍後重試。'
      }
    }
    // fetch 網路層失敗（DNS/連線中斷）為 TypeError；SDK 為 APIConnectionError
    if (error.name === 'APIConnectionError' || error instanceof TypeError) {
      return {
        requestId,
        code: 'network_error',
        message: '網路連線失敗，請檢查網路後重試。'
      }
    }
    if (typeof status === 'number' || /API 錯誤/.test(error.message)) {
      return {
        requestId,
        code: 'provider_error',
        message: 'AI 服務回報錯誤，請檢查模型與金鑰設定後重試。'
      }
    }
    return {
      requestId,
      code: 'unknown_error',
      message: 'AI 解釋生成發生錯誤。'
    }
  }
  return {
    requestId,
    code: 'unknown_error',
    message: 'AI 解釋生成發生未知錯誤。'
  }
}

export function registerAiExplanationHandlers(
  secretStore: SecretStore,
  sessionStore: AnalysisSessionStore,
  engineRegistry: EngineRegistryService,
  storage: StorageService
): void {
  const traceStore = new HarnessTraceStore(storage)
  // ---- SecretStore 通道 ----
  ipcMain.handle(IPC.SECRET_IS_AVAILABLE, (event): boolean => {
    assertTrustedIpcSender(event)
    return secretStore.isEncryptionAvailable()
  })

  ipcMain.handle(
    IPC.SECRET_SET,
    (
      event,
      rawApiKey: unknown
    ): { ok: boolean; provider: AIProviderId } => {
      assertTrustedIpcSender(event)
      const { provider, apiKey } = normalizeApiKey(rawApiKey)
      secretStore.setApiKey(provider, apiKey)
      return { ok: true, provider }
    }
  )

  ipcMain.handle(IPC.AI_HARNESS_TRACE_LIST, (event) => {
    assertTrustedIpcSender(event)
    return traceStore.list()
  })

  ipcMain.handle(IPC.AI_HARNESS_TRACE_CLEAR, (event) => {
    assertTrustedIpcSender(event)
    traceStore.clear()
    return { ok: true as const }
  })

  ipcMain.handle(IPC.AI_HARNESS_TRACE_EXPORT, async (event) => {
    assertTrustedIpcSender(event)
    const result = await dialog.showSaveDialog({
      title: '匯出 Harness 診斷紀錄',
      defaultPath: `xiangqi-harness-traces-${new Date()
        .toISOString()
        .slice(0, 10)}.json`,
      filters: [{ name: 'JSON', extensions: ['json'] }]
    })
    if (result.canceled || !result.filePath) {
      return { ok: false as const, cancelled: true }
    }
    storage.writeAbsolute(result.filePath, {
      exportedAt: new Date().toISOString(),
      traces: traceStore.list()
    })
    return { ok: true as const, filePath: result.filePath }
  })

  ipcMain.handle(IPC.AI_HARNESS_TRACE_FEEDBACK, (event, raw: unknown) => {
    assertTrustedIpcSender(event)
    if (typeof raw !== 'object' || raw === null) {
      throw new SecurityValidationError('回饋格式無效。')
    }
    const value = raw as Record<string, unknown>
    const allowed = new Set([
      'helpful',
      'unclear',
      'incorrect',
      'missing_evidence'
    ])
    if (
      typeof value.traceId !== 'string' ||
      value.traceId.length > 128 ||
      typeof value.feedback !== 'string' ||
      !allowed.has(value.feedback)
    ) {
      throw new SecurityValidationError('回饋格式無效。')
    }
    traceStore.setFeedback(
      value.traceId,
      value.feedback as 'helpful' | 'unclear' | 'incorrect' | 'missing_evidence'
    )
    return { ok: true as const }
  })

  ipcMain.handle(IPC.SECRET_STATUS, (event) => {
    assertTrustedIpcSender(event)
    const provider = secretStore.getActiveProvider()
    return { configured: provider !== null, provider }
  })

  ipcMain.handle(
    IPC.SECRET_DELETE,
    (event): { ok: boolean } => {
      assertTrustedIpcSender(event)
      secretStore.deleteActiveApiKey()
      return { ok: true }
    }
  )

  // ---- AI 解釋 streaming（§2.17.5 最終版 loop） ----
  const activeExplanationRequests = new Map<string, AbortController>()
  const activeHarnessContinuations = new Map<string, () => void>()
  const MAX_ACTIVE_EXPLANATION_REQUESTS = 2

  ipcMain.on(
    IPC.AI_GENERATE_EXPLANATION_START,
    async (event, rawPayload: unknown) => {
      try {
        assertTrustedIpcSender(event)
      } catch {
        return
      }
      let payload: GenerateExplanationStartPayload
      try {
        payload = validateGenerateExplanationPayload(rawPayload)
      } catch (error) {
        event.reply(
          IPC.AI_GENERATE_EXPLANATION_ERROR,
          mapStreamingErrorToPayload(
            safeRequestId(
              typeof rawPayload === 'object' && rawPayload !== null
                ? (rawPayload as Record<string, unknown>).requestId
                : undefined
            ),
            error
          )
        )
        return
      }
      const { requestId } = payload
      const previous = activeExplanationRequests.get(requestId)
      if (!previous && activeExplanationRequests.size >= MAX_ACTIVE_EXPLANATION_REQUESTS) {
        event.reply(IPC.AI_GENERATE_EXPLANATION_ERROR, {
          requestId,
          code: 'too_many_requests',
          message: '同時 AI 解說工作過多，請等目前工作完成後再試。'
        } satisfies GenerateExplanationErrorPayload)
        return
      }
      previous?.abort()
      const controller = new AbortController()
      activeExplanationRequests.set(requestId, controller)
      let completedNormally = false
      try {
        const provider = getAIProvider(payload.provider)
        const modelConfig = modelRegistry.getModel(payload.provider, payload.model)
        const apiKey = secretStore.getApiKey(payload.provider)
        if (!apiKey) throw new MissingApiKeyError(payload.provider)
        const session = await sessionStore.get(payload.analysisId)
        if (!session) throw new AnalysisSessionNotFoundError(payload.analysisId)
        const result = await runExplanationHarness(payload, {
          provider,
          apiKey,
          model: modelConfig.model,
          session,
          registry: engineRegistry,
          traceStore,
          signal: controller.signal,
          onProgress: (progress) => {
            event.reply(IPC.AI_HARNESS_PROGRESS, {
              requestId,
              ...progress
            })
          },
          waitForContinuation: () =>
            new Promise<void>((resolve, reject) => {
              const onAbort = (): void => {
                activeHarnessContinuations.delete(requestId)
                reject(new DOMException('Request cancelled', 'AbortError'))
              }
              controller.signal.addEventListener('abort', onAbort, { once: true })
              activeHarnessContinuations.set(requestId, () => {
                controller.signal.removeEventListener('abort', onAbort)
                activeHarnessContinuations.delete(requestId)
                resolve()
              })
            })
        })
        if (
          controller.signal.aborted ||
          activeExplanationRequests.get(requestId) !== controller
        ) {
          throw new DOMException('Request cancelled', 'AbortError')
        }
        if (result.finalText.length > MAX_AI_RESPONSE_CHARS) {
          throw new SecurityValidationError('AI 回應超過允許大小。')
        }
        event.reply(IPC.AI_GENERATE_EXPLANATION_CHUNK, {
          requestId,
          deltaText: result.finalText
        })
        completedNormally = true
        event.reply(IPC.AI_GENERATE_EXPLANATION_DONE, {
          requestId,
          finalText: result.finalText,
          usage: result.usage,
          evidence: result.evidence,
          warnings: result.warnings,
          traceId: result.traceId,
          clarificationRequired: result.clarificationRequired
        })
      } catch (error) {
        if (!completedNormally) {
          const errorPayload = mapStreamingErrorToPayload(requestId, error)
          // 取消屬正常操作不記 error；其他失敗經 Logger（自動遮蔽 API key 等敏感字串）
          if (errorPayload.code !== 'cancelled') {
            logger.error('AI 解釋生成失敗', errorPayload.code, error)
          }
          event.reply(IPC.AI_GENERATE_EXPLANATION_ERROR, errorPayload)
        }
      } finally {
        activeHarnessContinuations.delete(requestId)
        if (activeExplanationRequests.get(requestId) === controller) {
          activeExplanationRequests.delete(requestId)
        }
      }
    }
  )

  ipcMain.on(
    IPC.AI_GENERATE_EXPLANATION_CANCEL,
    (event, payload: unknown) => {
      try {
        assertTrustedIpcSender(event)
      } catch {
        return
      }
      const requestId = safeRequestId(
        typeof payload === 'object' && payload !== null
          ? (payload as Record<string, unknown>).requestId
          : undefined
      )
      if (requestId === 'invalid-request') return
      const controller = activeExplanationRequests.get(requestId)
      if (!controller) return
      controller.abort()
    }
  )

  ipcMain.on(IPC.AI_HARNESS_CONTINUE, (event, payload: unknown) => {
    try {
      assertTrustedIpcSender(event)
    } catch {
      return
    }
    const requestId = safeRequestId(
      typeof payload === 'object' && payload !== null
        ? (payload as Record<string, unknown>).requestId
        : undefined
    )
    if (requestId === 'invalid-request') return
    activeHarnessContinuations.get(requestId)?.()
  })
}
