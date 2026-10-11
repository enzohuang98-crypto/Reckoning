import { createHash, randomUUID } from 'node:crypto'
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { START_FEN } from '../../src/shared/types/BoardState'
import { compareMove } from '../../src/shared/logic/analysis/MoveComparisonService'
import { moveComparisonEvidenceState } from '../../src/shared/logic/ai/MoveComparisonEvidence'
import { countHanCharacters } from '../../src/shared/logic/ai/ExplanationQualityScorer'
import { SecretStore } from '../../src/main/storage/SecretStore'
import { StorageService } from '../../src/main/storage/StorageService'
import { EngineRegistryService } from '../../src/main/engine/EngineRegistryService'
import { HarnessTraceStore } from '../../src/main/storage/HarnessTraceStore'
import { TeacherTestRunService } from '../../src/main/teacherTest/TeacherTestRunService'
import { prepareExplanationExecution } from '../../src/main/ai/prepareExplanationExecution'
import { buildAIExplanationRequest } from '../../src/main/ipc/aiExplanationHandlers'
import { HarnessExplanationUnavailableError, runExplanationHarness } from '../../src/main/ai/HarnessOrchestrator'
import { getAIProvider } from '../../src/main/ai/AIProvider'
import { buildVariationBoardFacts } from '../../src/main/ai/VariationBoardFacts'
import { describeAIExecutionError, readJsonResponseBounded } from '../../src/main/ai/http'
import type { AnalysisSession } from '../../src/main/storage/AnalysisSessionStore'

const ENGINE = process.env.RECKONING_ACCEPTANCE_ENGINE_PATH ?? 'C:\\Program Files\\xiangqi-analyzer\\resources\\engine\\pikafish.exe'

