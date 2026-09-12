import type {
  AIExplanationStreamChunk,
  AIModelInfo,
  AIProvider,
  AITestCredentialResult,
  AICredentialTestStage
} from '@shared/types/AIProviderTypes'
import { isValidAIModelId } from '@shared/types/AIProviderTypes'
import type {
  AIExplanationRequest,
  AIExplanationResponse
} from '@shared/types/AIExplanationTypes'
import {
  AIResponseValidationError,
  CREDENTIAL_TEST_TIMEOUT_MS,
  createAIHttpError,
  describeCredentialTestError,
  fetchAiResponseBounded,
  readJsonResponseBounded,
  toAITransportError
} from '../http'
import {
  credentialTestRequest,
  credentialTestSucceeded
} from '../credentialTest'

const OPENROUTER_BASE_URL = 'https://openrouter.ai/api/v1'

/** OpenRouter 首輪驗收的生成階段必須比舊的 8 秒上限寬鬆。 */
export const OPENROUTER_CREDENTIAL_TEST_GENERATION_TIMEOUT_MS = 25_000
export const OPENROUTER_CREDENTIAL_TEST_MAX_OUTPUT_TOKENS = 512

interface OpenRouterOptions {
  baseUrl?: string
}

interface OpenRouterModel {
  id?: string
  name?: string
  architecture?: { output_modalities?: string[] }
  pricing?: {
    prompt?: string
    completion?: string
    request?: string
  }
}

interface OpenRouterModelsResponse {
  data?: OpenRouterModel[]
}

interface OpenRouterChatResponse {
  model?: string
  choices?: Array<{
    message?: {
      content?: string | null
      reasoning?: string | null
      reasoning_content?: string | null
    }
    finish_reason?: string | null
  }>
  usage?: {
    prompt_tokens?: number
    completion_tokens?: number
  }
}

function isZero(value: string | undefined): boolean {
  return value === undefined || Number(value) === 0
}

function isConcreteFreeTextModel(model: OpenRouterModel): model is OpenRouterModel & {
  id: string
} {
  return Boolean(
    model.id &&
      isValidAIModelId(model.id) &&
      model.id.endsWith(':free') &&
      model.architecture?.output_modalities?.includes('text') &&
      Number(model.pricing?.prompt) === 0 &&
      Number(model.pricing?.completion) === 0 &&
      isZero(model.pricing?.request)
  )
}

function isErrorEnvelope(value: unknown): boolean {
  return Boolean(
    value &&
      typeof value === 'object' &&
      'error' in value &&
      (value as { error?: unknown }).error !== undefined
  )
}

async function fetchOpenRouterResponse(
  input: string | URL | Request,
  init: RequestInit,
  stage: AICredentialTestStage
): Promise<Response> {
  try {
    return await fetchAiResponseBounded(input, init)
  } catch (error) {
    const transportError = toAITransportError(error, stage)
    if (transportError) throw transportError
    throw error
  }
}

export class OpenRouterProvider implements AIProvider {
  readonly id = 'openrouter' as const
  readonly displayName = 'OpenRouter'
  private readonly baseUrl: string

  constructor(options: OpenRouterOptions = {}) {
    this.baseUrl = (options.baseUrl ?? OPENROUTER_BASE_URL).replace(/\/+$/, '')
  }

  private headers(apiKey: string): Record<string, string> {
    return {
      authorization: `Bearer ${apiKey}`,
      'content-type': 'application/json',
      'x-openrouter-metadata': 'enabled'
    }
  }

