/**
 * v2 解說管線 live 驗收與人工評分表（P3-9；不納入 npm test）。
 *
 * 用固定的 10 個局面（tests/fixtures/explain-v2/cases.json，不需要引擎）實際呼叫 OpenRouter，
 * 輸出 Markdown 評分表到 .local-review/，由人評：棋理正確、有回答到問題、好懂、沒有廢話（各 1–5）。
 *
 * 用法（PowerShell）：
 *   $env:OPENROUTER_API_KEY="…"
 *   npx tsx --tsconfig tsconfig.node.json tools/acceptance/explain-v2-live.ts --models vendor/a:free --out v2-review.md
 * 選項：--models（最多 3 個 :free）、--backup（最多 2 個 :free 備援）、--cases id1,id2、--base-url（測試用）。
 *
 * 額度提醒：每題一般 1 次呼叫、最多 3 次；10 題 × 1 個模型約 10–30 次請求。
 * 未儲值的 OpenRouter 帳號每日約 50 次免費請求（依官方現行政策）。
 * 安全：金鑰只從環境變數讀取，不寫入任何輸出；輸出含回答原文，只寫入已 gitignore 的 .local-review/。
 */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { OpenRouterProvider } from '../../src/main/ai/providers/OpenRouterProvider'
import { runExplainPipelineV2 } from '../../src/main/ai/explain/ExplainPipelineV2'
import { prepareExplanationExecution } from '../../src/main/ai/prepareExplanationExecution'
import { TeacherTestRunService } from '../../src/main/teacherTest/TeacherTestRunService'
import { compareMove } from '../../src/shared/logic/analysis/MoveComparisonService'
import type { ExplanationLanguage } from '../../src/shared/types/AIExplanationTypes'
import type { AIProvider } from '../../src/shared/types/AIProviderTypes'
import type { EngineAnalysis } from '../../src/shared/types/EngineAnalysis'
import type { HarnessTrace } from '../../src/shared/types/Harness'
import type { AnalysisSession } from '../../src/main/storage/AnalysisSessionStore'
import { resolveLocalReviewPath } from './openrouter-smoke'

export interface LiveCase {
  id: string
  mode: 'move' | 'position' | 'question'
  language: ExplanationLanguage
  question?: string
  userMoveReason?: string
  analysis: EngineAnalysis
}

export interface LiveRow {
  caseId: string
  model: string
  answerKind: string
  actualModel: string
  calls: number
  durationMs: number
  firstTokenMs: number | null
  repairUsed: boolean
  fallback: string
  hardErrors: string[]
  softWarnings: string[]
  answer: string
  error: string | null
}

const MAX_MODELS = 3
const DEFAULT_SPACING_MS = 3_500

const teacherRun = new TeacherTestRunService({
  getRuntime: () => ({ appVersion: 'acceptance', platform: 'win32', systemVersion: '', osBuild: '', arch: 'x64' })
})

export function loadLiveCases(): LiveCase[] {
  const path = resolve(dirname(fileURLToPath(import.meta.url)), '../../tests/fixtures/explain-v2/cases.json')
  return JSON.parse(readFileSync(path, 'utf8')) as LiveCase[]
}

function sessionFor(fixture: LiveCase): AnalysisSession {
  return {
    analysisId: `live-${fixture.id}`,
    requestId: `live-engine-${fixture.id}`,
    createdAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
    positionFen: fixture.analysis.positionFen,
    ...(fixture.analysis.userMove ? { userMove: fixture.analysis.userMove } : {}),
    primaryEngineId: 'fixture-engine',
    engineAnalysis: fixture.analysis,
    moveComparison: compareMove(fixture.analysis)
  }
}

