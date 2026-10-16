/**
 * v2 解說管線 live 驗收與人工評分表（P3-9；不納入 npm test）。
 *
 * 用固定的 10 個局面（tests/fixtures/explain-v2/cases.json，不需要引擎）實際呼叫 OpenRouter，
 * 輸出 Markdown 評分表到 .local-review/，由人評：棋理正確、有回答到問題、好懂、沒有廢話（各 1–5）。
 *
 * 用法（PowerShell）：
 *   $env:OPENROUTER_API_KEY="…"
 *   npx tsx --tsconfig tsconfig.node.json tools/acceptance/explain-v2-live.ts --models vendor/a:free --out v2-review.md
 * 選項：--models（最多 3 個 :free）、--backup（最多 2 個 :free 備援）、--cases id1,id2、--set tuning|holdout、--base-url（測試用）、
 *   --spacing-ms（題目間隔）、--allow-paid（允許非 :free 模型，會向 OpenRouter 帳戶計費；
 *   付費輪只用來看解說品質，不能代表免費模型的交付率）、--provider gemini（改用 Gemini，
 *   金鑰從 GEMINI_API_KEY 讀；模型例如 gemini-3.5-flash，不需要 :free）。
 *
 * 額度提醒：每題一般 1 次呼叫、最多 3 次；10 題 × 1 個模型約 10–30 次請求。
 * 未儲值的 OpenRouter 帳號每日約 50 次免費請求（依官方現行政策）。
 * 安全：金鑰只從環境變數讀取，不寫入任何輸出；輸出含回答原文，只寫入已 gitignore 的 .local-review/。
 */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { OpenRouterProvider } from '../../src/main/ai/providers/OpenRouterProvider'
import { GeminiProvider } from '../../src/main/ai/providers/GeminiProvider'
import { runExplainPipelineV2 } from '../../src/main/ai/explain/ExplainPipelineV2'
import { prepareExplanationExecution } from '../../src/main/ai/prepareExplanationExecution'
import { compareMove } from '../../src/shared/logic/analysis/MoveComparisonService'
import type { ExplanationLanguage } from '../../src/shared/types/AIExplanationTypes'
import type { AIProvider } from '../../src/shared/types/AIProviderTypes'
import type { EngineAnalysis } from '../../src/shared/types/EngineAnalysis'
import type { HarnessTrace } from '../../src/shared/types/Harness'
import type { AnalysisSession } from '../../src/main/storage/AnalysisSessionStore'
import { resolveLocalReviewPath } from './openrouter-smoke'
import { trustSystemCertificates } from '../../src/main/security/SystemCertificates'

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
  /** 最後一輪（修正後）的硬錯。 */
  hardErrors: string[]
  /** 有修正時，修正前那一輪的硬錯。 */
  firstHardErrors?: string[]
  softWarnings: string[]
  answer: string
  error: string | null
  /** 每次模型呼叫的種類、秒數與失敗分類（network 會附底層代碼）；不含任何原文。 */
  attemptLog: string[]
}

const MAX_MODELS = 3

/** 只有 network 會附上底層代碼；沒有代碼代表錯誤不是來自連線層（可能是程式錯誤）。 */
function describeFailure(category: string, httpStatus: number | undefined, networkCode: string | undefined): string {
  if (category === 'network') return `network（${networkCode ?? '無底層代碼'}）`
  return `${category}${httpStatus ? ` HTTP ${httpStatus}` : ''}`
}

function attemptLogFor(trace: HarnessTrace | undefined): string[] {
  return (trace?.attempts ?? []).map(
    (attempt) =>
      `${attempt.kind} ${(attempt.durationMs / 1000).toFixed(1)}s ${
        attempt.error ? describeFailure(attempt.error, undefined, attempt.networkCode) : 'ok'
      }`
  )
}