  async generateExplanation(
    request: AIExplanationRequest,
    signal?: AbortSignal
  ): Promise<AIExplanationResponse> {
    const response = await fetchOpenRouterResponse(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      signal,
      headers: this.headers(request.apiKey),
      body: JSON.stringify({
        model: request.model,
        max_tokens: request.maxOutputTokens ?? 4096,
        temperature: 0.2,
        stream: false,
        ...(request.responseFormat === 'json'
          ? { response_format: { type: 'json_object' } }
          : {}),
        messages: [{ role: 'user', content: request.prompt }]
      })
    }, 'generation')
    if (!response.ok) {
      throw createAIHttpError(
        response,
        'generation',
        `OpenRouter 生成服務回報錯誤 (${response.status})。`
      )
    }
    let data: OpenRouterChatResponse
    try {
      data = await readJsonResponseBounded<OpenRouterChatResponse>(response)
    } catch (error) {
      const transportError = toAITransportError(error, 'generation')
      if (transportError) throw transportError
      throw new AIResponseValidationError(
        'generation',
        'response_format',
        'OpenRouter 回應不是有效的 JSON。'
      )
    }
    if (!data || typeof data !== 'object' || isErrorEnvelope(data)) {
      throw new AIResponseValidationError(
        'generation',
        'response_format',
        'OpenRouter 回應格式無效。'
      )
    }
    if (data.model !== request.model) {
      throw new AIResponseValidationError(
        'generation',
        'model_mismatch',
        `OpenRouter 模型路由不一致：要求 ${request.model}，實際回報 ${data.model ?? '未知模型'}。`
      )
    }
    const message = data.choices?.[0]?.message
    const finishReason = data.choices?.[0]?.finish_reason ?? undefined
    const outputTokens = data.usage?.completion_tokens
    const text = typeof message?.content === 'string' ? message.content.trim() : ''
    if (!text) {
      throw new AIResponseValidationError(
        'generation',
        'generation_incomplete',
        'OpenRouter 回應中沒有正式文字答案。',
        { reason: 'empty_content', finishReason, outputTokens }
      )
    }
    if (finishReason === 'length') {
      throw new AIResponseValidationError(
        'generation',
        'generation_incomplete',
        'OpenRouter 解說因輸出長度限制而未完成。',
        { reason: 'output_truncated', finishReason, outputTokens }
      )
    }
    return {
      text,
      provider: this.id,
      model: request.model,
      usage: data.usage
        ? {
            inputTokens: data.usage.prompt_tokens ?? 0,
            outputTokens: data.usage.completion_tokens ?? 0
          }
        : undefined,
      createdAt: Date.now(),
      groundedOnEngineData: true
    }
  }

  async *generateExplanationStream(
    request: AIExplanationRequest,
    signal: AbortSignal
  ): AsyncIterable<AIExplanationStreamChunk> {
    const response = await this.generateExplanation(request, signal)
    if (signal.aborted) throw new DOMException('Request cancelled', 'AbortError')
    yield { type: 'text_delta', deltaText: response.text }
    yield { type: 'done', usage: response.usage }
  }

  async listFreeModels(
    apiKey: string,
    timeoutMs = CREDENTIAL_TEST_TIMEOUT_MS
  ): Promise<AIModelInfo[]> {
    const signal = AbortSignal.timeout(timeoutMs)
    const keyResponse = await fetchOpenRouterResponse(`${this.baseUrl}/key`, {
      signal,
      headers: this.headers(apiKey)
    }, 'key')
    if (!keyResponse.ok) {
      throw createAIHttpError(
        keyResponse,
        'key',
        `OpenRouter 金鑰驗證端點回報錯誤 (${keyResponse.status})。`
      )
    }
    let keyBody: unknown
    try {
      keyBody = await readJsonResponseBounded(keyResponse)
    } catch (error) {
      const transportError = toAITransportError(error, 'key')
      if (transportError) throw transportError
      throw new AIResponseValidationError(
        'key',
        'response_format',
        'OpenRouter 金鑰驗證端點回應格式無效。'
      )
    }
    if (isErrorEnvelope(keyBody)) {
      throw new AIResponseValidationError(
        'key',
        'response_format',
        'OpenRouter 金鑰驗證端點回應格式無效。'
      )
    }

    const modelsResponse = await fetchOpenRouterResponse(
      `${this.baseUrl}/models?output_modalities=text`,
      { signal, headers: this.headers(apiKey) },
      'catalog'
    )
    if (!modelsResponse.ok) {
      throw createAIHttpError(
        modelsResponse,
        'catalog',
        `OpenRouter 模型清單端點回報錯誤 (${modelsResponse.status})。`
      )
    }
    let body: OpenRouterModelsResponse
    try {
      body = await readJsonResponseBounded<OpenRouterModelsResponse>(modelsResponse)
    } catch (error) {
      const transportError = toAITransportError(error, 'catalog')
      if (transportError) throw transportError
      throw new AIResponseValidationError(
        'catalog',
        'response_format',
        'OpenRouter 模型清單回應不是有效的 JSON。'
      )
    }
    if (!body || typeof body !== 'object' || isErrorEnvelope(body) || !Array.isArray(body.data)) {
      throw new AIResponseValidationError(
        'catalog',
        'response_format',
        'OpenRouter 模型清單回應格式無效。'
      )
    }
    return body.data
      .filter(isConcreteFreeTextModel)
      .map((model) => ({ id: model.id, label: model.name?.trim() || model.id }))
      .sort((left, right) => left.label.localeCompare(right.label))
  }

  async listModels(apiKey: string, timeoutMs?: number): Promise<string[]> {
    return (await this.listFreeModels(apiKey, timeoutMs)).map((model) => model.id)
  }

  async testCredential(
    apiKey: string,
    model: string,
    _baseUrl?: string,
    timeoutMs = OPENROUTER_CREDENTIAL_TEST_GENERATION_TIMEOUT_MS
  ): Promise<AITestCredentialResult> {
    try {
      const catalogTimeoutMs = Math.min(timeoutMs, CREDENTIAL_TEST_TIMEOUT_MS)
      const availableModels = await this.listFreeModels(apiKey, catalogTimeoutMs)
      return this.testCredentialWithModels(apiKey, model, availableModels, timeoutMs)
    } catch (error) {
      return describeCredentialTestError(error, this.displayName, 'catalog')
    }
  }

  /**
   * 使用已取得的模型清單完成生成驗證，避免自動連線重複呼叫 /key 與 /models。
   */
  async testCredentialWithModels(
    apiKey: string,
    model: string,
    availableModels: readonly AIModelInfo[],
    timeoutMs = OPENROUTER_CREDENTIAL_TEST_GENERATION_TIMEOUT_MS
  ): Promise<AITestCredentialResult> {
    try {
      if (!availableModels.some((availableModel) => availableModel.id === model)) {
        return {
          ok: false,
          message: `OpenRouter 模型 ${model} 目前不在官方免費模型清單中。`,
          diagnostic: {
            stage: 'catalog',
            category: 'model_unavailable',
            retryable: true,
            message: `OpenRouter 模型 ${model} 目前不在官方免費模型清單中。`
          }
        }
      }
      await this.generateExplanation(
        credentialTestRequest(this.id, model, apiKey, undefined, {
          maxOutputTokens: OPENROUTER_CREDENTIAL_TEST_MAX_OUTPUT_TOKENS
        }),
        AbortSignal.timeout(timeoutMs)
      )
      return credentialTestSucceeded(this.displayName, model)
    } catch (error) {
      return describeCredentialTestError(error, this.displayName)
    }
  }
}
