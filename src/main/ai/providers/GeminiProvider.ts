/**
 * Google Gemini Provider（真實實作）
 *
 * 以內建 fetch 呼叫 generateContent REST API（不引入 SDK，減少相依）。
 * 套用與 Anthropic 相同的 promptBuilder 與護欄規則。
 */

import type {
  AIProvider,
  AIModelInfo,
  AIProviderConfig
} from '@shared/types/AIProviderTypes'
import { PROVIDER_DEFAULT_MODELS } from '@shared/types/AIProviderTypes'
import type {
  AIExplanationRequest,
  AIExplanationResponse
} from '@shared/types/AIExplanationTypes'
import { buildSystemPrompt, buildUserPrompt } from '../promptBuilder'
import { estimateCost } from '../cost'
import { extractApiErrorMessage } from '../http'

const DEFAULT_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta'

/** generateContent 回應中本實作會使用的欄位 */
interface GeminiGenerateContentResponse {
  candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>
  usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number }
}

export class GeminiProvider implements AIProvider {
  readonly id = 'gemini' as const
  readonly displayName = 'Google Gemini'

  private readonly config: AIProviderConfig

  constructor(config: AIProviderConfig) {
    this.config = config
  }

  listModels(): AIModelInfo[] {
    return PROVIDER_DEFAULT_MODELS.gemini
  }

  isConfigured(): boolean {
    return this.config.apiKey.length > 0 && this.config.model.length > 0
  }

  async generateExplanation(
    request: AIExplanationRequest
  ): Promise<AIExplanationResponse> {
    const language = request.language ?? 'zh-TW'
    const model = request.model || this.config.model
    const baseUrl = (this.config.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, '')

    const res = await fetch(`${baseUrl}/models/${encodeURIComponent(model)}:generateContent`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        // 金鑰走 header，不放 URL query（避免進入日誌）
        'x-goog-api-key': this.config.apiKey
      },
      body: JSON.stringify({
        system_instruction: { parts: [{ text: buildSystemPrompt(language) }] },
        contents: [{ role: 'user', parts: [{ text: buildUserPrompt(request) }] }],
        generationConfig: {
          maxOutputTokens: this.config.maxTokens ?? 1024,
          temperature: this.config.temperature ?? 0.3
        }
      })
    })

    if (!res.ok) {
      throw new Error(`Gemini API 錯誤 (${res.status})：${await extractApiErrorMessage(res)}`)
    }

    const data = (await res.json()) as GeminiGenerateContentResponse
    const text = data.candidates?.[0]?.content?.parts
      ?.map((part) => part.text ?? '')
      .join('\n')
      .trim()
    if (!text) {
      throw new Error('Gemini 回應中沒有文字內容。')
    }

    const usage = data.usageMetadata
      ? {
          inputTokens: data.usageMetadata.promptTokenCount ?? 0,
          outputTokens: data.usageMetadata.candidatesTokenCount ?? 0
        }
      : undefined

    return {
      text,
      provider: this.id,
      model,
      usage,
      costUsd: usage ? estimateCost(model, usage) : undefined,
      createdAt: Date.now(),
      groundedOnEngineData: true
    }
  }
}