/**
 * 備援那一行：主模型失敗的原因、改用哪個備援、備援結果。
 * 交付摘要時 actualModel 沒有值，不能直接印（之前會出現「→ undefined」）；
 * 摘要開頭的原因是「最後一次」失敗（通常是備援的），和這裡的主模型原因不同。
 */
function describeFallback(
  result: { fallbackFromModel?: string; fallbackReason?: string; actualModel?: string; answerKind: string },
  backupModels: string[]
): string {
  if (!result.fallbackFromModel) return ''
  const backup = result.actualModel ?? backupModels.find((model) => model !== result.fallbackFromModel) ?? '備援模型'
  const outcome = result.answerKind === 'ai' ? '由備援回答' : '備援也沒有交出可用答案，改交引擎摘要'
  return `主模型 ${result.fallbackFromModel} 失敗（${result.fallbackReason ?? '原因不明'}）→ 改用 ${backup}：${outcome}`
}

/** 預設只允許 :free；--allow-paid 才放行付費模型（會計費）。回傳錯誤訊息或 null。 */
export function validateModelArgs(models: string[], backupModels: string[], allowPaid: boolean): string | null {
  if (models.length === 0) return '請用 --models 指定 1–3 個模型。'
  if (!allowPaid && [...models, ...backupModels].some((model) => !model.endsWith(':free'))) {
    return '預設只允許 :free 模型（備援也是）；要測付費模型請加 --allow-paid，費用會記在 OpenRouter 帳戶。'
  }
  return null
}
const DEFAULT_SPACING_MS = 3_500

/**
 * 題組：tuning＝調整 v2 時用的 10 個固定局面；holdout＝從 PlayOK 對局的 Pikafish 分析挑出、
 * 從未用來調整的 10 題（tools/acceptance/build-holdout-cases.ts 產生），用來確認改進不是只對固定題有效。
 */
export type LiveCaseSet = 'tuning' | 'holdout'

