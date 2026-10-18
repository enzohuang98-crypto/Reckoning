import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { runExplainPipelineV2, type ExplainPipelineDeps } from '../../../src/main/ai/explain/ExplainPipelineV2'
import { prepareExplanationExecution } from '../../../src/main/ai/prepareExplanationExecution'
import { AIHttpError, AIResponseValidationError } from '../../../src/main/ai/http'
import { checkAnswer } from '../../../src/shared/logic/ai/AnswerCheck'
import { buildExplanationFacts } from '../../../src/shared/logic/analysis/ExplanationFacts'
import { compareMove } from '../../../src/shared/logic/analysis/MoveComparisonService'
import type { AIExplanationRequest, ExplanationLanguage } from '../../../src/shared/types/AIExplanationTypes'
import type { AIExplanationStreamChunk, AIProvider } from '../../../src/shared/types/AIProviderTypes'
import type { EngineAnalysis } from '../../../src/shared/types/EngineAnalysis'
import type { HarnessTrace } from '../../../src/shared/types/Harness'
import type { AnalysisSession } from '../../../src/main/storage/AnalysisSessionStore'

interface FixtureCase {
  id: string
  mode: 'move' | 'position' | 'question'
  language: ExplanationLanguage
  question?: string
  userMoveReason?: string
  analysis: EngineAnalysis
  goodAnswer?: string
}

const cases = JSON.parse(
  readFileSync(new URL('../../fixtures/explain-v2/cases.json', import.meta.url), 'utf8')
) as FixtureCase[]

type Step =
  | { text: string; finishReason?: string; reasoningTokens?: number }
  | { error: unknown; partial?: string }
  | { hang: true }

class ScriptedProvider implements AIProvider {
  readonly id = 'openrouter' as const
  readonly displayName = 'Scripted'
  requests: AIExplanationRequest[] = []
  constructor(private readonly steps: Step[]) {}

  async generateExplanation(): Promise<never> {
    throw new Error('v2 must use the stream interface')
  }

  async *generateExplanationStream(
    request: AIExplanationRequest,
    signal: AbortSignal
  ): AsyncIterable<AIExplanationStreamChunk> {
    this.requests.push(request)
    const step = this.steps[this.requests.length - 1]
    if (!step) throw new Error(`unexpected call ${this.requests.length}`)
    if ('hang' in step) {
      await new Promise<never>((_, reject) =>
        signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')), { once: true })
      )
      return
    }
    if ('error' in step) {
      if (step.partial) yield { type: 'text_delta', deltaText: step.partial }
      throw step.error
    }
    const half = Math.ceil(step.text.length / 2)
    yield { type: 'text_delta', deltaText: step.text.slice(0, half) }
    yield { type: 'text_delta', deltaText: step.text.slice(half) }
    yield {
      type: 'done',
      finishReason: step.finishReason ?? 'stop',
      usage: { inputTokens: 100, outputTokens: 50, ...(step.reasoningTokens !== undefined ? { reasoningTokens: step.reasoningTokens } : {}) }
    }
  }

  async listModels(): Promise<string[]> {
    return []
  }

  async testCredential() {
    return { ok: true, message: 'ok' }
  }
}

function sessionFor(fixture: FixtureCase): AnalysisSession {
  return {
    analysisId: `analysis-${fixture.id}`,
    requestId: `engine-${fixture.id}`,
    createdAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
    positionFen: fixture.analysis.positionFen,
    ...(fixture.analysis.userMove ? { userMove: fixture.analysis.userMove } : {}),
    primaryEngineId: 'engine-1',
    engineAnalysis: fixture.analysis,
    moveComparison: compareMove(fixture.analysis)
  }
}

interface RunOptions {
  backupModels?: string[]
  /** 假引擎（只需要 probeIdeas）；預設沒有引擎。 */
  adapter?: unknown
  timing?: ExplainPipelineDeps['timing']
}

