/**
 * Logger（共用模組）— SDS v0.2 §2.11、§2.12
 *
 * 記錄非敏感錯誤與事件；輸出前自動遮蔽 API Key、Authorization header
 * 與 secret token，防止金鑰經由日誌洩漏。
 * main process 所有 service 一律經此模組輸出，不得直接 console.*。
 */

/** 敏感字串遮蔽規則（依序套用） */
const SECRET_PATTERNS: Array<{ pattern: RegExp; replacement: string }> = [
  // Anthropic / OpenAI 形式金鑰：sk-ant-xxxx、sk-xxxx
  { pattern: /\bsk-[A-Za-z0-9_-]{8,}/g, replacement: 'sk-***' },
  // Google API key：AIza 開頭
  { pattern: /\bAIza[A-Za-z0-9_-]{8,}/g, replacement: 'AIza***' },
  // Authorization: Bearer <token> / 任意 Authorization header 值
  {
    pattern: /\b(authorization\s*[:=]\s*)(?:bearer\s+)?[^\s,;"']+/gi,
    replacement: '$1***'
  },
  // x-goog-api-key / x-api-key header 值
  {
    pattern: /\b(x-(?:goog-)?api-key\s*[:=]\s*)[^\s,;"']+/gi,
    replacement: '$1***'
  },
  // JSON 形式："apiKey": "..."（含 api_key / token / secret 變體）
  {
    pattern: /("(?:apiKey|api_key|token|secret)"\s*:\s*")[^"]*(")/gi,
    replacement: '$1***$2'
  },
  // 本產品 License Key：XQA1.<payload>.<sig>
  { pattern: /\bXQA1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, replacement: 'XQA1.***' }
]

/** 遮蔽單一字串中的敏感資訊（純函式，可單元測試） */
export function maskSecrets(text: string): string {
  let masked = text
  for (const { pattern, replacement } of SECRET_PATTERNS) {
    masked = masked.replace(pattern, replacement)
  }
  return masked
}

/** 將任意 log 參數轉為已遮蔽字串（Error 取 message+stack；物件 JSON 化後遮蔽） */
function toMaskedString(value: unknown): string {
  if (typeof value === 'string') return maskSecrets(value)
  if (value instanceof Error) {
    return maskSecrets(`${value.name}: ${value.message}${value.stack ? `\n${value.stack}` : ''}`)
  }
  try {
    return maskSecrets(JSON.stringify(value))
  } catch {
    return '[unserializable]'
  }
}

function emit(level: 'info' | 'warn' | 'error', args: unknown[]): void {
  const line = args.map(toMaskedString).join(' ')
  // eslint-disable-next-line no-console
  console[level](`[${new Date().toISOString()}] [${level}] ${line}`)
}

export const logger = {
  info: (...args: unknown[]): void => emit('info', args),
  warn: (...args: unknown[]): void => emit('warn', args),
  error: (...args: unknown[]): void => emit('error', args)
}
