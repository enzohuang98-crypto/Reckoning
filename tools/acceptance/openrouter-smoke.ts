/**
 * OpenRouter live 探測腳本（P0-2；不納入 npm test）。
 *
 * 目的：用極少量請求取得免費模型的實際行為證據——回應的 model 是否與請求相同、
 * 推理參數是否被遵守、空白／截斷比例、首字時間與總延遲。
 *
 * 用法（PowerShell）：
 *   $env:OPENROUTER_API_KEY="…"
 *   npx tsx --tsconfig tsconfig.node.json tools/acceptance/openrouter-smoke.ts --models a:free,b:free --out smoke.json
 *
 * 安全：金鑰只從環境變數讀取，輸出只顯示前 8 碼；錯誤只記狀態碼與分類，不記原文；
 * 只允許 `:free` 模型；單次最多 9 個生成請求，每次間隔 3.5 秒（≤20 RPM）。
 */

import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, isAbsolute, join, resolve, sep } from 'node:path'
import { pathToFileURL } from 'node:url'

const DEFAULT_BASE_URL = 'https://openrouter.ai/api/v1'
const MAX_MODELS = 3
const MAX_GENERATION_REQUESTS = 9
const DEFAULT_INTERVAL_MS = 3_500
const REQUEST_TIMEOUT_MS = 90_000
const LOCAL_REVIEW_DIR = '.local-review'

export const SMOKE_PROMPT = `你是中國象棋教練。只根據下面的事實表回答，第一句直接回答，總共不超過 4 句。
【事實表】
輪到：紅方
引擎首選：炮二平五（評估 +0.42）；棋手著法：馬八進七（評估 +0.07）；差距：可接受（約 0.35 兵）
首選主線：
 1. 紅 炮二平五：炮進入中路；未吃子；未將軍
 2. 黑 馬8進7：跳馬出動；未吃子
實戰主線：
 1. 紅 馬八進七：跳馬出動；未吃子
兩線差異：
 - 首選線第 1 手即進入中路；實戰線沒有立刻佔中。
【問題】為什麼引擎更喜歡炮二平五？`

export type SmokeVariant = 'plain' | 'reasoning_off' | 'reasoning_off_stream'

export interface SmokeAttempt {
  model: string
  variant: SmokeVariant
  httpStatus: number | null
  totalMs: number
  firstTokenMs: number | null
  finishReason: string | null
  completionTokens: number | null
  reasoningTokens: number | null
  reportedModel: string | null
  modelMatches: boolean | null
  contentLength: number
  contentPreview: string
  errorCategory: string | null
}

export interface SmokeModelInfo {
  id: string
  contextLength: number | null
  maxCompletionTokens: number | null
  supportedParameters: string[]
}

export interface SmokeReport {
  generatedAt: string
  keyPrefix: string
  keyInfo: Record<string, string | number | boolean | null>
  freeModels: SmokeModelInfo[]
  attempts: SmokeAttempt[]
}

export interface SmokeOptions {
  apiKey: string
  models: string[]
  baseUrl?: string
  intervalMs?: number
  log?: (line: string) => void
}

function maskKey(apiKey: string): string {
  return `${apiKey.slice(0, 8)}…`
}

/** 只依狀態碼與錯誤本文中的固定代碼分類，絕不保留原文。 */
export function classifySmokeError(status: number | null, bodyText: string): string {
  if (status === null) return 'network_or_timeout'
  if (status === 429) {
    if (/free-models-per-day/i.test(bodyText)) return 'rate_limited_daily'
    return 'rate_limited_minute'
  }
  if (status === 401) return 'authentication'
  if (status === 402) return 'billing'
  if (status === 403) return 'permission'
  if (status === 404) return 'model_unavailable'
  if (status === 400 || status === 422) return 'invalid_request'
  if (status >= 500) return 'provider_unavailable'
  return `http_${status}`
}

