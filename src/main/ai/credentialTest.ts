import type { AIExplanationRequest } from '@shared/types/AIExplanationTypes'
import type {
  AIProviderId,
  AITestCredentialResult
} from '@shared/types/AIProviderTypes'

export interface CredentialTestRequestOptions {
  maxOutputTokens?: number
}

/** 真實推論，但刻意只要求極短輸出，避免「列模型成功、實際模型不可用」的假陽性。 */
export function credentialTestRequest(
  provider: AIProviderId,
  model: string,
  apiKey: string,
  baseUrl?: string,
  options: CredentialTestRequestOptions = {}
): AIExplanationRequest {
  return {
    provider,
    model,
    apiKey,
    baseUrl,
    prompt: 'Reply with OK only.',
    maxOutputTokens: options.maxOutputTokens ?? 32,
    responseFormat: 'text',
    metadata: {
      requestId: 'credential-test',
      analysisId: 'credential-test',
      userLevel: 'basic',
      explanationStyle: 'long_analytical'
    }
  }
}

export function credentialTestSucceeded(
  providerLabel: string,
  model: string
): AITestCredentialResult {
  return {
    ok: true,
    message: `${providerLabel} · ${model} 已完成一次短回覆測試，金鑰與模型可連線；完整解說仍需另行驗證。`
  }
}