async function run(fixture: FixtureCase, steps: Step[], options: RunOptions = {}) {
  const provider = new ScriptedProvider(steps)
  const traces: HarnessTrace[] = []
  const deltas: Array<{ text: string; attempt: number }> = []
  const progress: string[] = []
  const execution = prepareExplanationExecution(
    {
      requestId: `ai-${fixture.id}`,
      analysisId: `analysis-${fixture.id}`,
      provider: 'openrouter',
      model: 'vendor/primary:free',
      userLevel: 'basic',
      explanationStyle: 'long_analytical',
      language: fixture.language,
      ...(fixture.question ? { followUpQuestion: fixture.question } : {}),
      ...(fixture.analysis.userMove ? { attachedMove: fixture.analysis.userMove } : {}),
      ...(fixture.userMoveReason ? { userMoveReason: fixture.userMoveReason } : {})
    },
    sessionFor(fixture),
    'vendor/primary:free'
  )
  let error: unknown = null
  let result = null as Awaited<ReturnType<typeof runExplainPipelineV2>> | null
  try {
    result = await runExplainPipelineV2(execution, {
      provider,
      apiKey: 'synthetic',
      registry: {
        list: () => ({ installations: [], activeEngineId: 'engine-1' }),
        getAdapter: () => options.adapter ?? null
      } as never,
      traceStore: { save: (trace: HarnessTrace) => traces.push(trace) } as never,
      signal: new AbortController().signal,
      onProgress: (payload) => progress.push(payload.message),
      onDelta: (text, attempt) => deltas.push({ text, attempt }),
      backupModels: options.backupModels,
      timing: options.timing
    })
  } catch (caught) {
    error = caught
  }
  return { provider, traces, deltas, progress, result, error }
}

const byId = (id: string): FixtureCase => {
  const found = cases.find((item) => item.id === id)
  assert.ok(found, id)
  return found
}

