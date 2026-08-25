/**
 * OpenAI Provider — SDS v0.2 §2.17.4、§2.17.8
 *
 * 無狀態 adapter：API key 與 prompt 由 AIExplanationRequest 帶入。
 * 以內建 fetch 呼叫 Chat Completions API（不引入 SDK，減少相依）。
 * streaming 介面為包裝模式（§2.17.1）：等完整回應後以單一 text_delta 回傳。
 */

import type {
  AIProvider,
  AIExplanationStreamChunk,
  AITestCredentialResult
} from '@shared/types/AIProviderTypes'
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
import {
  openAIChatSamplingOptions,
  openAIResponsesOptions,
  supportsOpenAIChatJsonMode,
  usesOpenAIResponsesApi
} from '../OpenAIModelRouting'

const DEFAULT_BASE_URL = 'https://api.openai.com/v1'
const MAX_OUTPUT_TOKENS = 4096

/** Chat Completions 回應中本實作會使用的欄位 */
interface OpenAIChatResponse {
  choices?: Array<{ message?: { content?: string | null } }>
  usage?: { prompt_tokens?: number; completion_tokens?: number }
}

interface OpenAIResponsesResponse {
  output_text?: string
  output?: Array<{
    type?: string
    content?: Array<{ type?: string; text?: string }>
  }>
  usage?: { input_tokens?: number; output_tokens?: number }
}

interface OpenAIModelsResponse {
  data?: Array<{ id?: string }>
}

function responsesText(data: OpenAIResponsesResponse): string {
  const direct = data.output_text?.trim()
  if (direct) return direct
  return (data.output ?? [])
    .filter((item) => item.type === undefined || item.type === 'message')
    .flatMap((item) => item.content ?? [])
    .filter((item) => item.type === undefined || item.type === 'output_text')
    .map((item) => item.text ?? '')
    .join('')
    .trim()
}

export class OpenAIProvider implements AIProvider {
  readonly id = 'openai' as const
  readonly displayName = 'OpenAI'

  constructor(private readonly options: { baseUrl?: string } = {}) {}

  async generateExplanation(
    request: AIExplanationRequest,
    signal?: AbortSignal
  ): Promise<AIExplanationResponse> {
    const baseUrl = (this.options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, '')
    const useResponses = usesOpenAIResponsesApi(request.model)

    const res = await fetch(
      `${baseUrl}/${useResponses ? 'responses' : 'chat/completions'}`,
      {
        method: 'POST',
        redirect: 'error',
        signal,
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${request.apiKey}`
        },
        body: JSON.stringify(
          useResponses
            ? {
                model: request.model,
                input: request.prompt,
                max_output_tokens: request.maxOutputTokens ?? MAX_OUTPUT_TOKENS,
                ...openAIResponsesOptions(request.model),
                store: false
              }
            : {
                model: request.model,
                max_completion_tokens:
                  request.maxOutputTokens ?? MAX_OUTPUT_TOKENS,
                ...openAIChatSamplingOptions(request.model),
                ...(request.responseFormat === 'json' &&
                supportsOpenAIChatJsonMode(request.model)
                  ? { response_format: { type: 'json_object' } }
                  : {}),
                messages: [{ role: 'user', content: request.prompt }]
              }
        )
      }
    )

    if (!res.ok) {
      throw new Error(`OpenAI API 錯誤 (${res.status})：${await extractApiErrorMessage(res)}`)
    }

    const data = useResponses
      ? await readJsonResponseBounded<OpenAIResponsesResponse>(res)
      : await readJsonResponseBounded<OpenAIChatResponse>(res)
    const text = useResponses
      ? responsesText(data as OpenAIResponsesResponse)
      : (data as OpenAIChatResponse).choices?.[0]?.message?.content?.trim()
    if (!text) {
      throw new Error('OpenAI 回應中沒有文字內容。')
    }

    const usage = data.usage
      ? useResponses
        ? {
            inputTokens:
              (data as OpenAIResponsesResponse).usage?.input_tokens ?? 0,
            outputTokens:
              (data as OpenAIResponsesResponse).usage?.output_tokens ?? 0
          }
        : {
            inputTokens: (data as OpenAIChatResponse).usage?.prompt_tokens ?? 0,
            outputTokens:
              (data as OpenAIChatResponse).usage?.completion_tokens ?? 0
          }
      : undefined

    return {
      text,
      provider: this.id,
      model: request.model,
      usage,
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

  async listModels(
    apiKey: string,
    timeoutMs = CREDENTIAL_TEST_TIMEOUT_MS
  ): Promise<string[]> {
    const baseUrl = (this.options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, '')
    const response = await fetchAiResponseBounded(`${baseUrl}/models`, {
      method: 'GET',
      signal: AbortSignal.timeout(timeoutMs),
      headers: { authorization: `Bearer ${apiKey}` }
    })
    if (!response.ok) throw new Error(`OpenAI models API 错误 (${response.status})`)
    const body = await readJsonResponseBounded<OpenAIModelsResponse>(response)
    return (body.data ?? [])
      .map((item) => item.id?.trim() ?? '')
      .filter((id) => /^(?:gpt-|o\d)/.test(id))
      .filter((id) => !/(?:audio|realtime|transcribe|tts|image|search|instruct|codex)/i.test(id))
  }

  async testCredential(
    apiKey: string,
    model: string,
    _baseUrlOverride?: string,
    timeoutMs = CREDENTIAL_TEST_TIMEOUT_MS
  ): Promise<AITestCredentialResult> {
    try {
      await this.generateExplanation(
        credentialTestRequest(this.id, model, apiKey),
        AbortSignal.timeout(timeoutMs)
      )
      return credentialTestSucceeded(this.displayName, model)
    } catch (error) {
      return describeCredentialTestError(error, 'OpenAI')
    }
  }
}
