import type {
  AIExplanationStreamChunk,
  AIModelInfo,
  AIProvider,
  AITestCredentialResult
} from '@shared/types/AIProviderTypes'
import { isValidAIModelId } from '@shared/types/AIProviderTypes'
import type {
  AIExplanationRequest,
  AIExplanationResponse
} from '@shared/types/AIExplanationTypes'
import {
  CREDENTIAL_TEST_TIMEOUT_MS,
  describeCredentialTestError,
  extractApiErrorMessage,
  fetchAiResponseBounded,
  readJsonResponseBounded
} from '../http'
import {
  credentialTestRequest,
  credentialTestSucceeded
} from '../credentialTest'

const OPENROUTER_BASE_URL = 'https://openrouter.ai/api/v1'

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

function redactExactSecret(value: string, secret: string): string {
  return secret ? value.replaceAll(secret, '[REDACTED]') : value
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
    const response = await fetchAiResponseBounded(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      signal,
      headers: this.headers(request.apiKey),
      body: JSON.stringify({
        model: request.model,
        max_tokens: request.maxOutputTokens ?? 4096,
        temperature: 0.2,
        stream: false,
        messages: [{ role: 'user', content: request.prompt }]
      })
    })
    if (!response.ok) {
      const detail = redactExactSecret(
        await extractApiErrorMessage(response),
        request.apiKey
      )
      throw new Error(`OpenRouter API 錯誤 (${response.status})：${detail}`)
    }
    const data = await readJsonResponseBounded<OpenRouterChatResponse>(response)
    if (data.model !== request.model) {
      throw new Error(
        `OpenRouter 模型路由不一致：要求 ${request.model}，實際回報 ${data.model ?? '未知模型'}。`
      )
    }
    const message = data.choices?.[0]?.message
    const text = (
      message?.content ??
      message?.reasoning_content ??
      message?.reasoning ??
      ''
    ).trim()
    if (!text) throw new Error('OpenRouter 回應中沒有文字內容。')
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
    const keyResponse = await fetchAiResponseBounded(`${this.baseUrl}/key`, {
      signal,
      headers: this.headers(apiKey)
    })
    if (!keyResponse.ok) {
      throw new Error(`OpenRouter key API 錯誤 (${keyResponse.status})`)
    }
    await readJsonResponseBounded(keyResponse)

    const modelsResponse = await fetchAiResponseBounded(
      `${this.baseUrl}/models?output_modalities=text`,
      { signal, headers: this.headers(apiKey) }
    )
    if (!modelsResponse.ok) {
      throw new Error(`OpenRouter models API 錯誤 (${modelsResponse.status})`)
    }
    const body = await readJsonResponseBounded<OpenRouterModelsResponse>(modelsResponse)
    return (body.data ?? [])
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
    timeoutMs = CREDENTIAL_TEST_TIMEOUT_MS
  ): Promise<AITestCredentialResult> {
    try {
      const availableModels = await this.listModels(apiKey, timeoutMs)
      if (!availableModels.includes(model)) {
        return {
          ok: false,
          message: `OpenRouter 模型 ${model} 目前不在官方免費模型清單中。`
        }
      }
      await this.generateExplanation(
        credentialTestRequest(this.id, model, apiKey),
        AbortSignal.timeout(timeoutMs)
      )
      return credentialTestSucceeded(this.displayName, model)
    } catch (error) {
      return describeCredentialTestError(error, this.displayName)
    }
  }
}
