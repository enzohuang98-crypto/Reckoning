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
 *  - resolveExplanationCredential()（ai/explanationCredential）是唯一注入 API key 的入口；v1 由
 *    buildAIExplanationRequest() 組 PromptBuilder prompt，v2 由 explain/promptV2 組 prompt
 *    （XQA_EXPLAIN_PIPELINE=v1 可回滾）。
 *  - abort 檢查放在 chunk 處理之後；done 分支先設 completedNormally=true 再 reply。
 *  - catch 僅在 !completedNormally 時送 error；finally 清除 activeExplanationRequests。
 *  - cancel 必須實際呼叫 controller.abort()。
 *
 * 這裡也是 AI 相關 IPC 的單一註冊入口：憑證與模型設定通道在 aiCredentialHandlers，
 * 診斷紀錄通道在 harnessTraceHandlers。
 */

import { ipcMain } from 'electron'
import {
  IPC,
  type GenerateExplanationErrorPayload,
  type GenerateExplanationStartPayload
} from '@shared/types/ipc'
import type { SecretStore } from '../storage/SecretStore'
import {
  AnalysisSessionNotFoundError,
  type AnalysisSessionStore
} from '../storage/AnalysisSessionStore'
import { getAIProvider } from '../ai/AIProvider'
import { AiPreferencesStore } from '../ai/AiPreferencesStore'
import { runExplanationHarness } from '../ai/HarnessOrchestrator'
import {
  FIXED_HARNESS_OPTIONS,
  prepareExplanationExecution
} from '../ai/prepareExplanationExecution'
import {
  buildAIExplanationRequest,
  resolveExplanationCredential
} from '../ai/explanationCredential'
import { runExplainPipelineV2 } from '../ai/explain/ExplainPipelineV2'
import { selectExplainPipeline } from '../ai/explain/pipelineFlag'
import { modelRegistry } from '../ai/ModelRegistry'
import { logger } from '../logger'
import { assertTrustedIpcSender } from '../security/IpcSecurity'
import {
  MAX_AI_RESPONSE_CHARS,
  isLoopbackAiBaseUrl,
  safeRequestId,
  SecurityValidationError,
  validateGenerateExplanationPayload
} from '../security/InputValidation'
import type { EngineRegistryService } from '../engine/EngineRegistryService'
import type { StorageService } from '../storage/StorageService'
import { HarnessTraceStore } from '../storage/HarnessTraceStore'
import { registerAiCredentialHandlers } from './aiCredentialHandlers'
import { registerHarnessTraceHandlers } from './harnessTraceHandlers'
import { mapStreamingErrorToPayload } from './explanationErrorPayload'

export function registerAiExplanationHandlers(
  secretStore: SecretStore,
  sessionStore: AnalysisSessionStore,
  engineRegistry: EngineRegistryService,
  storage: StorageService
): void {
  const traceStore = new HarnessTraceStore(storage)
  let aiPreferencesStore: AiPreferencesStore | null = null
  // 第一次用到才建立，避免只註冊通道的流程（與測試）就觸碰檔案系統。
  const aiPreferences = (): AiPreferencesStore =>
    (aiPreferencesStore ??= new AiPreferencesStore(storage.filePath('ai-preferences.json')))

  registerAiCredentialHandlers(secretStore, aiPreferences)
  registerHarnessTraceHandlers(traceStore, storage)

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
        const capturedActive = await secretStore.captureActiveCredential()
        const useRequestedLoopback =
          payload.provider === 'openai-compatible' &&
          isLoopbackAiBaseUrl(payload.baseUrl)
        const effectivePayload = capturedActive && !useRequestedLoopback
          ? {
              ...payload,
              provider: capturedActive.credential.provider,
              model: capturedActive.credential.model,
              baseUrl: capturedActive.credential.baseUrl
            }
          : payload
        const session = await sessionStore.get(effectivePayload.analysisId)
        if (!session) throw new AnalysisSessionNotFoundError(payload.analysisId)
        const resolvedModel = modelRegistry.getModel(
          effectivePayload.provider,
          effectivePayload.model
        ).model
        const execution = prepareExplanationExecution(
          { ...effectivePayload, ...FIXED_HARNESS_OPTIONS },
          session,
          resolvedModel
        )
        if (selectExplainPipeline(execution) === 'v2') {
          const credential = await resolveExplanationCredential(execution, {
            secretStore,
            credentialSnapshot: capturedActive
          })
          // 備援模型只來自 main 保存且已驗證的偏好；renderer 不能在請求中指定。
          const backupModels =
            credential.provider === 'openrouter' && !credential.baseUrl
              ? (await aiPreferences().get()).openRouterBackupModels
              : []
          const v2 = await runExplainPipelineV2(execution, {
            provider: getAIProvider(credential.provider),
            apiKey: credential.apiKey,
            registry: engineRegistry,
            traceStore,
            signal: controller.signal,
            backupModels,
            onProgress: (progress) => {
              event.reply(IPC.AI_HARNESS_PROGRESS, { requestId, ...progress })
            },
            onDelta: (deltaText, attempt) => {
              if (
                controller.signal.aborted ||
                activeExplanationRequests.get(requestId) !== controller
              ) {
                return
              }
              event.reply(IPC.AI_GENERATE_EXPLANATION_CHUNK, {
                requestId,
                deltaText,
                attempt
              })
            }
          })
          if (
            controller.signal.aborted ||
            activeExplanationRequests.get(requestId) !== controller
          ) {
            throw new DOMException('Request cancelled', 'AbortError')
          }
          if (v2.finalText.length > MAX_AI_RESPONSE_CHARS) {
            throw new SecurityValidationError('AI 回應超過允許大小。')
          }
          completedNormally = true
          event.reply(IPC.AI_GENERATE_EXPLANATION_DONE, {
            requestId,
            finalText: v2.finalText,
            provider: credential.provider,
            model: credential.model,
            usage: v2.usage,
            warnings: v2.warnings,
            traceId: v2.traceId,
            clarificationRequired: false,
            answerKind: v2.answerKind,
            ...(v2.actualModel ? { actualModel: v2.actualModel } : {}),
            ...(v2.fallbackFromModel
              ? { fallbackFromModel: v2.fallbackFromModel, fallbackReason: v2.fallbackReason }
              : {}),
            repairUsed: v2.repairUsed
          })
          return
        }
        const request = await buildAIExplanationRequest(execution, {
          secretStore,
          credentialSnapshot: capturedActive
        })
        const provider = getAIProvider(request.provider)
        const result = await runExplanationHarness(execution, {
          provider,
          apiKey: request.apiKey,
          registry: engineRegistry,
          traceStore,
          signal: controller.signal,
          explanationPrompt: request.prompt,
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
          provider: request.provider,
          model: request.model,
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