export async function runLiveCase(
  fixture: LiveCase,
  model: string,
  deps: { provider: AIProvider; apiKey: string; backupModels?: string[] }
): Promise<LiveRow> {
  const traces: HarnessTrace[] = []
  const started = Date.now()
  let firstTokenMs: number | null = null
  const execution = prepareExplanationExecution(
    {
      requestId: `live-${fixture.id}-${started}`,
      analysisId: `live-${fixture.id}`,
      provider: 'openrouter',
      model,
      userLevel: 'basic',
      explanationStyle: 'long_analytical',
      language: fixture.language,
      ...(fixture.question ? { followUpQuestion: fixture.question } : {}),
      ...(fixture.analysis.userMove ? { attachedMove: fixture.analysis.userMove } : {}),
      ...(fixture.userMoveReason ? { userMoveReason: fixture.userMoveReason } : {})
    },
    sessionFor(fixture),
    model,
    teacherRun
  )
  try {
    const result = await runExplainPipelineV2(execution, {
      provider: deps.provider,
      apiKey: deps.apiKey,
      registry: { list: () => ({ installations: [], activeEngineId: null, verificationEngineId: null }), getAdapter: () => null } as never,
      traceStore: { save: (trace: HarnessTrace) => traces.push(trace) } as never,
      signal: new AbortController().signal,
      onProgress: () => undefined,
      onDelta: () => {
        if (firstTokenMs === null) firstTokenMs = Date.now() - started
      },
      backupModels: deps.backupModels
    })
    const trace = traces.at(-1)
    return {
      caseId: fixture.id,
      model,
      answerKind: result.answerKind,
      actualModel: result.actualModel ?? '',
      calls: trace?.modelCalls ?? 0,
      durationMs: Date.now() - started,
      firstTokenMs,
      repairUsed: result.repairUsed,
      fallback: result.fallbackFromModel ? `${result.fallbackFromModel} → ${result.actualModel}（${result.fallbackReason}）` : '',
      hardErrors: trace?.hardErrors ?? [],
      softWarnings: trace?.softWarnings ?? [],
      answer: result.finalText,
      error: null
    }
  } catch (error) {
    const trace = traces.at(-1)
    return {
      caseId: fixture.id,
      model,
      answerKind: 'error',
      actualModel: '',
      calls: trace?.modelCalls ?? 0,
      durationMs: Date.now() - started,
      firstTokenMs,
      repairUsed: false,
      fallback: '',
      hardErrors: [],
      softWarnings: [],
      answer: '',
      error: trace?.providerDiagnostic
        ? `${trace.providerDiagnostic.category}${trace.providerDiagnostic.httpStatus ? ` HTTP ${trace.providerDiagnostic.httpStatus}` : ''}`
        : error instanceof Error ? error.name : 'unknown'
    }
  }
}

function median(values: number[]): number | null {
  if (values.length === 0) return null
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.floor((sorted.length - 1) / 2)]
}

/** 驗收門檻（計畫第 7 節「驗收標準」）的自動部分＋人工評分欄位。 */
export function formatLiveReport(rows: LiveRow[]): string {
  const delivered = rows.filter((row) => row.answerKind !== 'error' && row.durationMs <= 110_000)
  const aiRows = rows.filter((row) => row.answerKind === 'ai')
  const modelRows = rows.filter((row) => row.answerKind !== 'board_rule')
  const leaks = rows.filter((row) => /(?<![A-Za-z0-9])[a-i][0-9][a-i][0-9](?![A-Za-z0-9])|```|<think>/.test(row.answer))
  const pct = (part: number, total: number): string => (total === 0 ? '—' : `${Math.round((part / total) * 100)}%`)
  const lines = [
    '# v2 解說 live 驗收',
    '',
    `產生時間：${new Date().toISOString()}`,
    '',
    '## 自動指標（門檻見計畫第 7 節「驗收標準」）',
    `- 交付率（AI 或摘要，110 秒內）：${pct(delivered.length, rows.length)}（門檻 ≥95%）`,
    `- AI 答案比例（不含棋規捷徑）：${pct(aiRows.length, modelRows.length)}（門檻 ≥80%）`,
    `- 每題呼叫中位數：${median(modelRows.map((row) => row.calls)) ?? '—'}；最大：${Math.max(0, ...modelRows.map((row) => row.calls))}（門檻：中位數 1、上限 3）`,
    `- 外洩內部格式：${leaks.length} 則（門檻 0）`,
    `- 首字中位數：${median(rows.flatMap((row) => (row.firstTokenMs === null ? [] : [row.firstTokenMs]))) ?? '—'} ms；完成中位數：${median(rows.map((row) => row.durationMs)) ?? '—'} ms`,
    '',
    '## 人工評分（每格 1–5；「≥4 分佔 ≥70%」為上線門檻）',
    '',
    '| 局面 | 模型 | 交付 | 呼叫 | 秒 | 棋理正確 | 有回答到問題 | 好懂 | 沒有廢話 | 備註 |',
    '|---|---|---|---|---|---|---|---|---|---|',
    ...rows.map(
      (row) =>
        `| ${row.caseId} | ${row.actualModel || row.model} | ${row.answerKind}${row.repairUsed ? '（修正）' : ''}${row.error ? `：${row.error}` : ''} | ${row.calls} | ${(row.durationMs / 1000).toFixed(1)} |  |  |  |  |  |`
    ),
    '',
    '## 回答全文',
    ''
  ]
  for (const row of rows) {
    lines.push(`### ${row.caseId} · ${row.model}`)
    if (row.fallback) lines.push(`備援：${row.fallback}`)
    if (row.hardErrors.length) lines.push(`首輪硬錯：${row.hardErrors.join('；')}`)
    if (row.softWarnings.length) lines.push(`軟警告：${row.softWarnings.join('；')}`)
    lines.push('', row.error ? `（失敗：${row.error}）` : row.answer, '')
  }
  return lines.join('\n')
}

