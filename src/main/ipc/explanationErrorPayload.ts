/** 解說串流錯誤 → IPC 錯誤 payload（§2.17.6）。訊息不得含 API key 或服務回應原文。 */

import type { GenerateExplanationErrorPayload } from '@shared/types/ipc'
import { AnalysisSessionNotFoundError } from '../storage/AnalysisSessionStore'
import { HarnessExplanationUnavailableError } from '../ai/HarnessOrchestrator'
import {
  AIResponseValidationError,
  aiErrorStatus,
  describeAIExecutionError
} from '../ai/http'
import { UnsupportedModelError } from '../ai/ModelRegistry'
import {
  MissingApiKeyError,
  ProviderEndpointMismatchError
} from '../ai/explanationCredential'
import { SecurityValidationError } from '../security/InputValidation'

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
      message: error.needsReentry
        ? `已保存的 ${error.provider}/${error.model} API 金鑰無法解密（系統加密金鑰已變動），請至設定頁重新輸入。`
        : `尚未設定 ${error.provider}/${error.model} 的 API 金鑰，請至設定頁輸入。`
    }
  }
  if (error instanceof UnsupportedModelError) {
    return {
      requestId,
      code: 'unsupported_model',
      message: `不支援的模型：${error.provider}/${error.model}。請至設定頁選擇有效模型。`
    }
  }
  if (error instanceof ProviderEndpointMismatchError) {
    return {
      requestId,
      code: 'invalid_request',
      message: '相容服務網址已變更。為避免把 API Key 送到錯誤端點，請到設定頁重新確認並儲存金鑰。'
    }
  }
  if (error instanceof AnalysisSessionNotFoundError) {
    return {
      requestId,
      code: 'analysis_session_not_found',
      message: '這次分析結果已過期，請重新分析局面後再生成 AI 解釋。'
    }
  }
  if (error instanceof HarnessExplanationUnavailableError) {
    return {
      requestId,
      code: 'provider_error',
      message: error.message,
      failureReason: error.reason
    }
  }
  if (error instanceof SecurityValidationError) {
    return {
      requestId,
      code: 'invalid_request',
      message: error.message
    }
  }
  if (error instanceof AIResponseValidationError) {
    const diagnostic = describeAIExecutionError(error, 'AI 服務')
    const message =
      error.category === 'response_format'
        ? 'AI 回應格式無法驗證，請重試；若持續發生，請改用支援 JSON 的模型。'
        : error.category === 'model_mismatch'
          ? 'AI 實際回報的模型與所選模型不一致，請重新讀取模型清單後再試。'
          : error.details.reason === 'output_truncated'
            ? 'AI 解說因輸出長度限制而未完成，請重試或改用輸出上限較高的模型。'
            : 'AI 模型沒有交付正式文字答案，請重試或改用其他模型。'
    return { requestId, code: 'provider_error', message, diagnostic }
  }
  if (error instanceof Error) {
    // Anthropic SDK 取消時丟 APIUserAbortError（非 DOMException）
    if (error.name === 'APIUserAbortError' || error.name === 'AbortError') {
      return { requestId, code: 'cancelled', message: '已取消生成。' }
    }
    const status = aiErrorStatus(error)
    if (status === 429) {
      return {
        requestId,
        code: 'rate_limited',
        message: '模型呼叫被限流 (rate limit)，請稍後重試。',
        diagnostic: describeAIExecutionError(error, 'AI 服務')
      }
    }
    if (status === 503) {
      return {
        requestId,
        code: 'provider_error',
        message: 'AI 服務目前過載或暫時不可用 (503)，本次未顯示替代模板。請稍後重試。',
        diagnostic: describeAIExecutionError(error, 'AI 服務')
      }
    }
    if (typeof status === 'number' && status >= 500) {
      return {
        requestId,
        code: 'provider_error',
        message: status === 502
          ? '目前模型暫時無法完成請求 (502)。可稍後重試，或使用同一把 key 更換模型。'
          : `AI 服務暫時無法完成請求 (${status})，本次未顯示替代模板。請重試。`,
        diagnostic: describeAIExecutionError(error, 'AI 服務')
      }
    }
    // fetch 網路層失敗（DNS/連線中斷）為 TypeError；SDK 為 APIConnectionError
    if (error.name === 'APIConnectionError' || error instanceof TypeError) {
      return {
        requestId,
        code: 'network_error',
        message: '網路連線失敗，請檢查網路後重試。',
        diagnostic: describeAIExecutionError(error, 'AI 服務')
      }
    }
    if (typeof status === 'number' || /API 錯誤/.test(error.message)) {
      return {
        requestId,
        code: 'provider_error',
        message: 'AI 服務回報錯誤，請檢查模型與金鑰設定後重試。',
        diagnostic: describeAIExecutionError(error, 'AI 服務')
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
