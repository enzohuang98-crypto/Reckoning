import { createHash } from 'node:crypto'
import type {
  AIExplanationStreamChunk,
  AIModelCapabilities,
  AIModelInfo,
  AIProvider,
  TokenUsage,
  AITestCredentialResult,
  AICredentialTestStage
} from '@shared/types/AIProviderTypes'
import { isValidAIModelId } from '@shared/types/AIProviderTypes'
import type {
  AIExplanationRequest,
  AIExplanationResponse
} from '@shared/types/AIExplanationTypes'
import {
  AIHttpError,
  AIResponseValidationError,
  CREDENTIAL_TEST_TIMEOUT_MS,
  createAIHttpError,
  describeCredentialTestError,
  fetchAiResponseBounded,
  parseRateLimitResetMs,
  readJsonResponseBounded,
  toAITransportError
} from '../http'
import { SseParser } from './sse'
import {
  buildOpenRouterRequestOptions,
  type OpenRouterRequestOptions
} from './openRouterRequestPolicy'
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
  /** 串流閒置上限（測試可縮短）。 */
  streamIdleTimeoutMs?: number
}

/** 串流超過這段時間沒有任何位元組就中止。 */
export const OPENROUTER_STREAM_IDLE_TIMEOUT_MS = 30_000

interface OpenRouterStreamChunk {
  model?: string
  error?: unknown
  choices?: Array<{
    delta?: { content?: string | null }
    finish_reason?: string | null
  }>
  usage?: OpenRouterUsage
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
  supported_parameters?: string[]
  context_length?: number
  top_provider?: { max_completion_tokens?: number | null }
}

/** 模型目錄能力快取：同一把金鑰 6 小時內只讀一次目錄。 */
const CAPABILITY_TTL_MS = 6 * 60 * 60 * 1000
/** 讀取失敗時短暫記住，避免每次生成都再等一次失敗的目錄請求。 */
const CAPABILITY_FAILURE_TTL_MS = 5 * 60 * 1000
/** 能力查詢只是最佳化；超過這個時間就放棄，不拖慢生成。 */
const CAPABILITY_LOOKUP_TIMEOUT_MS = 5_000

interface CatalogCacheEntry {
  expiresAt: number
  models: Map<string, AIModelCapabilities> | null
}

interface ObservedModelBehavior {
  expiresAt: number
  /** 帶 reasoning 參數被服務以 400/422 拒絕。 */
  reasoningRejected?: boolean
  /** 要求關閉推理仍產生推理 tokens 並吃光輸出。 */
  reasoningMandatory?: boolean
}

function positiveNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
    ? value
    : undefined
}