async function main(): Promise<void> {
  assert.equal(cases.length, 10)

  // 每個有 AI 回答的局面：好答案一次通過、呼叫 1 次、system＋純文字請求。
  for (const fixture of cases.filter((item) => item.goodAnswer)) {
    const facts = buildExplanationFacts(fixture.analysis, fixture.analysis.userMove ? compareMove(fixture.analysis) : null)
    const precheck = checkAnswer({
      text: fixture.goodAnswer!,
      mode: fixture.mode,
      language: fixture.language,
      facts,
      userText: [fixture.question ?? '', fixture.userMoveReason ?? ''].join('\n')
    })
    assert.deepEqual(precheck.hardErrors, [], `${fixture.id} good answer must pass: ${JSON.stringify(precheck.hardErrors)}`)
    const outcome = await run(fixture, [{ text: fixture.goodAnswer! }])
    assert.equal(outcome.error, null, `${fixture.id}: ${String(outcome.error)}`)
    assert.equal(outcome.result?.answerKind, 'ai', fixture.id)
    assert.equal(outcome.result?.finalText, fixture.goodAnswer!.trim())
    assert.equal(outcome.result?.actualModel, 'vendor/primary:free')
    assert.equal(outcome.provider.requests.length, 1, `${fixture.id} uses one call`)
    const request = outcome.provider.requests[0]
    assert.ok(request.systemPrompt && request.systemPrompt.length > 0)
    assert.equal(request.responseFormat, 'text')
    assert.equal(/h2e2|b0c2|score cp/.test(request.prompt), false, `${fixture.id} prompt leaks raw data`)
    assert.equal(outcome.deltas.map((delta) => delta.text).join(''), fixture.goodAnswer)
    const trace = outcome.traces.at(-1)!
    assert.equal(trace.pipelineVersion, 2)
    assert.equal(trace.answerKind, 'ai')
    assert.equal(trace.modelCalls, 1)
    assert.equal(trace.status, 'completed')
  }
  console.log('golden set: every good answer is delivered with one call')

  // 棋規問題直接回答，不叫模型。
  const rule = await run(byId('rule-question'), [])
  assert.equal(rule.result?.answerKind, 'board_rule')
  assert.match(rule.result?.finalText ?? '', /尚未過河/)
  assert.equal(rule.provider.requests.length, 0)

  const opening = byId('opening-inaccuracy')
  const invented = '**結論**：應該走車一平二。\n**這步的問題**：馬八進七太慢，炮二平五吃掉中卒。'

  // 壞答案 → 自動修正一次 → 交付修正後的 AI 回答。
  const repaired = await run(opening, [{ text: invented }, { text: opening.goodAnswer! }])
  assert.equal(repaired.result?.answerKind, 'ai')
  assert.equal(repaired.result?.repairUsed, true)
  assert.equal(repaired.provider.requests.length, 2)
  assert.match(repaired.provider.requests[1].prompt, /車一平二/)
  assert.match(repaired.provider.requests[1].prompt, /沒有吃子/)
  assert.deepEqual([...new Set(repaired.deltas.map((delta) => delta.attempt))], [1, 2], 'repair streams as attempt 2')

  // 連續兩次壞答案 → 引擎重點摘要（非 AI），不再呼叫第三次。
  const summary = await run(opening, [{ text: invented }, { text: invented }])
  assert.equal(summary.result?.answerKind, 'engine_summary')
  assert.match(summary.result?.finalText ?? '', /引擎重點摘要（非 AI 生成）/)
  assert.match(summary.result?.finalText ?? '', /回答與引擎事實不符/)
  assert.match(summary.result?.finalText ?? '', /回答與引擎事實不符（H\d：[^）]+）/, 'the summary names which check failed')
  assert.equal(summary.provider.requests.length, 2)
  assert.equal(summary.traces.at(-1)?.answerKind, 'engine_summary')
  assert.ok((summary.traces.at(-1)?.hardErrors?.length ?? 0) > 0)

  // 修正前後的硬錯分開記錄（修正前在 firstHardErrors）。
  assert.ok((summary.traces.at(-1)?.firstHardErrors?.length ?? 0) > 0)

  // 提示標籤與混用數字的著法在檢查前就修整掉：內容正確的回答一次就交付，不浪費修正。
  const labelled = `根據事實表，${opening.goodAnswer!.replace('馬8進7', '馬8進七')}`
  const tidiedRun = await run(opening, [{ text: labelled }])
  assert.equal(tidiedRun.result?.answerKind, 'ai')
  assert.equal(tidiedRun.provider.requests.length, 1)
  assert.equal(tidiedRun.result?.finalText.includes('事實表'), false)
  assert.ok(tidiedRun.result?.finalText.startsWith('根據引擎資料，'))
  assert.equal(tidiedRun.result?.finalText.includes('馬8進七'), false)

  // 修正後只剩「不存在的著法」：摘要說明真正的原因，不再一律寫「與引擎事實不符」。
  const unknownMove = '**結論**：應該走車一平二。\n**這步的問題**：馬八進七太慢，沒有搶到中路。'
  const unknownSummary = await run(opening, [{ text: unknownMove }, { text: unknownMove }])
  assert.equal(unknownSummary.result?.answerKind, 'engine_summary')
  assert.match(unknownSummary.result?.finalText ?? '', /回答提到引擎資料以外的著法/)

  // 每分鐘限流 → 備援模型一次並標示。
  const minute = new AIHttpError(429, 'generation', 'rate limited', 5_000, 'minute')
  const backup = await run(opening, [{ error: minute }, { text: opening.goodAnswer! }], { backupModels: ['vendor/backup:free'] })
  assert.equal(backup.result?.answerKind, 'ai')
  assert.equal(backup.result?.actualModel, 'vendor/backup:free')
  assert.equal(backup.result?.fallbackFromModel, 'vendor/primary:free')
  assert.equal(backup.result?.fallbackReason, '模型暫時無法回應')
  assert.equal(backup.provider.requests[1].model, 'vendor/backup:free')
  assert.deepEqual(backup.traces.at(-1)?.attempts?.map((attempt) => attempt.kind), ['primary', 'backup'])

  // 分鐘級限流、沒有備援（例如付費模型）：等一下後同一模型重試一次（P3-9 live：付費模型串流中被限流）。
  const minuteNoBackup = new AIHttpError(429, 'generation', 'rate limited', 10, 'minute')
  const rateRetried = await run(opening, [{ error: minuteNoBackup }, { text: opening.goodAnswer! }])
  assert.equal(rateRetried.result?.answerKind, 'ai')
  assert.equal(rateRetried.provider.requests[1].model, 'vendor/primary:free')
  assert.deepEqual(rateRetried.traces.at(-1)?.attempts?.map((attempt) => attempt.kind), ['primary', 'rate_limit_retry'])
  // 服務端 5xx／過載、沒有備援：同一模型重試一次（實測：Sonnet 偶爾 5xx，整題直接變成摘要）。
  const overloaded = await run(opening, [{ error: new AIHttpError(503, 'generation', 'overloaded') }, { text: opening.goodAnswer! }])
  assert.equal(overloaded.result?.answerKind, 'ai')
  assert.equal(overloaded.provider.requests[1].model, 'vendor/primary:free')
  assert.deepEqual(overloaded.traces.at(-1)?.attempts?.map((attempt) => attempt.kind), ['primary', 'unavailable_retry'])
  // 重試仍失敗：照舊交摘要並說明原因，不無限重試。
  const stillDown = await run(opening, [
    { error: new AIHttpError(502, 'generation', 'bad gateway') },
    { error: new AIHttpError(502, 'generation', 'bad gateway') }
  ])
  assert.equal(stillDown.result?.answerKind, 'engine_summary')
  assert.equal(stillDown.provider.requests.length, 2)
  assert.match(stillDown.result?.finalText ?? '', /模型暫時無法回應/)
  // 有備援時不重試同一模型，直接改用備援（行為不變）。
  const withBackup = await run(
    opening,
    [{ error: new AIHttpError(503, 'generation', 'overloaded') }, { text: opening.goodAnswer! }],
    { backupModels: ['vendor/backup:free'] }
  )
  assert.deepEqual(withBackup.traces.at(-1)?.attempts?.map((attempt) => attempt.kind), ['primary', 'backup'])
  // 金鑰錯誤（401）不是暫時錯誤，不重試。
  const authFail = await run(opening, [{ error: new AIHttpError(401, 'generation', 'bad key') }])
  assert.equal(authFail.provider.requests.length, 1)

  // 服務要求等太久（超過 5 秒）就不重試，直接交摘要。
  const longWait = await run(opening, [{ error: new AIHttpError(429, 'generation', 'rate limited', 60_000, 'minute') }])
  assert.equal(longWait.result?.answerKind, 'engine_summary')
  assert.equal(longWait.provider.requests.length, 1)
  // 串流中回報的 429 沒有額度種類也算分鐘級：重試一次，再失敗就交摘要。
  const midStream = await run(
    opening,
    [{ error: new AIHttpError(429, 'generation', 'mid-stream') }, { error: new AIHttpError(429, 'generation', 'mid-stream') }],
    { timing: { rateLimitMaxWaitMs: 50 } }
  )
  assert.equal(midStream.result?.answerKind, 'engine_summary')
  assert.equal(midStream.provider.requests.length, 2)

  // 每日額度用完 → 直接回錯，不浪費備援。
  const daily = new AIHttpError(429, 'generation', 'rate limited', undefined, 'daily')
  const quota = await run(opening, [{ error: daily }], { backupModels: ['vendor/backup:free'] })
  assert.equal(quota.error, daily)
  assert.equal(quota.provider.requests.length, 1)
  assert.equal(quota.traces.at(-1)?.status, 'failed')

  // 401 也不備援。
  const auth = await run(opening, [{ error: new AIHttpError(401, 'generation', 'auth') }], { backupModels: ['vendor/backup:free'] })
  assert.ok(auth.error instanceof AIHttpError)
  assert.equal(auth.provider.requests.length, 1)

  // 空白（推理吃光）→ 以 off_strict 重試同一模型。
  const empty = new AIResponseValidationError('generation', 'generation_incomplete', 'empty', {
    reason: 'empty_content', reasoningTokens: 1_200
  })
  const recovered = await run(opening, [{ error: empty }, { text: opening.goodAnswer! }])
  assert.equal(recovered.result?.answerKind, 'ai')
  assert.equal(recovered.provider.requests[0].reasoningMode, undefined)
  assert.equal(recovered.provider.requests[1].reasoningMode, 'off_strict')
  assert.equal(recovered.provider.requests[1].model, 'vendor/primary:free')
  assert.ok((recovered.provider.requests[1].maxOutputTokens ?? 0) > (recovered.provider.requests[0].maxOutputTokens ?? 0))

  // 5xx 且沒有備援：重試一次仍失敗 → 引擎摘要並說明原因（重試規則見下方 unavailable_retry）。
  const unavailable = await run(opening, [
    { error: new AIHttpError(503, 'generation', 'down') },
    { error: new AIHttpError(503, 'generation', 'down') }
  ])
  assert.equal(unavailable.result?.answerKind, 'engine_summary')
  assert.match(unavailable.result?.finalText ?? '', /模型暫時無法回應/)

  // 單次呼叫逾時（例如串流閒置）→ 改用備援。
  const slow = await run(opening, [{ hang: true }, { text: opening.goodAnswer! }], {
    backupModels: ['vendor/backup:free'],
    timing: { callTimeoutMs: 50, totalDeadlineMs: 5_000, minRetryWindowMs: 10 }
  })
  assert.equal(slow.result?.answerKind, 'ai')
  assert.equal(slow.result?.fallbackReason, '模型超過時間沒有回答')

  // 總截止：沒有剩餘時間就不再修正或備援，交付摘要。
  const started = Date.now()
  const deadline = await run(opening, [{ hang: true }], {
    backupModels: ['vendor/backup:free'],
    timing: { callTimeoutMs: 1_000, totalDeadlineMs: 80, minRetryWindowMs: 50 }
  })
  assert.ok(Date.now() - started < 2_000)
  assert.equal(deadline.result?.answerKind, 'engine_summary')
  assert.match(deadline.result?.finalText ?? '', /模型超過時間沒有回答/)
  assert.equal(deadline.provider.requests.length, 1)

  // 上限 3 次呼叫：空白 → 復原重試仍空白 → 備援 → 不會再修正第四次。
  const capped = await run(opening, [{ error: empty }, { error: empty }, { text: invented }], {
    backupModels: ['vendor/backup:free']
  })
  assert.equal(capped.provider.requests.length, 3)
  assert.equal(capped.result?.answerKind, 'engine_summary')

  // 連線中斷（fetch 的 TypeError，底層代碼在 cause）→ 同一模型重試一次，並記下代碼。
  const socketError = (): TypeError =>
    Object.assign(new TypeError('fetch failed'), {
      cause: Object.assign(new Error('other side closed'), { code: 'UND_ERR_SOCKET' })
    })
  const reconnected = await run(opening, [{ error: socketError() }, { text: opening.goodAnswer! }])
  assert.equal(reconnected.result?.answerKind, 'ai')
  assert.equal(reconnected.provider.requests.length, 2)
  assert.equal(reconnected.provider.requests[1].model, 'vendor/primary:free')
  assert.equal(reconnected.provider.requests[1].reasoningMode, undefined)
  assert.deepEqual(
    reconnected.traces.at(-1)?.attempts?.map((attempt) => [attempt.kind, attempt.error, attempt.networkCode]),
    [['primary', 'network', 'UND_ERR_SOCKET'], ['network_retry', undefined, undefined]]
  )
  assert.ok(reconnected.progress.some((text) => /連線中斷/.test(text)))

  // 重試仍斷線且有備援 → 改用備援；備援也斷線 → 交付引擎摘要（不再是錯誤卡）。
  const offline = await run(opening, [{ error: socketError() }, { error: socketError() }, { error: socketError() }], {
    backupModels: ['vendor/backup:free']
  })
  assert.equal(offline.error, null)
  assert.equal(offline.result?.answerKind, 'engine_summary')
  assert.match(offline.result?.finalText ?? '', /連不上 AI 服務/)
  assert.deepEqual(offline.traces.at(-1)?.attempts?.map((attempt) => attempt.kind), ['primary', 'network_retry', 'backup'])
  assert.deepEqual(
    offline.traces.at(-1)?.attempts?.map((attempt) => attempt.networkCode),
    ['UND_ERR_SOCKET', 'UND_ERR_SOCKET', 'UND_ERR_SOCKET']
  )

  // HTTPS 憑證被攔截（防毒軟體）：重試、備援都不會好 → 一次呼叫後直接交付摘要並說明原因。
  const intercepted = (): TypeError =>
    Object.assign(new TypeError('fetch failed'), {
      cause: Object.assign(new Error('self-signed certificate in certificate chain'), { code: 'SELF_SIGNED_CERT_IN_CHAIN' })
    })
  const certificate = await run(opening, [{ error: intercepted() }], { backupModels: ['vendor/backup:free'] })
  assert.equal(certificate.error, null)
  assert.equal(certificate.result?.answerKind, 'engine_summary')
  assert.equal(certificate.provider.requests.length, 1)
  assert.match(certificate.result?.finalText ?? '', /HTTPS 憑證驗證失敗，可能是防毒軟體攔截了連線/)
  assert.equal(certificate.traces.at(-1)?.attempts?.[0].networkCode, 'SELF_SIGNED_CERT_IN_CHAIN')

  // 沒有底層代碼的 TypeError 一樣歸類 network 並重試，但不會捏造代碼。
  const bare = await run(opening, [{ error: new TypeError('x is undefined') }, { text: opening.goodAnswer! }])
  assert.equal(bare.result?.answerKind, 'ai')
  assert.equal(bare.traces.at(-1)?.attempts?.[0].networkCode, undefined)

  // 關鍵著法檢查：解說前另外問引擎「如果…」，結果寫進事實表給模型；失敗不影響解說，同一局面只問一次。
  const failing = await run(opening, [{ text: opening.goodAnswer! }], {
    adapter: { probeIdeas: async () => { throw new Error('engine crashed') } }
  })
  assert.equal(failing.result?.answerKind, 'ai', 'a failed key-move check never blocks the explanation')
  assert.doesNotMatch(failing.provider.requests[0].prompt, /關鍵著法檢查/)

  const probeCalls: unknown[] = []
  const probingAdapter = {
    probeIdeas: async (input: unknown) => {
      probeCalls.push(input)
      // 對手的威脅：假如紅方先不走，黑方炮8進7（炮打馬）。
      return {
        opponentThreat: {
          startFen: 'rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNR b - - 0 1',
          moves: ['h7h0']
        }
      }
    }
  }
  const probed = await run(opening, [{ text: opening.goodAnswer! }], { adapter: probingAdapter })
  assert.equal(probed.result?.answerKind, 'ai')
  assert.equal(probeCalls.length, 1)
  assert.deepEqual(probeCalls[0], {
    positionFen: opening.analysis.positionFen,
    bestMove: 'h2e2',
    bestLine: opening.analysis.principalVariation,
    userLine: opening.analysis.userMovePrincipalVariation
  })
  assert.match(probed.provider.requests[0].prompt, /關鍵著法檢查/)
  assert.match(probed.provider.requests[0].prompt, /對手的威脅（假如紅方這手先不走、讓黑方先走）/)
  assert.match(probed.provider.requests[0].prompt, /黑 炮8進7：吃紅二路馬[^\n]*← 關鍵/)
  assert.match(probed.provider.requests[0].systemPrompt ?? '', /標「關鍵」的那一手/)
  assert.ok(probed.progress.some((message) => /關鍵著法/.test(message)))
  const again = await run(opening, [{ text: opening.goodAnswer! }], { adapter: probingAdapter })
  assert.equal(probeCalls.length, 1, 'the same position reuses the earlier key-move checks')
  assert.match(again.provider.requests[0].prompt, /關鍵著法檢查/)

  // 串流到一半服務回報錯誤（例如 server_error）：重試一次仍失敗 → 摘要原因附上「回答到一半中斷」與服務代碼，
  // 診斷紀錄也記下代碼；同一句「模型暫時無法回應」底下是哪一種失敗，截圖就看得出來。
  const midStreamError = (): AIHttpError =>
    new AIHttpError(502, 'generation', 'stream error', undefined, undefined, 'server_error')
  const streamCut = await run(opening, [
    { partial: '**結論**：馬八進七', error: midStreamError() },
    { partial: '**結論**：馬八進七', error: midStreamError() }
  ])
  assert.equal(streamCut.result?.answerKind, 'engine_summary')
  assert.equal(streamCut.provider.requests.length, 2)
  assert.match(streamCut.result?.finalText ?? '', /模型暫時無法回應（回答到一半中斷；provider_unavailable；代碼 server_error）/)
  const midAttempts = streamCut.traces.at(-1)?.attempts ?? []
  assert.deepEqual(
    midAttempts.map((attempt) => [attempt.kind, attempt.providerCode, attempt.midStream]),
    [['primary', 'server_error', true], ['unavailable_retry', 'server_error', true]]
  )

  // 簡體中文模式：繁體記譜與簡體字不會被誤判。
  const simplified = await run(byId('simplified-chinese'), [{ text: byId('simplified-chinese').goodAnswer! }])
  assert.equal(simplified.result?.answerKind, 'ai')
  assert.match(simplified.provider.requests[0].systemPrompt ?? '', /简体中文/)

  console.log('explainPipelineV2 tests passed')
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