function pickKeyInfo(body: unknown): Record<string, string | number | boolean | null> {
  const data =
    body && typeof body === 'object' && 'data' in body
      ? (body as { data?: unknown }).data
      : undefined
  const result: Record<string, string | number | boolean | null> = {}
  if (!data || typeof data !== 'object') return result
  for (const field of ['limit', 'limit_remaining', 'usage', 'usage_daily', 'is_free_tier']) {
    const value = (data as Record<string, unknown>)[field]
    if (
      value === null ||
      typeof value === 'number' ||
      typeof value === 'boolean'
    ) {
      result[field] = value
    }
  }
  return result
}

async function fetchJson(
  url: string,
  apiKey: string,
  init: RequestInit = {}
): Promise<{ status: number | null; body: unknown; text: string }> {
  try {
    const response = await fetch(url, {
      ...init,
      redirect: 'error',
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      headers: {
        authorization: `Bearer ${apiKey}`,
        'content-type': 'application/json',
        ...(init.headers as Record<string, string> | undefined)
      }
    })
    const text = await response.text()
    let body: unknown = null
    try {
      body = JSON.parse(text)
    } catch {
      body = null
    }
    return { status: response.status, body, text }
  } catch {
    return { status: null, body: null, text: '' }
  }
}

function chatBody(model: string, variant: SmokeVariant): Record<string, unknown> {
  return {
    model,
    max_tokens: 800,
    temperature: 0.2,
    messages: [{ role: 'user', content: SMOKE_PROMPT }],
    ...(variant === 'plain' ? {} : { reasoning: { effort: 'none', exclude: true } }),
    ...(variant === 'reasoning_off_stream'
      ? { stream: true, usage: { include: true } }
      : {})
  }
}

interface ChatResult {
  status: number | null
  firstTokenMs: number | null
  content: string
  finishReason: string | null
  completionTokens: number | null
  reasoningTokens: number | null
  reportedModel: string | null
  errorText: string
}

async function runNonStreaming(
  baseUrl: string,
  apiKey: string,
  model: string,
  variant: SmokeVariant
): Promise<ChatResult> {
  const { status, body, text } = await fetchJson(`${baseUrl}/chat/completions`, apiKey, {
    method: 'POST',
    body: JSON.stringify(chatBody(model, variant))
  })
  const data = (body ?? {}) as {
    model?: string
    error?: unknown
    choices?: Array<{ message?: { content?: string | null }; finish_reason?: string | null }>
    usage?: {
      completion_tokens?: number
      completion_tokens_details?: { reasoning_tokens?: number }
    }
  }
  const ok = status !== null && status >= 200 && status < 300 && !data.error
  return {
    status,
    firstTokenMs: null,
    content: ok ? (data.choices?.[0]?.message?.content ?? '').trim() : '',
    finishReason: ok ? data.choices?.[0]?.finish_reason ?? null : null,
    completionTokens: ok ? data.usage?.completion_tokens ?? null : null,
    reasoningTokens: ok
      ? data.usage?.completion_tokens_details?.reasoning_tokens ?? null
      : null,
    reportedModel: ok ? data.model ?? null : null,
    errorText: ok ? '' : text
  }
}