function argValue(argv: string[], name: string): string | undefined {
  const index = argv.indexOf(name)
  return index >= 0 ? argv[index + 1] : undefined
}

function list(value: string | undefined): string[] {
  return (value ?? '').split(',').map((item) => item.trim()).filter(Boolean)
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2)
  const apiKey = process.env.OPENROUTER_API_KEY?.trim()
  if (!apiKey) {
    console.error('請先設定環境變數 OPENROUTER_API_KEY（不要把金鑰寫進檔案）。')
    process.exitCode = 1
    return
  }
  const models = list(argValue(argv, '--models')).slice(0, MAX_MODELS)
  const backupModels = list(argValue(argv, '--backup')).slice(0, 2)
  if (models.length === 0 || [...models, ...backupModels].some((model) => !model.endsWith(':free'))) {
    console.error('請用 --models 指定 1–3 個 :free 模型（備援也必須是 :free）。')
    process.exitCode = 1
    return
  }
  const wanted = new Set(list(argValue(argv, '--cases')))
  const cases = loadLiveCases().filter((item) => wanted.size === 0 || wanted.has(item.id))
  const provider = new OpenRouterProvider({ baseUrl: argValue(argv, '--base-url') })
  const spacingMs = Number(argValue(argv, '--spacing-ms') ?? DEFAULT_SPACING_MS)
  console.log(`將執行 ${cases.length} 題 × ${models.length} 個模型（每題一般 1 次、最多 3 次請求）。`)
  const rows: LiveRow[] = []
  for (const model of models) {
    for (const fixture of cases) {
      if (rows.length > 0 && spacingMs > 0) await new Promise((done) => setTimeout(done, spacingMs))
      const row = await runLiveCase(fixture, model, { provider, apiKey, backupModels })
      rows.push(row)
      console.log(`${fixture.id} · ${model}: ${row.answerKind}${row.error ? ` (${row.error})` : ''} · ${row.calls} calls · ${(row.durationMs / 1000).toFixed(1)}s`)
    }
  }
  const out = resolveLocalReviewPath(argValue(argv, '--out') ?? `explain-v2-live-${Date.now()}.md`)
  mkdirSync(dirname(out), { recursive: true })
  writeFileSync(out, `${formatLiveReport(rows)}\n`)
  console.log(`評分表已寫入 ${out}`)
}

const invokedDirectly =
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
if (invokedDirectly) {
  main().catch((error: unknown) => {
    console.error('live 驗收失敗：', error instanceof Error ? error.name : 'unknown')
    process.exitCode = 1
  })
}
