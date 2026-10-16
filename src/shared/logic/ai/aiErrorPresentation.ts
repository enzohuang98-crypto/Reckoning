import type { AICredentialDiagnostic } from '../../types/AIProviderTypes'
import { CERTIFICATE_ERROR_MESSAGE, isCertificateErrorCode } from './networkErrorCodes'
import type {
  AIExplanationErrorCode,
  AIExplanationFailureReason
} from '../../types/ipc'

/** 錯誤卡上可點的下一步；「複製診斷資訊」永遠提供，不列在這裡。 */
export type AiErrorAction =
  | 'open_settings'
  | 'retry'
  | 'change_model'
  | 'reanalyze'

export interface AiErrorPresentation {
  title: string
  detail: string
  actions: AiErrorAction[]
  /** 每分鐘限流時建議等待的秒數。 */
  waitSeconds?: number
}

export interface AiErrorInput {
  code: AIExplanationErrorCode
  message?: string
  diagnostic?: AICredentialDiagnostic
  failureReason?: AIExplanationFailureReason
}

/**
 * 把 main 回報的錯誤碼與診斷轉成「一句人話＋一個明確行動」。
 * 純函式；文案不含服務原文、金鑰或 prompt。cancelled 不顯示錯誤卡，回傳 null。
 */
export function presentAiError(input: AiErrorInput): AiErrorPresentation | null {
  const { code, diagnostic, failureReason } = input
  if (code === 'cancelled') return null
  if (code === 'missing_api_key') {
    return {
      title: '尚未設定 AI 金鑰',
      detail: '請到設定頁貼上 AI 服務的金鑰並完成測試。',
      actions: ['open_settings']
    }
  }
  if (code === 'unsupported_model') {
    return {
      title: '目前選的模型無法使用',
      detail: '請到設定頁重新選擇模型。',
      actions: ['change_model']
    }
  }
  if (code === 'analysis_session_not_found') {
    return {
      title: '分析已過期',
      detail: '這次引擎分析的結果已過期，請重新分析局面後再問。',
      actions: ['reanalyze']
    }
  }
  if (code === 'too_many_requests') {
    return {
      title: '同時進行的 AI 工作過多',
      detail: '請等目前的回答完成後再試。',
      actions: ['retry']
    }
  }
  if (code === 'rate_limited' || diagnostic?.category === 'rate_limited') {
    if (diagnostic?.quota === 'daily') {
      return {
        title: '今天的免費額度用完了',
        detail:
          '依 OpenRouter 現行政策，未儲值帳號每天可用 50 次免費模型；儲值 10 美元後提高到每天 1,000 次。可以明天再試，或到設定頁改用其他模型或服務。',
        actions: ['open_settings']
      }
    }
    const waitSeconds = Math.max(
      5,
      Math.min(120, Math.ceil((diagnostic?.retryAfterMs ?? 20_000) / 1000))
    )
    return {
      title: '請求太頻繁',
      detail: `請等 ${waitSeconds} 秒後再重試。`,
      actions: ['retry'],
      waitSeconds
    }
  }
  if (
    (code === 'network_error' || diagnostic?.category === 'network') &&
    isCertificateErrorCode(diagnostic?.networkCode)
  ) {
    return {
      title: 'HTTPS 憑證驗證失敗',
      detail: CERTIFICATE_ERROR_MESSAGE,
      actions: ['retry']
    }
  }
  if (code === 'network_error' || diagnostic?.category === 'network') {
    return {
      title: '網路連線失敗',
      detail: '請檢查網路連線後重試。',
      actions: ['retry']
    }
  }
  if (failureReason === 'model_timeout' || diagnostic?.category === 'timeout') {
    return {
      title: '模型太慢，超過時間',
      detail:
        input.message ??
        '這次模型沒有在時間內完成回答。可以重試，或改用回應較快的模型。',
      actions: ['retry', 'change_model']
    }
  }
  if (failureReason === 'quality_validation_failed') {
    return {
      title: '回答未通過檢查',
      detail:
        input.message ?? 'AI 的回答有和引擎資料不符的地方，所以沒有顯示。可以再試一次。',
      actions: ['retry']
    }
  }
  if (failureReason === 'insufficient_engine_evidence') {
    return {
      title: '引擎資料還不夠',
      detail: input.message ?? '引擎主線太短，暫時無法可靠解釋。請重新分析後再問。',
      actions: ['reanalyze']
    }
  }
  if (failureReason === 'model_budget') {
    return {
      title: '這次回答用完了呼叫上限',
      detail: '請再試一次。',
      actions: ['retry']
    }
  }
  if (
    failureReason === 'invalid_model_response' ||
    diagnostic?.category === 'generation_incomplete' ||
    diagnostic?.category === 'response_format' ||
    diagnostic?.category === 'model_mismatch'
  ) {
    return {
      title: '模型沒有給出完整答案',
      detail:
        diagnostic?.reason === 'output_truncated'
          ? '回答在長度上限前被截斷。可以重試，或改用其他模型。'
          : '模型沒有交出可用的正式答案。可以重試，或改用其他模型。',
      actions: ['retry', 'change_model']
    }
  }
  if (diagnostic?.category === 'authentication') {
    return {
      title: 'AI 金鑰無效',
      detail: '服務回報認證失敗，請到設定頁確認金鑰。',
      actions: ['open_settings']
    }
  }
  if (diagnostic?.category === 'billing') {
    return {
      title: '帳戶額度不足',
      detail: '服務回報帳務或額度不足，請確認帳戶方案，或到設定頁改用其他服務。',
      actions: ['open_settings']
    }
  }
  if (diagnostic?.category === 'permission') {
    return {
      title: '此模型不開放這類使用',
      detail: '服務拒絕讓這個模型處理這次請求，請改用其他模型。',
      actions: ['change_model']
    }
  }
  if (diagnostic?.category === 'model_unavailable') {
    return {
      title: '模型已下架或不在免費清單',
      detail: '請到設定頁重新讀取模型清單並改選模型。',
      actions: ['change_model']
    }
  }
  if (diagnostic?.category === 'provider_unavailable') {
    return {
      title: '這個模型暫時無法回應',
      detail: '服務端暫時忙碌或故障。可以稍後重試，或改用其他模型。',
      actions: ['retry', 'change_model']
    }
  }
  if (code === 'provider_error') {
    return {
      title: 'AI 服務沒有完成回答',
      detail: input.message ?? '請重試；若持續發生，請改用其他模型。',
      actions: ['retry', 'change_model']
    }
  }
  return {
    title: '程式發生錯誤',
    detail: '請按「複製診斷資訊」並回報，或重試一次。',
    actions: ['retry']
  }
}

/** 診斷資訊只含分類欄位，不含金鑰、prompt 或服務原文。 */
export function aiErrorDiagnosticsText(
  input: AiErrorInput & { model?: string }
): string {
  return JSON.stringify({
    code: input.code,
    failureReason: input.failureReason ?? null,
    category: input.diagnostic?.category ?? null,
    httpStatus: input.diagnostic?.httpStatus ?? null,
    reason: input.diagnostic?.reason ?? null,
    quota: input.diagnostic?.quota ?? null,
    model: input.model ?? null
  })
}