async function runStreaming(
  baseUrl: string,
  apiKey: string,
  model: string,
  startedAt: number
): Promise<ChatResult> {
  const result: ChatResult = {
    status: null,
    firstTokenMs: null,
    content: '',
    finishReason: null,
    completionTokens: null,
    reasoningTokens: null,
    reportedModel: null,
    errorText: ''
  }
  let response: Response
  try {
    response = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      redirect: 'error',
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      headers: {
        authorization: `Bearer ${apiKey}`,
        'content-type': 'application/json'
      },
      body: JSON.stringify(chatBody(model, 'reasoning_off_stream'))
    })
  } catch {
    return result
  }
  result.status = response.status
  if (!response.ok || !response.body) {
    result.errorText = await response.text().catch(() => '')
    return result
  }
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      let newline = buffer.indexOf('\n')
      while (newline >= 0) {
        const line = buffer.slice(0, newline).trim()
        buffer = buffer.slice(newline + 1)
        newline = buffer.indexOf('\n')
        if (!line.startsWith('data:')) continue
        const data = line.slice(5).trim()
        if (data === '[DONE]') continue
        let chunk: {
          model?: string
          error?: unknown
          choices?: Array<{ delta?: { content?: string | null }; finish_reason?: string | null }>
          usage?: {
            completion_tokens?: number
            completion_tokens_details?: { reasoning_tokens?: number }
          }
        }
        try {
          chunk = JSON.parse(data)
        } catch {
          continue
        }
        if (chunk.error) {
          result.errorText = data
          result.status = 500
          continue
        }
        result.reportedModel = chunk.model ?? result.reportedModel
        const delta = chunk.choices?.[0]?.delta?.content
        if (delta) {
          if (result.firstTokenMs === null) result.firstTokenMs = Date.now() - startedAt
          result.content += delta
        }
        result.finishReason = chunk.choices?.[0]?.finish_reason ?? result.finishReason
        if (chunk.usage) {
          result.completionTokens = chunk.usage.completion_tokens ?? null
          result.reasoningTokens =
            chunk.usage.completion_tokens_details?.reasoning_tokens ?? null
        }
      }
    }
  } catch {
    result.status = null
  }
  result.content = result.content.trim()
  return result
}

async function delay(ms: number): Promise<void> {
  if (ms > 0) await new Promise((resolveDelay) => setTimeout(resolveDelay, ms))
}

export async function runSmoke(options: SmokeOptions): Promise<SmokeReport> {
  const baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, '')
  const intervalMs = options.intervalMs ?? DEFAULT_INTERVAL_MS
  const log = options.log ?? ((line: string) => console.log(line))
  const models = options.models.slice(0, MAX_MODELS)
  for (const model of models) {
    if (!model.endsWith(':free')) {
      throw new Error(`只允許 :free 模型：${model}`)
    }
  }

  log(`OpenRouter smoke：key ${maskKey(options.apiKey)}，模型 ${models.join(', ') || '（未指定）'}`)
  const keyResponse = await fetchJson(`${baseUrl}/key`, options.apiKey)
  const keyInfo = pickKeyInfo(keyResponse.body)
  log(`/key → ${keyResponse.status ?? '連線失敗'} ${JSON.stringify(keyInfo)}`)

  const modelsResponse = await fetchJson(
    `${baseUrl}/models?output_modalities=text`,
    options.apiKey
  )
  const catalog = Array.isArray((modelsResponse.body as { data?: unknown } | null)?.data)
    ? ((modelsResponse.body as { data: Array<Record<string, unknown>> }).data)
    : []
  const freeModels: SmokeModelInfo[] = catalog
    .filter((item) => typeof item.id === 'string' && item.id.endsWith(':free'))
    .map((item) => ({
      id: item.id as string,
      contextLength: typeof item.context_length === 'number' ? item.context_length : null,
      maxCompletionTokens:
        typeof (item.top_provider as { max_completion_tokens?: unknown } | undefined)
          ?.max_completion_tokens === 'number'
          ? ((item.top_provider as { max_completion_tokens: number }).max_completion_tokens)
          : null,
      supportedParameters: Array.isArray(item.supported_parameters)
        ? (item.supported_parameters as unknown[]).filter(
            (value): value is string => typeof value === 'string'
          )
        : []
    }))
  log(`/models → ${modelsResponse.status ?? '連線失敗'}，免費文字模型 ${freeModels.length} 個`)
  for (const info of freeModels) {
    log(
      `  ${info.id} ctx=${info.contextLength ?? '?'} maxOut=${info.maxCompletionTokens ?? '?'} reasoning=${info.supportedParameters.includes('reasoning')} response_format=${info.supportedParameters.includes('response_format')}`
    )
  }

  const attempts: SmokeAttempt[] = []
  const variants: SmokeVariant[] = ['plain', 'reasoning_off', 'reasoning_off_stream']
  let requestCount = 0
  for (const model of models) {
    for (const variant of variants) {
      if (requestCount >= MAX_GENERATION_REQUESTS) break
      if (requestCount > 0) await delay(intervalMs)
      requestCount += 1
      const startedAt = Date.now()
      const chat =
        variant === 'reasoning_off_stream'
          ? await runStreaming(baseUrl, options.apiKey, model, startedAt)
          : await runNonStreaming(baseUrl, options.apiKey, model, variant)
      const ok = chat.status !== null && chat.status >= 200 && chat.status < 300 && !chat.errorText
      const attempt: SmokeAttempt = {
        model,
        variant,
        httpStatus: chat.status,
        totalMs: Date.now() - startedAt,
        firstTokenMs: chat.firstTokenMs,
        finishReason: chat.finishReason,
        completionTokens: chat.completionTokens,
        reasoningTokens: chat.reasoningTokens,
        reportedModel: chat.reportedModel,
        modelMatches: chat.reportedModel === null ? null : chat.reportedModel === model,
        contentLength: chat.content.length,
        contentPreview: chat.content.slice(0, 80),
        errorCategory: ok ? null : classifySmokeError(chat.status, chat.errorText)
      }
      attempts.push(attempt)
      log(
        `${model} [${variant}] status=${attempt.httpStatus ?? '—'} ${attempt.totalMs}ms first=${attempt.firstTokenMs ?? '—'}ms finish=${attempt.finishReason ?? '—'} out=${attempt.completionTokens ?? '—'} reasoning=${attempt.reasoningTokens ?? '—'} modelMatch=${attempt.modelMatches ?? '—'} chars=${attempt.contentLength}${attempt.errorCategory ? ` error=${attempt.errorCategory}` : ''}`
      )
    }
  }

  return {
    generatedAt: new Date().toISOString(),
    keyPrefix: maskKey(options.apiKey),
    keyInfo,
    freeModels,
    attempts
  }
}