/** 只從目錄中明確列出的參數推斷能力；沒有參數清單時視為未知（null）。 */
export function capabilitiesFromOpenRouterModel(
  model: OpenRouterModel
): AIModelCapabilities | null {
  if (!Array.isArray(model.supported_parameters)) return null
  const parameters = new Set(
    model.supported_parameters.filter((value): value is string => typeof value === 'string')
  )
  const maxCompletionTokens = positiveNumber(model.top_provider?.max_completion_tokens)
  const contextLength = positiveNumber(model.context_length)
  return {
    supportsReasoning: parameters.has('reasoning') || parameters.has('include_reasoning'),
    supportsResponseFormat: parameters.has('response_format'),
    supportsStructuredOutputs: parameters.has('structured_outputs'),
    ...(maxCompletionTokens ? { maxCompletionTokens } : {}),
    ...(contextLength ? { contextLength } : {})
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
  usage?: OpenRouterUsage
}

interface OpenRouterUsage {
  prompt_tokens?: number
  completion_tokens?: number
  completion_tokens_details?: { reasoning_tokens?: number }
}

function toTokenUsage(usage: OpenRouterUsage | undefined): TokenUsage | undefined {
  if (!usage) return undefined
  const reasoningTokens = usage.completion_tokens_details?.reasoning_tokens
  return {
    inputTokens: usage.prompt_tokens ?? 0,
    outputTokens: usage.completion_tokens ?? 0,
    ...(typeof reasoningTokens === 'number' ? { reasoningTokens } : {})
  }
}

/** 有 systemPrompt 時以 system＋user 兩則訊息送出；沒有時維持單一 user 訊息。 */
function chatMessages(
  request: AIExplanationRequest
): Array<{ role: 'system' | 'user'; content: string }> {
  return request.systemPrompt
    ? [
        { role: 'system', content: request.systemPrompt },
        { role: 'user', content: request.prompt }
      ]
    : [{ role: 'user', content: request.prompt }]
}

/** 空白或被截斷的回答不是正式答案。 */
function assertCompleteAnswer(
  text: string,
  finishReason: string | undefined,
  usage: TokenUsage | undefined
): void {
  const details = {
    finishReason,
    outputTokens: usage?.outputTokens,
    ...(usage?.reasoningTokens === undefined ? {} : { reasoningTokens: usage.reasoningTokens })
  }
  if (!text) {
    throw new AIResponseValidationError(
      'generation',
      'generation_incomplete',
      'OpenRouter 回應中沒有正式文字答案。',
      { reason: 'empty_content', ...details }
    )
  }
  if (finishReason === 'length') {
    throw new AIResponseValidationError(
      'generation',
      'generation_incomplete',
      'OpenRouter 解說因輸出長度限制而未完成。',
      { reason: 'output_truncated', ...details }
    )
  }
}

/**
 * 服務回報的模型名稱可能少了變體後綴（例如 `vendor/model` 對應 `vendor/model:free`）。
 * 去掉 `:` 後綴後相同才接受；其他家族一律視為路由不一致。
 */
export function isSameOpenRouterModel(
  reported: string | undefined,
  requested: string
): boolean {
  if (!reported) return false
  if (reported === requested) return true
  const base = (model: string): string => model.split(':')[0]
  return base(reported) === base(requested)
}

function isZero(value: string | undefined): boolean {
  return value === undefined || Number(value) === 0
}

/**
 * 例外開放的付費模型：P3-9 實戰局面驗收中，免費與便宜模型的解說品質達不到門檻，
 * Claude Sonnet 5.5 達標（2026-10-16）。只開放這份清單，其他付費模型照舊不列；
 * 標籤註明「付費」，備援模型仍只能選 :free（AiPreferencesStore）。
 */
export const RECOMMENDED_PAID_OPENROUTER_MODELS: readonly string[] = [
  'anthropic/claude-sonnet-5.5',
  'anthropic/claude-haiku-5.5'
]

function isRecommendedPaidTextModel(model: OpenRouterModel): model is OpenRouterModel & { id: string } {
  return Boolean(
    model.id &&
      RECOMMENDED_PAID_OPENROUTER_MODELS.includes(model.id) &&
      isValidAIModelId(model.id) &&
      model.architecture?.output_modalities?.includes('text')
  )
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

function throwOpenRouterErrorEnvelope(
  value: unknown,
  stage: AICredentialTestStage
): void {
  if (!isErrorEnvelope(value)) return
  const code = (value as { error?: { code?: unknown } }).error?.code
  const status = typeof code === 'number'
    ? code
    : typeof code === 'string' && /^\d{3}$/.test(code)
      ? Number(code)
      : undefined
  if (status !== undefined && status >= 400 && status <= 599) {
    throw new AIHttpError(
      status,
      stage,
      `OpenRouter 上游服務回報錯誤 (${status})。`
    )
  }
  throw new AIResponseValidationError(
    stage,
    'response_format',
    'OpenRouter 回應包含無法分類的錯誤資料。'
  )
}

const MAX_RATE_LIMIT_BODY_BYTES = 16 * 1024

/**
 * OpenRouter 的 429 分成「每日免費額度用完」與「每分鐘請求過多」，兩者的處理完全不同。
 * 只用固定代碼判斷種類，回應本文不保留、不進入錯誤訊息。
 */
async function createOpenRouterHttpError(
  response: Response,
  stage: AICredentialTestStage,
  message: string
): Promise<AIHttpError> {
  const base = createAIHttpError(response, stage, message)
  if (response.status !== 429) {
    await response.body?.cancel().catch(() => undefined)
    return base
  }
  let quota: 'daily' | 'minute' = 'minute'
  try {
    const body = await readJsonResponseBounded<unknown>(
      response,
      MAX_RATE_LIMIT_BODY_BYTES
    )
    if (/free-models-per-day/i.test(JSON.stringify(body))) quota = 'daily'
  } catch {
    // 無法讀取或不是 JSON：保守當成短暫限流。
  }
  return new AIHttpError(
    429,
    stage,
    message,
    base.retryAfterMs ??
      parseRateLimitResetMs(response.headers.get('x-ratelimit-reset')),
    quota
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
  private readonly catalogCache = new Map<string, CatalogCacheEntry>()
  private readonly observedBehavior = new Map<string, ObservedModelBehavior>()

  private readonly streamIdleTimeoutMs: number

  constructor(options: OpenRouterOptions = {}) {
    this.baseUrl = (options.baseUrl ?? OPENROUTER_BASE_URL).replace(/\/+$/, '')
    this.streamIdleTimeoutMs =
      options.streamIdleTimeoutMs ?? OPENROUTER_STREAM_IDLE_TIMEOUT_MS
  }

  /** 快取鍵只用金鑰雜湊，金鑰本身不留在快取結構裡。 */
  private catalogKey(apiKey: string): string {
    return createHash('sha256').update(apiKey).digest('hex')
  }

  private rememberCatalog(apiKey: string, models: readonly OpenRouterModel[]): void {
    const capabilities = new Map<string, AIModelCapabilities>()
    for (const model of models) {
      if (typeof model?.id !== 'string') continue
      const parsed = capabilitiesFromOpenRouterModel(model)
      if (parsed) capabilities.set(model.id, parsed)
    }
    this.catalogCache.set(this.catalogKey(apiKey), {
      expiresAt: Date.now() + CAPABILITY_TTL_MS,
      models: capabilities
    })
  }

  /** 記錄執行期觀察到的模型行為，讓之後的請求不再重犯同一錯。 */
  observeModelBehavior(
    model: string,
    behavior: Partial<Pick<ObservedModelBehavior, 'reasoningRejected' | 'reasoningMandatory'>>
  ): void {
    const current = this.observedBehavior.get(model)
    const base = current && current.expiresAt > Date.now() ? current : undefined
    this.observedBehavior.set(model, {
      ...base,
      ...behavior,
      expiresAt: Date.now() + CAPABILITY_TTL_MS
    })
  }

  /**
   * 取得模型能力（目錄＋執行期觀察）。讀取失敗或模型不在目錄中時回傳 null，
   * 呼叫端必須把 null 當成「未知」，不得因此阻擋生成。
   */
  /** 只看快取、不發請求；憑證測試等已讀過清單的流程使用。 */
  private cachedModelCapabilities(apiKey: string, model: string): AIModelCapabilities | null {
    const entry = this.catalogCache.get(this.catalogKey(apiKey))
    if (!entry || entry.expiresAt <= Date.now()) return null
    return entry.models?.get(model) ?? null
  }

  async getModelCapabilities(
    apiKey: string,
    model: string,
    signal?: AbortSignal
  ): Promise<AIModelCapabilities | null> {
    const key = this.catalogKey(apiKey)
    let entry = this.catalogCache.get(key)
    if (!entry || entry.expiresAt <= Date.now()) {
      entry = { expiresAt: Date.now() + CAPABILITY_FAILURE_TTL_MS, models: null }
      try {
        const lookupSignal = signal
          ? AbortSignal.any([signal, AbortSignal.timeout(CAPABILITY_LOOKUP_TIMEOUT_MS)])
          : AbortSignal.timeout(CAPABILITY_LOOKUP_TIMEOUT_MS)
        const response = await fetchAiResponseBounded(
          `${this.baseUrl}/models?output_modalities=text`,
          { signal: lookupSignal, headers: this.headers(apiKey) }
        )
        if (response.ok) {
          const body = await readJsonResponseBounded<OpenRouterModelsResponse>(response)
          if (body && typeof body === 'object' && Array.isArray(body.data)) {
            this.rememberCatalog(apiKey, body.data)
            entry = this.catalogCache.get(key) ?? entry
          }
        } else {
          await response.body?.cancel().catch(() => undefined)
        }
      } catch {
        if (signal?.aborted) throw new DOMException('Request cancelled', 'AbortError')
      }
      if (!entry.models) this.catalogCache.set(key, entry)
    }
    const catalog = entry.models?.get(model) ?? null
    if (!catalog) return null
    const observed = this.observedBehavior.get(model)
    if (!observed || observed.expiresAt <= Date.now()) return { ...catalog }
    return {
      ...catalog,
      supportsReasoning: catalog.supportsReasoning && !observed.reasoningRejected,
      ...(observed.reasoningMandatory ? { reasoningMandatory: true } : {})
    }
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
    const capabilities = await this.getModelCapabilities(
      request.apiKey,
      request.model,
      signal
    )
    return this.generateWithCapabilities(request, capabilities, signal)
  }

  private async generateWithCapabilities(
    request: AIExplanationRequest,
    capabilities: AIModelCapabilities | null,
    signal?: AbortSignal
  ): Promise<AIExplanationResponse> {
    const options = buildOpenRouterRequestOptions({
      capabilities,
      responseFormat: request.responseFormat,
      visibleTokens: request.maxOutputTokens ?? 4096,
      reasoningMode: request.reasoningMode
    })
    try {
      const response = await this.postChat(request, options, signal)
      return response
    } catch (error) {
      // 帶 reasoning 參數被拒絕：記住並不帶 reasoning 重送一次（呼叫端以 providerAttempts 計數）。
      if (
        options.reasoning &&
        error instanceof AIHttpError &&
        (error.status === 400 || error.status === 422)
      ) {
        this.observeModelBehavior(request.model, { reasoningRejected: true })
        const { reasoning: _dropped, ...withoutReasoning } = options
        const retried = await this.postChat(request, withoutReasoning, signal)
        return { ...retried, providerAttempts: 2 }
      }
      throw error
    }
  }

  private async postChat(
    request: AIExplanationRequest,
    options: OpenRouterRequestOptions,
    signal?: AbortSignal
  ): Promise<AIExplanationResponse> {
    const response = await fetchOpenRouterResponse(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      signal,
      headers: this.headers(request.apiKey),
      body: JSON.stringify({
        model: request.model,
        temperature: 0.2,
        stream: false,
        ...options,
        messages: chatMessages(request)
      })
    }, 'generation')
    if (!response.ok) {
      throw await createOpenRouterHttpError(
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
    throwOpenRouterErrorEnvelope(data, 'generation')
    if (!data || typeof data !== 'object') {
      throw new AIResponseValidationError(
        'generation',
        'response_format',
        'OpenRouter 回應格式無效。'
      )
    }
    if (!isSameOpenRouterModel(data.model, request.model)) {
      throw new AIResponseValidationError(
        'generation',
        'model_mismatch',
        `OpenRouter 模型路由不一致：要求 ${request.model}，實際回報 ${data.model ?? '未知模型'}。`
      )
    }
    const message = data.choices?.[0]?.message
    const finishReason = data.choices?.[0]?.finish_reason ?? undefined
    const usage = toTokenUsage(data.usage)
    const text = typeof message?.content === 'string' ? message.content.trim() : ''
    this.observeIncompleteReasoning(request.model, options, text, finishReason, usage)
    assertCompleteAnswer(text, finishReason, usage)
    return {
      text,
      provider: this.id,
      model: request.model,
      actualModel: data.model,
      usage,
      finishReason,
      createdAt: Date.now(),
      groundedOnEngineData: true
    }
  }

  /**
   * 已要求關閉推理，正文卻空白或被截斷且推理 tokens 不為零：這個模型的推理關不掉。
   * 記住它，之後的請求改用最低強度並預留推理額度。
   */
  private observeIncompleteReasoning(
    model: string,
    options: OpenRouterRequestOptions,
    text: string,
    finishReason: string | undefined,
    usage: TokenUsage | undefined
  ): void {
    const incomplete = !text || finishReason === 'length'
    const disabled =
      options.reasoning !== undefined &&
      (options.reasoning.enabled === false || options.reasoning.effort === 'none')
    if (incomplete && disabled && (usage?.reasoningTokens ?? 0) > 0) {
      this.observeModelBehavior(model, { reasoningMandatory: true })
    }
  }

  /**
   * 真串流（SSE）。每收到任何位元組就重置閒置計時；閒置超過上限即中止並回報逾時。
   * 正文空白或因長度截斷時，與單次模式一樣回報 generation_incomplete。
   */
  async *generateExplanationStream(
    request: AIExplanationRequest,
    signal: AbortSignal
  ): AsyncIterable<AIExplanationStreamChunk> {
    const capabilities = await this.getModelCapabilities(
      request.apiKey,
      request.model,
      signal
    )
    let options = buildOpenRouterRequestOptions({
      capabilities,
      responseFormat: request.responseFormat,
      visibleTokens: request.maxOutputTokens ?? 4096,
      reasoningMode: request.reasoningMode
    })
    const controller = new AbortController()
    const forwardAbort = (): void => controller.abort()
    signal.addEventListener('abort', forwardAbort, { once: true })
    if (signal.aborted) controller.abort()
    let idleTimedOut = false
    let idleTimer: ReturnType<typeof setTimeout> | undefined
    const resetIdle = (): void => {
      if (idleTimer) clearTimeout(idleTimer)
      idleTimer = setTimeout(() => {
        idleTimedOut = true
        controller.abort()
      }, this.streamIdleTimeoutMs)
    }
    const failure = (error: unknown): unknown => {
      if (idleTimedOut && !signal.aborted) {
        const timeout = new DOMException('OpenRouter 串流閒置逾時。', 'TimeoutError')
        return toAITransportError(timeout, 'generation') ?? timeout
      }
      return error
    }
    try {
      resetIdle()
      let response: Response
      try {
        response = await this.postStream(request, options, controller.signal)
      } catch (error) {
        if (
          options.reasoning &&
          error instanceof AIHttpError &&
          (error.status === 400 || error.status === 422)
        ) {
          this.observeModelBehavior(request.model, { reasoningRejected: true })
          const { reasoning: _dropped, ...withoutReasoning } = options
          options = withoutReasoning
          resetIdle()
          response = await this.postStream(request, options, controller.signal)
        } else {
          throw error
        }
      }
      if (!response.body) {
        throw new AIResponseValidationError(
          'generation',
          'response_format',
          'OpenRouter 串流回應沒有內容。'
        )
      }
      const reader = response.body.getReader()
      const decoder = new TextDecoder()
      const parser = new SseParser()
      let text = ''
      let finishReason: string | undefined
      let usage: TokenUsage | undefined
      let actualModel: string | undefined
      let done = false
      const handle = (data: string): AIExplanationStreamChunk | null => {
        if (data === '[DONE]') {
          done = true
          return null
        }
        let chunk: OpenRouterStreamChunk
        try {
          chunk = JSON.parse(data) as OpenRouterStreamChunk
        } catch {
          return null
        }
        if (chunk && typeof chunk === 'object' && chunk.error !== undefined) {
          const code = (chunk.error as { code?: unknown } | null)?.code
          const status =
            typeof code === 'number' && code >= 400 && code <= 599
              ? code
              : typeof code === 'string' && /^\d{3}$/.test(code)
                ? Number(code)
                : 502
          throw new AIHttpError(status, 'generation', `OpenRouter 串流中回報錯誤 (${status})。`)
        }
        if (typeof chunk.model === 'string') {
          if (!isSameOpenRouterModel(chunk.model, request.model)) {
            throw new AIResponseValidationError(
              'generation',
              'model_mismatch',
              `OpenRouter 模型路由不一致：要求 ${request.model}，實際回報 ${chunk.model}。`
            )
          }
          actualModel = chunk.model
        }
        const choice = chunk.choices?.[0]
        if (choice?.finish_reason) finishReason = choice.finish_reason
        if (chunk.usage) usage = toTokenUsage(chunk.usage)
        const delta = choice?.delta?.content
        if (typeof delta === 'string' && delta.length > 0) {
          text += delta
          return { type: 'text_delta', deltaText: delta }
        }
        return null
      }
      while (!done) {
        const { done: streamDone, value } = await reader.read()
        if (streamDone) break
        resetIdle()
        for (const event of parser.push(decoder.decode(value, { stream: true }))) {
          const chunk = handle(event.data)
          if (chunk) yield chunk
          if (done) break
        }
      }
      if (!done) {
        for (const event of parser.push(decoder.decode())) handle(event.data)
        for (const event of parser.flush()) handle(event.data)
      }
      await reader.cancel().catch(() => undefined)
      const trimmed = text.trim()
      this.observeIncompleteReasoning(request.model, options, trimmed, finishReason, usage)
      assertCompleteAnswer(trimmed, finishReason, usage)
      yield { type: 'done', usage, finishReason, actualModel }
    } catch (error) {
      throw failure(error)
    } finally {
      if (idleTimer) clearTimeout(idleTimer)
      signal.removeEventListener('abort', forwardAbort)
    }
  }

  private async postStream(
    request: AIExplanationRequest,
    options: OpenRouterRequestOptions,
    signal: AbortSignal
  ): Promise<Response> {
    const response = await fetchOpenRouterResponse(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      signal,
      headers: this.headers(request.apiKey),
      body: JSON.stringify({
        model: request.model,
        temperature: 0.2,
        stream: true,
        usage: { include: true },
        ...options,
        messages: chatMessages(request)
      })
    }, 'generation')
    if (!response.ok) {
      throw await createOpenRouterHttpError(
        response,
        'generation',
        `OpenRouter 生成服務回報錯誤 (${response.status})。`
      )
    }
    return response
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
      throw await createOpenRouterHttpError(
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
    throwOpenRouterErrorEnvelope(keyBody, 'key')

    const modelsResponse = await fetchOpenRouterResponse(
      `${this.baseUrl}/models?output_modalities=text`,
      { signal, headers: this.headers(apiKey) },
      'catalog'
    )
    if (!modelsResponse.ok) {
      throw await createOpenRouterHttpError(
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
    throwOpenRouterErrorEnvelope(body, 'catalog')
    if (!body || typeof body !== 'object' || !Array.isArray(body.data)) {
      throw new AIResponseValidationError(
        'catalog',
        'response_format',
        'OpenRouter 模型清單回應格式無效。'
      )
    }
    this.rememberCatalog(apiKey, body.data)
    return body.data
      .filter((model): model is OpenRouterModel & { id: string } =>
        isConcreteFreeTextModel(model) || isRecommendedPaidTextModel(model)
      )
      .map((model) => {
        const label = model.name?.trim() || model.id
        return {
          id: model.id,
          label: isConcreteFreeTextModel(model) ? label : `${label}（付費，費用記在 OpenRouter 帳戶）`
        }
      })
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
      // 呼叫端已讀過模型清單：只用快取中的能力，不再重讀 /models。
      await this.generateWithCapabilities(
        credentialTestRequest(this.id, model, apiKey, undefined, {
          maxOutputTokens: OPENROUTER_CREDENTIAL_TEST_MAX_OUTPUT_TOKENS
        }),
        this.cachedModelCapabilities(apiKey, model),
        AbortSignal.timeout(timeoutMs)
      )
      return credentialTestSucceeded(this.displayName, model)
    } catch (error) {
      return describeCredentialTestError(error, this.displayName)
    }
  }
}