export function loadLiveCases(set: LiveCaseSet = 'tuning'): LiveCase[] {
  const file = set === 'holdout' ? 'holdout-cases.json' : 'cases.json'
  const path = resolve(dirname(fileURLToPath(import.meta.url)), `../../tests/fixtures/explain-v2/${file}`)
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
  deps: { provider: AIProvider; apiKey: string; backupModels?: string[]; providerId?: 'openrouter' | 'gemini' }
): Promise<LiveRow> {
  const traces: HarnessTrace[] = []
  const started = Date.now()
  let firstTokenMs: number | null = null
  const execution = prepareExplanationExecution(
    {
      requestId: `live-${fixture.id}-${started}`,
      analysisId: `live-${fixture.id}`,
      provider: deps.providerId ?? 'openrouter',
      model,
      userLevel: 'basic',
      explanationStyle: 'long_analytical',
      language: fixture.language,
      ...(fixture.question ? { followUpQuestion: fixture.question } : {}),
      ...(fixture.analysis.userMove ? { attachedMove: fixture.analysis.userMove } : {}),
      ...(fixture.userMoveReason ? { userMoveReason: fixture.userMoveReason } : {})
    },
    sessionFor(fixture),
    model
  )
  try {
    const result = await runExplainPipelineV2(execution, {
      provider: deps.provider,
      apiKey: deps.apiKey,
      registry: { list: () => ({ installations: [], activeEngineId: null }), getAdapter: () => null } as never,
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
      fallback: describeFallback(result, deps.backupModels ?? []),
      hardErrors: trace?.hardErrors ?? [],
      ...(trace?.firstHardErrors ? { firstHardErrors: trace.firstHardErrors } : {}),
      softWarnings: trace?.softWarnings ?? [],
      answer: result.finalText,
      error: null,
      attemptLog: attemptLogFor(trace)
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
        ? describeFailure(
            trace.providerDiagnostic.category,
            trace.providerDiagnostic.httpStatus,
            trace.providerDiagnostic.networkCode
          )
        : error instanceof Error ? error.name : 'unknown',
      attemptLog: attemptLogFor(trace)
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
  // Gemini 模型沒有 :free 後綴，免費與否看金鑰方案，不標成付費輪。
  const paidModels = [...new Set(rows.map((row) => row.model).filter((model) => !model.endsWith(':free') && !model.startsWith('gemini-')))]
  const lines = [
    '# v2 解說 live 驗收',
    '',
    `產生時間：${new Date().toISOString()}`,
    '',
    ...(paidModels.length > 0
      ? [
          `> ⚠ 本輪含付費模型（${paidModels.join('、')}）：結果只代表解說品質，不能代表免費模型的交付率與 AI 答案比例。`,
          ''
        ]
      : []),
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
    if (row.attemptLog.length) lines.push(`呼叫紀錄：${row.attemptLog.join(' → ')}`)
    if (row.fallback) lines.push(`備援：${row.fallback}`)
    const firstRound = row.firstHardErrors ?? row.hardErrors
    if (firstRound.length) lines.push(`首輪硬錯：${firstRound.join('；')}`)
    if (row.firstHardErrors && row.hardErrors.length) lines.push(`修正後仍有硬錯：${row.hardErrors.join('；')}`)
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
  // 與 App 相同：信任系統根憑證，防毒軟體攔截 HTTPS 時才不會整輪失敗。
  const certificates = trustSystemCertificates()
  if (!certificates.ok) console.log('注意：讀不到系統根憑證，只使用 Node 內建清單。')
  const providerId: 'openrouter' | 'gemini' = argValue(argv, '--provider') === 'gemini' ? 'gemini' : 'openrouter'
  const keyName = providerId === 'gemini' ? 'GEMINI_API_KEY' : 'OPENROUTER_API_KEY'
  const apiKey = process.env[keyName]?.trim()
  if (!apiKey) {
    console.error(`請先設定環境變數 ${keyName}（不要把金鑰寫進檔案）。`)
    process.exitCode = 1
    return
  }
  const models = list(argValue(argv, '--models')).slice(0, MAX_MODELS)
  const backupModels = list(argValue(argv, '--backup')).slice(0, 2)
  // Gemini 沒有 :free 後綴（免費與否由金鑰的方案決定），也沒有 OpenRouter 的備援模型。
  const allowPaid = argv.includes('--allow-paid') || providerId === 'gemini'
  const invalid = validateModelArgs(models, providerId === 'gemini' ? [] : backupModels, allowPaid)
  if (invalid) {
    console.error(invalid)
    process.exitCode = 1
    return
  }
  if (providerId === 'openrouter' && allowPaid && [...models, ...backupModels].some((model) => !model.endsWith(':free'))) {
    console.log('注意：本輪包含付費模型，費用會記在 OpenRouter 帳戶。')
  }
  const wanted = new Set(list(argValue(argv, '--cases')))
  const set: LiveCaseSet = argValue(argv, '--set') === 'holdout' ? 'holdout' : 'tuning'
  const cases = loadLiveCases(set).filter((item) => wanted.size === 0 || wanted.has(item.id))
  const provider =
    providerId === 'gemini'
      ? new GeminiProvider({ baseUrl: argValue(argv, '--base-url') })
      : new OpenRouterProvider({ baseUrl: argValue(argv, '--base-url') })
  const spacingMs = Number(argValue(argv, '--spacing-ms') ?? DEFAULT_SPACING_MS)
  console.log(`題組：${set === 'holdout' ? '保留驗證集（PlayOK 實戰局面）' : '固定調整題'}`)
  console.log(`將執行 ${cases.length} 題 × ${models.length} 個模型（每題一般 1 次、最多 3 次請求）。`)
  const rows: LiveRow[] = []
  for (const model of models) {
    for (const fixture of cases) {
      if (rows.length > 0 && spacingMs > 0) await new Promise((done) => setTimeout(done, spacingMs))
      const row = await runLiveCase(fixture, model, {
        provider,
        apiKey,
        providerId,
        backupModels: providerId === 'gemini' ? [] : backupModels
      })
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
