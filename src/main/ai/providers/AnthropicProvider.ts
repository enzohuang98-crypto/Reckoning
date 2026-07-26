/**
 * Anthropic Provider — SDS v0.2 §2.17.4、§2.17.8
 *
 * 無狀態 adapter：API key 與 prompt 由 AIExplanationRequest 帶入。
 * 使用 @anthropic-ai/sdk 呼叫 Claude 模型；streaming 模式為真 SSE streaming，
 * AbortSignal 直接傳入 SDK。
 */

import Anthropic from '@anthropic-ai/sdk'
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
  fetchAiResponseBounded
} from '../http'
import {
  credentialTestRequest,
  credentialTestSucceeded
} from '../credentialTest'

/** 長篇分析輸出上限 */
const MAX_OUTPUT_TOKENS = 4096

export class AnthropicProvider implements AIProvider {
  readonly id = 'anthropic' as const
  readonly displayName = 'Anthropic Claude'

  constructor(private readonly options: { baseUrl?: string } = {}) {}

  private client(apiKey: string): Anthropic {
    return new Anthropic({
      apiKey,
      baseURL: this.options.baseUrl,
      maxRetries: 0,
      fetch: (input, init) => fetchAiResponseBounded(input, init)
    })
  }

  async generateExplanation(
    request: AIExplanationRequest,
    signal?: AbortSignal
  ): Promise<AIExplanationResponse> {
    const message = await this.client(request.apiKey).messages.create(
      {
        model: request.model,
        max_tokens: request.maxOutputTokens ?? MAX_OUTPUT_TOKENS,
        messages: [{ role: 'user', content: request.prompt }]
      },
      { signal }
    )

    const text = message.content
      .filter((block): block is Anthropic.TextBlock => block.type === 'text')
      .map((block) => block.text)
      .join('\n')
      .trim()

    const usage = {
      inputTokens: message.usage.input_tokens,
      outputTokens: message.usage.output_tokens
    }

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
    const stream = await this.client(request.apiKey).messages.create(
      {
        model: request.model,
        max_tokens: request.maxOutputTokens ?? MAX_OUTPUT_TOKENS,
        stream: true,
        messages: [{ role: 'user', content: request.prompt }]
      },
      { signal }
    )

    let inputTokens = 0
    let outputTokens = 0
    for await (const event of stream) {
      if (event.type === 'message_start') {
        inputTokens = event.message.usage.input_tokens
      } else if (
        event.type === 'content_block_delta' &&
        event.delta.type === 'text_delta'
      ) {
        yield { type: 'text_delta', deltaText: event.delta.text }
      } else if (event.type === 'message_delta') {
        outputTokens = event.usage.output_tokens
      }
    }

    const usage = { inputTokens, outputTokens }
    yield { type: 'done', usage }
  }

  async testCredential(
    apiKey: string,
    model: string,
    _baseUrl?: string,
    timeoutMs = CREDENTIAL_TEST_TIMEOUT_MS
  ): Promise<AITestCredentialResult> {
    try {
      await this.generateExplanation(
        credentialTestRequest(this.id, model, apiKey),
        AbortSignal.timeout(timeoutMs)
      )
      return credentialTestSucceeded(this.displayName, model)
    } catch (error) {
      return describeCredentialTestError(error, 'Anthropic')
    }
  }
}