export async function run(): Promise<void> {
  const outputPath = resolve(process.argv[2] ?? join(tmpdir(), 'reckoning-fixed-case-result.json'))
  const gameReport = process.env.RECKONING_REVIEW_GAME_REPORT ?? process.env.RECKONING_SELF_PLAY_REPORT
  const game = gameReport
    ? JSON.parse(readFileSync(gameReport, 'utf8'))
    : null
  const selectedPly = Number(process.env.RECKONING_REVIEW_GAME_PLY ?? process.env.RECKONING_SELF_PLAY_PLY)
  const gamePosition = game?.positions.find((position: { ply: number }) => position.ply === selectedPly)
  const recordedGame = game?.kind === 'playok-recorded-game'
  if (game && (!game.complete || game.importValidator !== 'passed' || !gamePosition)) throw new Error('A complete validated game position is required.')
  const positionFen = gamePosition?.fen ?? START_FEN
  const userMove = gamePosition?.move ?? 'h2e2'
  const question = process.env.RECKONING_REVIEW_GAME_QUESTION ?? process.env.RECKONING_SELF_PLAY_QUESTION ?? '這步與引擎首選如何比較？請說明這步的作用、對手合理應對及實戰原則。'
  const safeReport: Record<string, unknown> = {
    sourceCommit: process.env.RECKONING_SOURCE_COMMIT ?? 'local-checkout',
    case: game ? `complete_${recordedGame ? 'recorded_game' : 'self_play'}_ply_${gamePosition.ply}` : 'START_FEN h2e2 炮二平五',
    ...(game ? { question, gameKind: recordedGame ? 'playok-recorded-game' : 'self-play',
      gameSha256: game.sha256, gamePlies: game.plies, positionFen, userMove } : {}),
    outputPath
  }
  // Preserve only bounded allowlisted routing classifications from an HTTP
  // failure on the formal provider path. Never retain message/account metadata,
  // request content, headers or a raw provider response.
  const routingDiagnostics: Array<{ httpStatus: number; category: string }> = []
  const diagnosticWireRequests: Array<{ model: string; maxTokens: number; reasoning: { effort?: 'low'; enabled?: false; exclude: true } }> = []
  const formalFetch = globalThis.fetch.bind(globalThis)
  const safeWireRequests: Array<Record<string, unknown>> = []
  let diagnosticSchema: { name: string; schema: Record<string, unknown> } | undefined
  globalThis.fetch = async (input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    if (url === 'https://openrouter.ai/api/v1/chat/completions' && process.env.RECKONING_DIAGNOSE_SUPER_REASONING_LOW === '1') {
      if (typeof init?.body !== 'string') throw new Error('Diagnostic requires the formal JSON request.')
      const body = JSON.parse(init.body)
      if (body.model !== 'nvidia/nemotron-3-super-120b-a12b:free' || body.response_format?.type !== 'json_object') throw new Error('Diagnostic only permits the exact free Super JSON request.')
      body.reasoning = { effort: 'low', exclude: true }
      diagnosticWireRequests.push({ model: body.model, maxTokens: body.max_tokens, reasoning: body.reasoning })
      safeReport.diagnosticRequestDifference = 'Only wire reasoning.effort changed from none to low; same formal Harness prompt, validator, model, key, token/time/call caps. Not production acceptance. Harness policy labels describe unmodified source; diagnosticWireRequests describes actual wire settings.'
      safeReport.diagnosticWireRequests = diagnosticWireRequests
      init = { ...init, body: JSON.stringify(body) }
    }
    if (url === 'https://openrouter.ai/api/v1/chat/completions' && process.env.RECKONING_DIAGNOSE_DOTS_REASONING_DISABLED === '1') {
      if (typeof init?.body !== 'string') throw new Error('Diagnostic requires the formal JSON request.')
      const body = JSON.parse(init.body)
      if (body.model !== 'dots-studio/dots-3-note-preview:free' || body.response_format?.type !== 'json_object') throw new Error('Diagnostic only permits the exact free Dots JSON request.')
      body.reasoning = { enabled: false, exclude: true }
      diagnosticWireRequests.push({ model: body.model, maxTokens: body.max_tokens, reasoning: body.reasoning })
      safeReport.diagnosticRequestDifference = 'Only wire reasoning.enabled=false for the exact optional-reasoning free Dots endpoint; same formal Harness prompt, validator, model, key, token/time/call caps. Not production acceptance. diagnosticWireRequests contains actual wire settings.'
      safeReport.diagnosticWireRequests = diagnosticWireRequests
      init = { ...init, body: JSON.stringify(body) }
    }
    if (url === 'https://openrouter.ai/api/v1/chat/completions' && typeof init?.body === 'string' &&
        process.env.RECKONING_DIAGNOSE_SUPER_WRITER_BOUNDED === '1') {
      const body = JSON.parse(init.body)
      if (body.model !== 'nvidia/nemotron-3-super-120b-a12b:free') throw new Error('Bounded diagnostic requires exact free Super.')
      if (body.response_format?.json_schema?.name === 'initial_move_explanation') {
        const reasoningCeiling = process.env.RECKONING_DIAGNOSE_SUPER_WRITER_BOUNDED_TOKENS === '2000' ? 2000 : 1000
        body.reasoning = { max_tokens: reasoningCeiling, exclude: true }
        safeReport.diagnosticRequestDifference = `Only exact free Super initial/repair reasoning changed from none to max_tokens=${reasoningCeiling} after current official metadata supports_max_tokens=true. Planner policy, model, key, formal Harness/validator and all token/time/call caps unchanged. Not production acceptance; safeWireRequests records actual policy.`
        init = { ...init, body: JSON.stringify(body) }
      }
    }
    if (url === 'https://openrouter.ai/api/v1/chat/completions' && typeof init?.body === 'string' &&
        process.env.RECKONING_DIAGNOSE_SUPER_SCHEMA === '1' && diagnosticSchema?.name === 'initial_move_explanation') {
      const body = JSON.parse(init.body)
      if (body.model !== 'nvidia/nemotron-3-super-120b-a12b:free') throw new Error('Schema diagnostic requires the exact free Super model.')
      body.response_format = { type: 'json_schema', json_schema: { ...diagnosticSchema, strict: true } }
      body.provider = { require_parameters: true }
      init = { ...init, body: JSON.stringify(body) }
    }
    if (url === 'https://openrouter.ai/api/v1/chat/completions' && typeof init?.body === 'string') {
      const wire = JSON.parse(init.body)
      const reasoning = wire.reasoning
      safeWireRequests.push({
        callIndex: safeWireRequests.length + 1,
        model: typeof wire.model === 'string' ? wire.model.slice(0, 200) : null,
        maxTokens: Number.isSafeInteger(wire.max_tokens) ? wire.max_tokens : null,
        reasoning: reasoning ? {
          ...(typeof reasoning.max_tokens === 'number' ? { maxTokens: reasoning.max_tokens } : {}),
          ...(['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'].includes(reasoning.effort) ? { effort: reasoning.effort } : {}),
          ...(typeof reasoning.enabled === 'boolean' ? { enabled: reasoning.enabled } : {}),
          ...(typeof reasoning.exclude === 'boolean' ? { exclude: reasoning.exclude } : {})
        } : null,
        responseFormat: ['json_object', 'json_schema'].includes(wire.response_format?.type) ? wire.response_format.type : null,
        strictSchema: wire.response_format?.json_schema?.strict === true,
        requireParameters: wire.provider?.require_parameters === true
      })
      safeReport.safeWireRequests = safeWireRequests
    }
    const response = await formalFetch(input, init)
    if (url === 'https://openrouter.ai/api/v1/chat/completions') {
      let category = 'unclassified_http_error'
      try {
        const body = await readJsonResponseBounded<{ error?: { code?: unknown; message?: unknown; metadata?: { raw?: unknown } } }>(response.clone())
        if (response.ok && !body.error) return response
        const message = [body.error?.message, body.error?.metadata?.raw].filter(value => typeof value === 'string').join(' ')
        if (/(?:reasoning|thinking|budget|max[_ ]?tokens)/i.test(message) && /invalid|unsupported|not supported|must|greater|less|minimum|maximum/i.test(message)) category = 'provider_reasoning_or_token_parameters_rejected'
        else if (/uniqueItems/i.test(message)) category = 'schema_unique_items_rejected'
        else if (/(?:invalid|unsupported|not supported).{0,60}schema|schema.{0,60}(?:invalid|unsupported|not supported)/i.test(message)) category = 'schema_rejected'
        else if (/no endpoints?.*(?:data policy|privacy)|(?:data policy|privacy).*no endpoints?/i.test(message)) category = 'routing_data_policy'
        else if (/no endpoints?.*(?:support|parameters?|structured)|unsupported.*parameters?/i.test(message)) category = 'routing_parameter_support'
        else if (/no endpoints?|no available.*provider/i.test(message)) category = 'routing_no_available_endpoint'
        else if (/model.*not found|unknown model/i.test(message)) category = 'routing_model_not_found'
        routingDiagnostics.push({ httpStatus: typeof body.error?.code === 'number' ? body.error.code : response.status, category })
      } catch { if (!response.ok) routingDiagnostics.push({ httpStatus: response.status, category }) }
      safeReport.providerRoutingDiagnostics = routingDiagnostics
    }
    return response
  }
  const writeReport = (): void => {
    writeFileSync(outputPath, JSON.stringify(safeReport, null, 2), 'utf8')
  }
  const secretStore = new SecretStore()
  const active = await secretStore.captureActiveCredential()
  safeReport.activeProvider = active?.credential.provider ?? null
  safeReport.activeModel = active?.credential.model ?? null
  safeReport.credentialAvailable = Boolean(active?.apiKey)
  if (active?.credential.provider !== 'openrouter' || !active.credential.model.endsWith(':free')) {
    safeReport.errorCategory = 'unexpected_active_model'
    writeReport()
    return
  }
  const MODEL = active.credential.model
  const provider = getAIProvider('openrouter')
  if (process.env.RECKONING_DIAGNOSE_SUPER_SCHEMA === '1') {
    const generate = provider.generateExplanation.bind(provider)
    safeReport.diagnosticRequestDifference = 'Controlled exact free Super initial/repair json_schema strict + require_parameters trial; same formal Harness/validator/key/model/token/call/deadline. Not production acceptance.'
    provider.generateExplanation = async (request, signal) => {
      diagnosticSchema = request.responseSchema
      try { return await generate(request, signal) } finally { diagnosticSchema = undefined }
    }
  }
  if (process.env.RECKONING_DIAGNOSE_JSON_OBJECT === '1') {
    const generate = provider.generateExplanation.bind(provider)
    safeReport.diagnosticRequestDifference = 'responseSchema omitted for one controlled JSON-object comparison; not production application acceptance'
    provider.generateExplanation = (request, signal) => generate({ ...request, responseSchema: undefined }, signal)
  }
  // Local public self-play only: retain selected visible claim text for diagnosis,
  // never requests, raw responses, keys, account data or hidden reasoning.
  if ((game && process.env.RECKONING_CAPTURE_PUBLIC_GAME_CLAIMS === '1') || (!game && process.env.RECKONING_CAPTURE_PUBLIC_FIXED_CLAIMS === '1')) {
    const generate = provider.generateExplanation.bind(provider)
    type PublicClaim = { text: string; evidenceIds: string[]; id?: string; premiseIds?: string[]; interpretation?: string }
    const publicClaims: Array<{ format: string; claims: PublicClaim[] }> = []
    provider.generateExplanation = async (request, signal) => {
      const response = await generate(request, signal)
      const claims: PublicClaim[] = []
      if (request.responseFormat === 'json') {
        try {
          // Capture only an entire valid JSON value, including a complete
          // fenced JSON envelope. Never complete or retain partial JSON.
          const trimmed = response.text.trim()
          const fenced = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(trimmed)
          const parsed = JSON.parse(fenced ? fenced[1]! : trimmed)
          if (request.responseSchema?.name === 'initial_move_explanation') {
            const kind = (value: unknown): string => value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value
            safeReport.publicCaseEnvelopeClassification = {
              auditKind: kind(parsed.audit), answerKind: kind(parsed.answer),
              consequenceKinds: Array.isArray(parsed.audit?.consequences) ? parsed.audit.consequences.slice(0, 8).map(kind) : []
            }
          }
          const answer = parsed.answer ?? parsed
          if (typeof answer.directAnswer === 'string') claims.push({ text: answer.directAnswer.slice(0, 3000), evidenceIds: Array.isArray(answer.directAnswerEvidenceIds) ? answer.directAnswerEvidenceIds.filter((id: unknown) => typeof id === 'string' && /^E\d+$/.test(id)).slice(0, 10) : [] })
          for (const section of Array.isArray(answer.sections) ? answer.sections.slice(0, 6) : []) {
            for (const claim of Array.isArray(section.claims) ? section.claims.slice(0, 3) : []) {
              if (typeof claim.text === 'string') claims.push({ text: claim.text.slice(0, 3000),
                evidenceIds: Array.isArray(claim.evidenceIds) ? claim.evidenceIds.filter((id: unknown) => typeof id === 'string' && /^E\d+$/.test(id)).slice(0, 10) : [],
                ...(typeof claim.id === 'string' && /^[A-Za-z][A-Za-z0-9_-]{0,79}$/.test(claim.id) ? { id: claim.id } : {}),
                premiseIds: Array.isArray(claim.premiseIds) ? claim.premiseIds.filter((id: unknown) =>
                  typeof id === 'string' && /^E\d+:P\d+:[A-Za-z0-9:]+$/.test(id)).slice(0, 4) : [],
                ...(['observation', 'inference'].includes(claim.interpretation) ? { interpretation: claim.interpretation } : {}) })
            }
          }
        } catch { /* No partial JSON is retained. */ }
      } else if (!/^[\[{]|```|<\/?think\b/i.test(response.text.trim())) {
        claims.push({ text: response.text.slice(0, 3000), evidenceIds: [] })
      }
      publicClaims.push({ format: request.responseFormat ?? 'text', claims })
      safeReport.publicCaseVisibleClaimDiagnostics = publicClaims
      return response
    }
  }
  try {
    const models = await provider.listModels(active.apiKey)
    safeReport.freeCatalogEligible = models.includes(MODEL)
    safeReport.freeCatalogCount = models.length
    if (!models.includes(MODEL)) {
      safeReport.errorCategory = 'model_unavailable'
      writeReport()
      return
    }
  } catch (error) {
    safeReport.catalogDiagnostic = describeAIExecutionError(error, 'OpenRouter')
    writeReport()
    return
  }
  if (!existsSync(ENGINE)) {
    safeReport.errorCategory = 'installed_pikafish_missing'
    writeReport()
    return
  }
  const scratch = mkdtempSync(join(tmpdir(), 'reckoning-fixed-case-'))
  const storage = new StorageService(scratch)
  const registry = new EngineRegistryService(storage, ENGINE)
  const installation = registry.getInstallation()
  const adapter = registry.getAdapter()
  if (!installation || !adapter) throw new Error('Installed engine unavailable')
  const engineStart = Date.now()
  const engineAnalysis = await adapter.analyzePosition(
    { positionFen, userMove },
    { rootAnalysisMovetimeMs: 3000, userMoveEvalMovetimeMs: 1000, multiPv: 3 }
  )
  safeReport.engineMs = Date.now() - engineStart
  safeReport.enginePath = ENGINE
  safeReport.engineSha256 = createHash('sha256').update(readFileSync(ENGINE)).digest('hex')
  safeReport.engine = {
    name: engineAnalysis.engineName,
    depth: engineAnalysis.depth,
    bestMove: engineAnalysis.bestMove,
    userMove: engineAnalysis.userMove,
    bestLine: engineAnalysis.principalVariation,
    userLine: engineAnalysis.userMovePrincipalVariation
  }
  const now = Date.now()
  const session: AnalysisSession = {
    analysisId: randomUUID(),
    requestId: randomUUID(),
    createdAt: new Date(now).toISOString(),
    expiresAt: new Date(now + 60_000).toISOString(),
    positionFen,
    userMove,
    primaryEngineId: installation.id,
    engineAnalysis,
    moveComparison: compareMove(engineAnalysis)
  }
  safeReport.moveComparison = {
    state: moveComparisonEvidenceState(session.moveComparison),
    mistakeLevel: session.moveComparison.mistakeLevel,
    confidence: session.moveComparison.confidence,
    scoreDifference: session.moveComparison.scoreDifference
  }
  const payload = {
    requestId: randomUUID(),
    analysisId: session.analysisId,
    provider: 'openrouter' as const,
    model: MODEL,
    userLevel: 'intermediate' as const,
    explanationStyle: 'long_analytical' as const,
    language: 'zh-TW' as const,
    attachedMove: userMove,
    userMoveReason: game ? recordedGame ? '公開完整實戰棋譜中的著法，現在復盤確認具體作用' : '快速自對弈實際走出的著法，現在復盤確認具體作用' : '想用中炮控制中央並取得主動',
    answerMode: 'research' as const,
    followUpQuestion: question,
    ...(game && process.env.RECKONING_REVIEW_FULL_EXPLANATION !== '1' ? { conversationHistory: [{ id: randomUUID(), role: 'user' as const,
      text: `已載入完整的 ${game.plies} 半回合${recordedGame ? '公開實戰' : '自對弈'}棋譜，目前復盤第 ${gamePosition.ply} 半回合。`, createdAt: new Date().toISOString() }] } : {})
  }
  const teacherRun = new TeacherTestRunService({ getRuntime: () => ({
    appVersion: '0.4.14', platform: 'win32', systemVersion: '10.0',
    osBuild: 'Windows', arch: 'x64'
  }) })
  const execution = prepareExplanationExecution(payload, session, MODEL, teacherRun)
  safeReport.answerStrategy = execution.answerStrategy
  const request = await buildAIExplanationRequest(execution, {
    secretStore,
    credentialSnapshot: active
  })
  const traceStore = new HarnessTraceStore(storage)
  const startedAt = Date.now()
  try {
    const result = await runExplanationHarness(execution, {
      provider,
      apiKey: request.apiKey,
      registry,
      traceStore,
      signal: new AbortController().signal,
      explanationPrompt: request.prompt,
      onProgress: () => {},
      waitForContinuation: async () => {}
    })
    safeReport.status = 'completed'
    safeReport.model = MODEL
    safeReport.durationMs = Date.now() - startedAt
    safeReport.hanCharacters = countHanCharacters(result.finalText)
    safeReport.sha256 = createHash('sha256').update(result.finalText, 'utf8').digest('hex')
    safeReport.finalText = result.finalText
    safeReport.traceId = result.traceId
    safeReport.usage = result.usage
  } catch (error) {
    safeReport.status = 'failed'
    safeReport.durationMs = Date.now() - startedAt
    if (error instanceof HarnessExplanationUnavailableError) {
      safeReport.harnessReason = error.reason
    } else {
      safeReport.providerDiagnostic = describeAIExecutionError(error, 'AI')
    }
    safeReport.errorName = error instanceof Error ? error.name : 'unknown'
  }
  const trace = traceStore.list()[0]
  if ((game && process.env.RECKONING_CAPTURE_PUBLIC_GAME_CLAIMS === '1') || (!game && process.env.RECKONING_CAPTURE_PUBLIC_FIXED_CLAIMS === '1')) {
    safeReport.publicGameEvidence = trace?.evidence.map(item => ({ id: item.id, positionFen: item.positionFen, displayPrincipalVariation: item.displayPrincipalVariation, computedBoardFacts: buildVariationBoardFacts(item) }))
  }
  safeReport.modelCallDiagnostics = trace?.modelCallDiagnostics ?? []
  safeReport.research = trace?.research ?? null
  safeReport.traceModelCallCount = trace?.modelCallDiagnostics?.length ?? 0
  safeReport.modelCallCount = safeWireRequests.length
  safeReport.validatorErrors = trace?.validationErrors ?? []
  writeReport()
}
