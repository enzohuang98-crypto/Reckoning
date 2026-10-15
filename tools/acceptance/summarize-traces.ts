/**
 * Harness 診斷紀錄統計（P0-3）。
 *
 * 輸入：設定頁「匯出 Harness 診斷紀錄」產生的 JSON。
 * 輸出：只有統計（狀態、失敗分類、驗證錯誤前 15 名、模型、呼叫次數分佈、耗時中位數）；
 * 絕不輸出 finalText、問題原文、FEN 或任何回應內容，方便使用者把結果貼回而不外洩對局。
 *
 * 用法：npx tsx --tsconfig tsconfig.node.json tools/acceptance/summarize-traces.ts <export.json>
 */

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

interface TraceLike {
  status?: unknown
  model?: unknown
  modelCalls?: unknown
  durationMs?: unknown
  validationErrors?: unknown
  pipelineVersion?: unknown
  answerKind?: unknown
  providerDiagnostic?: {
    category?: unknown
    httpStatus?: unknown
    reason?: unknown
  }
}

export interface TraceSummary {
  traceCount: number
  status: Record<string, number>
  pipelineVersion: Record<string, number>
  answerKind: Record<string, number>
  providerFailures: Record<string, number>
  topValidationErrors: Array<{ error: string; count: number }>
  models: Record<string, number>
  modelCalls: Record<string, number>
  durationMs: { median: number | null; p90: number | null; max: number | null }
}

function increment(record: Record<string, number>, key: string): void {
  record[key] = (record[key] ?? 0) + 1
}

function percentile(sorted: number[], fraction: number): number | null {
  if (sorted.length === 0) return null
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(fraction * sorted.length) - 1))
  return sorted[index]
}

/**
 * 把同類驗證錯誤歸成一組：去掉 C1/K2/E3 這類編號、引號內的著法或文字與數字，
 * 讓「第 3 段缺少…」與「第 4 段缺少…」計入同一類。
 */
export function normalizeValidationError(error: string): string {
  return error
    .replace(/\b[CKEF][QD]?\d+\b/g, '#')
    .replace(/[「『"“][^」』"”]{0,40}[」』"”]/g, '「…」')
    .replace(/\d+(?:\.\d+)?/g, 'N')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 160)
}

export function summarizeTraces(exported: unknown): TraceSummary {
  const traces: TraceLike[] = Array.isArray(exported)
    ? (exported as TraceLike[])
    : Array.isArray((exported as { traces?: unknown } | null)?.traces)
      ? ((exported as { traces: TraceLike[] }).traces)
      : []
  const summary: TraceSummary = {
    traceCount: traces.length,
    status: {},
    pipelineVersion: {},
    answerKind: {},
    providerFailures: {},
    topValidationErrors: [],
    models: {},
    modelCalls: {},
    durationMs: { median: null, p90: null, max: null }
  }
  const errorCounts = new Map<string, number>()
  const durations: number[] = []
  for (const trace of traces) {
    if (!trace || typeof trace !== 'object') continue
    increment(summary.status, typeof trace.status === 'string' ? trace.status : 'unknown')
    increment(
      summary.pipelineVersion,
      typeof trace.pipelineVersion === 'number' ? `v${trace.pipelineVersion}` : 'v1'
    )
    if (typeof trace.answerKind === 'string') increment(summary.answerKind, trace.answerKind)
    if (typeof trace.model === 'string') increment(summary.models, trace.model)
    if (typeof trace.modelCalls === 'number') {
      increment(summary.modelCalls, String(trace.modelCalls))
    }
    if (typeof trace.durationMs === 'number' && Number.isFinite(trace.durationMs)) {
      durations.push(trace.durationMs)
    }
    const diagnostic = trace.providerDiagnostic
    if (diagnostic && typeof diagnostic === 'object') {
      const parts = [
        typeof diagnostic.category === 'string' ? diagnostic.category : 'unknown',
        typeof diagnostic.httpStatus === 'number' ? `HTTP ${diagnostic.httpStatus}` : null,
        typeof diagnostic.reason === 'string' ? diagnostic.reason : null
      ].filter(Boolean)
      increment(summary.providerFailures, parts.join(' / '))
    }
    if (Array.isArray(trace.validationErrors)) {
      // 同一則 trace 內重複的錯誤只算一次，避免修正迴圈把同一問題放大。
      const unique = new Set(
        trace.validationErrors
          .filter((error): error is string => typeof error === 'string')
          .map(normalizeValidationError)
      )
      for (const error of unique) errorCounts.set(error, (errorCounts.get(error) ?? 0) + 1)
    }
  }
  summary.topValidationErrors = [...errorCounts.entries()]
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .slice(0, 15)
    .map(([error, count]) => ({ error, count }))
  durations.sort((left, right) => left - right)
  summary.durationMs = {
    median: percentile(durations, 0.5),
    p90: percentile(durations, 0.9),
    max: durations.at(-1) ?? null
  }
  return summary
}

export function formatTraceSummary(summary: TraceSummary): string {
  const block = (title: string, record: Record<string, number>): string[] => [
    `## ${title}`,
    ...Object.entries(record)
      .sort((left, right) => right[1] - left[1])
      .map(([key, count]) => `- ${key}: ${count}`),
    ''
  ]
  return [
    `# Harness 診斷統計（${summary.traceCount} 則）`,
    '',
    ...block('狀態', summary.status),
    ...block('管線版本', summary.pipelineVersion),
    ...(Object.keys(summary.answerKind).length ? block('交付種類', summary.answerKind) : []),
    ...block('服務端失敗分類', summary.providerFailures),
    '## 驗證錯誤前 15 名',
    ...summary.topValidationErrors.map((item) => `- (${item.count}) ${item.error}`),
    '',
    ...block('模型', summary.models),
    ...block('每題模型呼叫次數', summary.modelCalls),
    '## 耗時（毫秒）',
    `- 中位數：${summary.durationMs.median ?? '—'}`,
    `- P90：${summary.durationMs.p90 ?? '—'}`,
    `- 最大：${summary.durationMs.max ?? '—'}`,
    ''
  ].join('\n')
}

function main(): void {
  const input = process.argv[2]
  if (!input) {
    console.error('用法：summarize-traces.ts <匯出的診斷紀錄.json>')
    process.exitCode = 1
    return
  }
  const parsed: unknown = JSON.parse(readFileSync(resolve(input), 'utf8'))
  console.log(formatTraceSummary(summarizeTraces(parsed)))
}

const invokedDirectly =
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
if (invokedDirectly) main()