function argValue(argv: string[], name: string): string | undefined {
  const index = argv.indexOf(name)
  return index >= 0 ? argv[index + 1] : undefined
}

/** `--out` 只寫進 .local-review/（已 gitignore），避免把結果誤放進版控目錄。 */
export function resolveLocalReviewPath(out: string, cwd = process.cwd()): string {
  const base = resolve(cwd, LOCAL_REVIEW_DIR)
  const target = isAbsolute(out) ? resolve(out) : resolve(base, out)
  if (target !== base && !target.startsWith(`${base}${sep}`)) {
    return join(base, out.replace(/[\\/:]+/g, '_'))
  }
  return target
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2)
  const apiKey = process.env.OPENROUTER_API_KEY?.trim()
  if (!apiKey) {
    console.error('請先設定環境變數 OPENROUTER_API_KEY（不要把金鑰寫進檔案）。')
    process.exitCode = 1
    return
  }
  const models = (argValue(argv, '--models') ?? '')
    .split(',')
    .map((model) => model.trim())
    .filter(Boolean)
  const report = await runSmoke({
    apiKey,
    models,
    baseUrl: argValue(argv, '--base-url')
  })
  const out = argValue(argv, '--out')
  if (out) {
    const target = resolveLocalReviewPath(out)
    mkdirSync(dirname(target), { recursive: true })
    writeFileSync(target, `${JSON.stringify(report, null, 2)}\n`)
    console.log(`已寫入 ${target}`)
  }
}

const invokedDirectly =
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
if (invokedDirectly) {
  main().catch((error: unknown) => {
    console.error('smoke 執行失敗：', error instanceof Error ? error.name : 'unknown')
    process.exitCode = 1
  })
}
