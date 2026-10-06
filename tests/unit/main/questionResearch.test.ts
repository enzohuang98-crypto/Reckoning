import { strict as assert } from 'node:assert'
import Ajv from 'ajv'
import { START_FEN } from '../../../src/shared/types/BoardState'
import type { EngineAnalysis, AnalysisConfig } from '../../../src/shared/types/EngineAnalysis'
import type { AIExplanationRequest } from '../../../src/shared/types/AIExplanationTypes'
import type { HarnessEvidence, HarnessResearchTrace, HarnessTrace, HarnessBudget } from '../../../src/shared/types/Harness'
import type { EngineLiveAnalysisProgress } from '../../../src/main/engine/PikafishAdapter'
import type { AnalysisSession } from '../../../src/main/storage/AnalysisSessionStore'
import { compareMove } from '../../../src/shared/logic/analysis/MoveComparisonService'
import { prepareExplanationExecution } from '../../../src/main/ai/prepareExplanationExecution'
import { runExplanationHarness } from '../../../src/main/ai/HarnessOrchestrator'
import { AIHttpError } from '../../../src/main/ai/http'
import {
  buildResearchDecisionSchema, completedResearchEvidence, latestResearchUpdates, parseResearchDecision,
  recordResearchUpdate, replayResearchLine, resolveResearchAction, type ResolvedResearchAction
} from '../../../src/main/ai/QuestionResearch'

let passed = 0
function test(name: string, body: () => void) { body(); passed++; console.log(`  ✓ ${name}`) }
const rootLine = ['h2e2', 'h9g7', 'b0c2', 'b9c7']
function analysis(fen = START_FEN, line = rootLine, depth = 12): EngineAnalysis {
  const replay = replayResearchLine(fen, line)
  assert(replay, 'the synthetic engine fixture must be legal')
  return { positionFen: fen, sideToMove: replayResearchLine(fen, [])!.board.sideToMove,
    bestMove: line[0]!, displayBestMove: replay.display[0], principalVariation: [...line],
    displayPrincipalVariation: replay.display, depth, incomplete: false,
    scoreAfterBestMove: null, scoreAfterUserMove: null, evaluationAfterBestMove: null,
    evaluationAfterUserMove: null, userMoveEvaluationSource: 'unavailable', candidateMoves: [],
    warnings: [], engineId: 'synthetic-engine', engineName: 'Synthetic engine' }
}
function evidence(a = analysis()): HarnessEvidence {
  return { id: 'E1', engineId: 'synthetic-engine', engineName: a.engineName, purpose: 'captured root',
    positionFen: START_FEN, displayMove: a.displayBestMove, depth: a.depth, score: null,
    displayPrincipalVariation: a.displayPrincipalVariation!, analysis: a }
}
const initialEvidence = evidence()
function freshTrace(): HarnessResearchTrace {
  return { stopReason: 'query_budget', operations: [], updates: [], updatesSeen: 0, omittedUpdates: 0, invalidUpdates: 0 }
}
function progress(line = rootLine, depth = 10): EngineLiveAnalysisProgress {
  return { phase: 'root_analysis', elapsedMs: 1, targetMs: 3000, depth, candidateRank: 1,
    principalVariation: line, displayPrincipalVariation: ['untrusted display'], score: null }
}

test('planner schema accepts only the three action shapes and bounded prefixes', () => {
  const validate = new Ajv({ strict: false }).compile(buildResearchDecisionSchema().schema)
  assert(validate({ decision: 'research', reason: 'inspect reply', tasks: [
    { kind: 'continue_line', purpose: 'inspect reply', evidenceId: 'E1', prefixPlies: 1, move: null }
  ] }))
  assert(!validate({ decision: 'research', reason: 'forge', tasks: [{ kind: 'root', purpose: 'x', positionFen: START_FEN }] }))
  assert(!validate({ decision: 'research', reason: 'long', tasks: [{ kind: 'continue_line', purpose: 'x', evidenceId: 'E1', prefixPlies: 9, move: null }] }))
})

test('actions reject wrong side, illegal moves, forged FEN and incomplete or foreign source lines', () => {
  for (const move of ['h9g7', 'a0a9', 'exec']) assert.equal(resolveResearchAction({ kind: 'evaluate_move', purpose: 'x', move }, START_FEN, [initialEvidence]), null)
  assert.equal(resolveResearchAction({ kind: 'root', purpose: 'x', positionFen: START_FEN }, START_FEN, [initialEvidence]), null)
  const raw = { kind: 'continue_line', purpose: 'x', evidenceId: 'E1', prefixPlies: 1, move: 'b0c2' }
  assert.equal(resolveResearchAction(raw, START_FEN, [initialEvidence]), null, 'red cannot play on the black descendant')
  for (const bad of [ { ...initialEvidence, positionFen: 'foreign' },
    { ...initialEvidence, analysis: { ...initialEvidence.analysis, incomplete: true } },
    { ...initialEvidence, analysis: { ...initialEvidence.analysis, principalVariation: ['h9g7'] } } ]) {
    assert.equal(resolveResearchAction({ ...raw, move: null }, START_FEN, [bad]), null)
  }
  assert.equal(parseResearchDecision({ decision: 'research', reason: 'x', tasks: [
    { kind: 'root', purpose: 'valid' }, { kind: 'evaluate_move', purpose: 'bad', move: 'h9g7' }
  ] }, START_FEN, [initialEvidence]).valid, false, 'a mixed invalid plan is rejected atomically')
})

const branch = resolveResearchAction({ kind: 'continue_line', purpose: 'inspect response', evidenceId: 'E1', prefixPlies: 1, move: null }, START_FEN, [initialEvidence])!
test('completed descendant evidence replays its source and keeps root evaluation unknown', () => {
  const found = completedResearchEvidence({ rootFen: START_FEN, action: branch,
    analysis: analysis(branch.positionFen, rootLine.slice(1), 18), evidence: [initialEvidence], operationId: 'op1', nextId: 2 })
  assert.equal(found.length, 1)
  assert.deepEqual(found[0]!.analysis.principalVariation, rootLine)
  assert.equal(found[0]!.analysis.sideToMove, 'red')
  assert.equal(found[0]!.researchOrigin?.searchSideToMove, 'black')
  assert.equal(found[0]!.researchOrigin?.searchDepth, 18)
  assert.equal(found[0]!.researchOrigin?.rootRelativeEvaluation, 'unknown')
  assert.equal(found[0]!.researchOrigin?.lineRole, 'continuation')
  assert.equal(found[0]!.score, null)
  assert.equal(found[0]!.depth, null)
  assert.equal(found[0]!.analysis.evaluationAfterBestMove, null)
  for (const bad of [ { ...branch, prefix: ['b0c2'] }, { ...branch, positionFen: START_FEN } ]) {
    assert.deepEqual(completedResearchEvidence({ rootFen: START_FEN, action: bad,
      analysis: analysis(branch.positionFen, rootLine.slice(1)), evidence: [initialEvidence], operationId: 'bad', nextId: 3 }), [])
  }
  for (const bad of [ { ...analysis(branch.positionFen, rootLine.slice(1)), sideToMove: 'red' as const },
    { ...analysis(branch.positionFen, rootLine.slice(1)), incomplete: true },
    { ...analysis(branch.positionFen, rootLine.slice(1)), bestMove: 'a9a8' } ]) {
    assert.deepEqual(completedResearchEvidence({ rootFen: START_FEN, action: branch,
      analysis: bad, evidence: [initialEvidence], operationId: 'bad', nextId: 3 }), [])
  }
})

test('explicit opponent probes and their later continuations remain hypotheses', () => {
  const action = resolveResearchAction({ kind: 'continue_line', purpose: 'alternative', evidenceId: 'E1', prefixPlies: 1, move: 'b9c7' }, START_FEN, [initialEvidence])!
  const replyLine = ['b9c7', 'b0c2', 'h9g7']
  const a = { ...analysis(action.positionFen, rootLine.slice(1)), userMove: 'b9c7',
    userMovePrincipalVariation: replyLine, displayUserMovePrincipalVariation: replayResearchLine(action.positionFen, replyLine)!.display }
  const [found] = completedResearchEvidence({ rootFen: START_FEN, action, analysis: a,
    evidence: [initialEvidence], operationId: 'hypothesis', nextId: 2 })
  assert.equal(found?.researchOrigin?.lineRole, 'hypothesis')
  const continued = resolveResearchAction({ kind: 'continue_line', purpose: 'continue alternative', evidenceId: 'E2', prefixPlies: 2, move: null }, START_FEN, [found!])!
  const [descendant] = completedResearchEvidence({ rootFen: START_FEN, action: continued,
    analysis: analysis(continued.positionFen, replyLine.slice(2)), evidence: [found!], operationId: 'later', nextId: 3 })
  assert.equal(descendant?.researchOrigin?.lineRole, 'hypothesis')
  assert.equal(continued.prefix.length, 3, 'the next query advances beyond the earlier search origin')
})

test('successive trusted continuations advance beyond the first eight plies and reject forged ancestry', () => {
  const line = ['h2e2', 'h9g7', 'h0g2', 'i9h9', 'i0h0', 'g6g5', 'h0h6', 'c6c5',
    'b2c2', 'c9e7', 'b0a2', 'b9d8', 'a0b0', 'h7i7', 'h6h9', 'g7h9', 'b0b4']
  const source = evidence(analysis(START_FEN, line))
  const first = resolveResearchAction({ kind: 'continue_line', purpose: 'inspect exchange', evidenceId: 'E1', prefixPlies: 8, move: null }, START_FEN, [source])!
  const [extended] = completedResearchEvidence({ rootFen: START_FEN, action: first,
    analysis: analysis(first.positionFen, line.slice(8)), evidence: [source], operationId: 'first', nextId: 2 })
  const second = resolveResearchAction({ kind: 'continue_line', purpose: 'inspect recapture', evidenceId: 'E2', prefixPlies: 8, move: null }, START_FEN, [extended!])!
  assert.equal(first.prefix.length, 8)
  assert.equal(second.prefix.length, 16)
  assert.equal(second.positionFen, replayResearchLine(START_FEN, line.slice(0, 16))!.board.fen)
  const [confirmed] = completedResearchEvidence({ rootFen: START_FEN, action: second,
    analysis: analysis(second.positionFen, line.slice(16)), evidence: [extended!], operationId: 'second', nextId: 3 })
  assert.equal(confirmed?.researchOrigin?.prefix.length, 16)
  assert.equal(confirmed?.researchOrigin?.rootRelativeEvaluation, 'unknown')
  const forged = structuredClone(extended!)
  forged.researchOrigin!.searchPositionFen = START_FEN
  assert.equal(resolveResearchAction({ kind: 'continue_line', purpose: 'forged', evidenceId: 'E2', prefixPlies: 1, move: null }, START_FEN, [forged]), null)
})

test('every legal live update is local and provisional with bounded explicit omissions', () => {
  const trace = freshTrace()
  const action = resolveResearchAction({ kind: 'root', purpose: 'x' }, START_FEN, [])!
  const repeated = Array.from({ length: 10 }, () => ['b0c2', 'b9c7', 'c2b0', 'c7b9']).flat()
  for (let i = 0; i < 100; i++) recordResearchUpdate(trace, { requestId: 'r', operationId: 'op', action, live: progress(repeated, i) })
  assert.equal(trace.updatesSeen, 100)
  assert.equal(trace.updates.length, 96)
  assert.equal(trace.omittedUpdates, 4)
  assert.equal(trace.updates.at(-1)?.omittedPlies, 8)
  assert.equal(trace.updates.at(-1)?.principalVariation.length, 32)
  assert.equal(trace.updates.at(-1)?.provisional, true)
  assert.equal(trace.updates.at(-1)?.displayPrincipalVariation[0], '馬八進七')
  assert.equal(latestResearchUpdates(trace).length, 1)
  assert.equal(latestResearchUpdates(trace)[0]?.depth, 99)
  recordResearchUpdate(trace, { requestId: 'r', operationId: 'op', action, live: progress(['h9g7']) })
  assert.equal(trace.invalidUpdates, 1)
  assert.equal(trace.updatesSeen, 100)
})

const shortAnswer = '炮二平五把紅炮移到中路，黑方馬8進7則發展左翼馬。這條主線顯示兩步部署，尚不能證明黑方必須採用這個應手。'
const answerDecision = { decision: 'answer', reason: '已取得可說明的部署；其餘差異證據不足', tasks: [] }
type EngineOptions = { signal: AbortSignal; onInfo?: (live: EngineLiveAnalysisProgress) => void }
type EngineInput = { positionFen: string; userMove?: string }
async function runScenario(options: {
  decisions?: unknown[]; budget?: HarnessBudget; adapter?: boolean; controller?: AbortController;
  engine?: (input: EngineInput, config: AnalysisConfig, opts: EngineOptions) => Promise<EngineAnalysis>;
  modelError?: Error; onPlan?: (index: number) => void; missingUsage?: boolean
  initialAnalysis?: EngineAnalysis; storedMove?: string; writerEvidenceId?: string
} = {}) {
  const a = options.initialAnalysis ?? analysis()
  const session: AnalysisSession = { analysisId: 'research-session', requestId: 'engine-r', createdAt: '2026-01-01',
    expiresAt: '2099-01-01', positionFen: START_FEN, primaryEngineId: 'synthetic-engine', engineAnalysis: a,
    moveComparison: compareMove(a) }
  if (options.storedMove) session.userMove = options.storedMove
  const before = JSON.stringify(session)
  const requests: AIExplanationRequest[] = []
  const engineCalls: Array<{ input: EngineInput; config: AnalysisConfig; options: EngineOptions }> = []
  const stages: string[] = []
  let plannerCalls = 0
  let trace: HarnessTrace | undefined
  const controller = options.controller ?? new AbortController()
  const execution = prepareExplanationExecution({ requestId: 'research-r', analysisId: session.analysisId,
    provider: 'openai', model: 'synthetic-model', userLevel: 'intermediate', explanationStyle: 'long_analytical',
    language: 'zh-TW', answerMode: 'research', followUpQuestion: '炮二平五後黑方為什麼馬8進7？請用兩句回答。',
    conversationHistory: [{ id: 'prior', role: 'assistant', text: '舊的有效解說。', createdAt: '2026-01-01' }],
    ...(options.budget ? { budget: options.budget } : {}) }, session, 'synthetic-model', {
    getActiveManifest: () => null, createEvaluationLink: () => undefined })
  let result: Awaited<ReturnType<typeof runExplanationHarness>> | undefined
  let error: unknown
  try {
    result = await runExplanationHarness(execution, {
      provider: { generateExplanation: async (request: AIExplanationRequest) => {
        requests.push(request)
        const planner = request.responseSchema?.name === 'question_research_decision'
        if (planner) {
          options.onPlan?.(plannerCalls)
          plannerCalls++
          if (options.modelError) throw options.modelError
        }
        const text = planner ? JSON.stringify(options.decisions?.[plannerCalls - 1] ?? answerDecision)
          : JSON.stringify({ mode: 'research', title: '後續部署', directAnswer: shortAnswer,
            directAnswerEvidenceIds: [options.writerEvidenceId ?? 'E1'], sections: [{ id: 'follow_up', heading: '後續部署',
              claims: [{ id: 'FQ1', text: shortAnswer, evidenceIds: [options.writerEvidenceId ?? 'E1'] }] }], generalNotes: [], warnings: [] })
        return { text, provider: 'openai', model: 'synthetic-model', createdAt: Date.now(), groundedOnEngineData: true,
          ...(options.missingUsage ? {} : { usage: { inputTokens: 50, outputTokens: 80 } }) }
      } } as never,
      apiKey: 'synthetic-only', registry: { list: () => ({ activeEngineId: 'synthetic-engine' }),
        getAdapter: () => options.adapter === false ? null : { analyzePosition: async (input: EngineInput, config: AnalysisConfig, opts: EngineOptions) => {
          engineCalls.push({ input, config, options: opts })
          if (options.engine) return options.engine(input, config, opts)
          const line = input.positionFen === START_FEN ? rootLine : rootLine.slice(1)
          opts.onInfo?.(progress(line, 12)); opts.onInfo?.(progress(line, 18))
          return analysis(input.positionFen, line, 18)
        } } } as never,
      traceStore: { save: (value: HarnessTrace) => { trace = value } } as never,
      signal: controller.signal, onProgress: event => stages.push(event.phase)
    })
  } catch (caught) { error = caught }
  assert.equal(JSON.stringify(session), before, 'background research cannot mutate session or prior answer')
  return { result, error, trace, requests, engineCalls, plannerCalls, stages }
}

async function main() {
  const initial = { ...analysis(START_FEN, ['b0c2', 'h9g7', 'h2e2', 'b9c7']), userMove: 'h2e2',
    userMovePrincipalVariation: rootLine, displayUserMovePrincipalVariation: replayResearchLine(START_FEN, rootLine)!.display }
  const refreshed = await runScenario({ initialAnalysis: initial, storedMove: 'h2e2', writerEvidenceId: 'E3',
    engine: async () => ({ ...analysis(START_FEN, rootLine, 18), userMove: 'h2e2',
      userMovePrincipalVariation: rootLine, displayUserMovePrincipalVariation: replayResearchLine(START_FEN, rootLine)!.display }) })
  test('a stored reviewed move reaches background comparison and a newly matching best move updates the writer contract', () => {
    assert.equal(refreshed.error, undefined)
    assert.equal(refreshed.engineCalls[0]?.input.userMove, 'h2e2')
    assert.ok(refreshed.requests.find(request => request.responseSchema?.name !== 'question_research_decision')?.prompt.includes('實戰步與引擎首選是同一著法'))
    assert.ok(refreshed.result?.finalText.includes(shortAnswer))
  })
  const branchRun = await runScenario({ decisions: [ { decision: 'research', reason: '檢查黑馬後續部署', tasks: [
    { kind: 'continue_line', purpose: '檢查黑馬後續部署', evidenceId: 'E1', prefixPlies: 1, move: null }
  ] }, answerDecision ] })
  test('model decision executes legal descendant search, then new evidence reaches next model milestone and writer', () => {
    assert.equal(branchRun.error, undefined)
    assert(branchRun.result?.finalText.includes(shortAnswer))
    assert.equal(branchRun.engineCalls.length, 1)
    assert.equal(branchRun.engineCalls[0]?.input.positionFen, branch.positionFen)
    assert.equal(branchRun.trace?.research?.stopReason, 'answered')
    assert.equal(branchRun.trace?.research?.updatesSeen, 2)
    assert.equal(branchRun.trace?.research?.updates[1]?.depth, 18)
    assert.equal(branchRun.trace?.evidence.at(-1)?.researchOrigin?.searchSideToMove, 'black')
    assert(branchRun.requests[1]?.prompt.includes('"searchDepth":18'))
    assert(branchRun.requests[1]?.prompt.includes('"receivedValid":2'))
    assert(branchRun.requests[2]?.prompt.includes('"rootRelativeEvaluation":"unknown"'))
    assert.deepEqual(branchRun.trace?.modelCallDiagnostics?.map(item => item.stage), ['research_planner', 'research_planner', 'writer'])
    const before = JSON.stringify(branchRun.trace)
    branchRun.engineCalls[0]?.options.onInfo?.(progress(rootLine.slice(1), 99))
    assert.equal(JSON.stringify(branchRun.trace), before, 'late engine callbacks cannot change completed evidence')
  })
  const early = await runScenario({ decisions: [answerDecision, answerDecision] })
  test('early insufficient/answer decision still completes a real bounded confirmation before answering', () => {
    assert.equal(early.error, undefined)
    assert.equal(early.engineCalls.length, 1)
    assert.equal(early.plannerCalls, 2)
    assert.equal(early.trace?.research?.stopReason, 'answered')
    assert.equal(early.engineCalls[0]?.config.multiPv, 3)
  })
  const invalid = await runScenario({ decisions: [{ decision: 'research', reason: 'bad', tasks: [
    { kind: 'continue_line', purpose: 'forge', evidenceId: 'E1', prefixPlies: 1, move: 'b0c2', positionFen: 'forged' }
  ] }, answerDecision] })
  test('invalid planner command never reaches engine; a legal local confirmation remains available', () => {
    assert.equal(invalid.error, undefined)
    assert.equal(invalid.engineCalls[0]?.input.positionFen, START_FEN)
    assert.equal(invalid.engineCalls[0]?.input.userMove, undefined)
    assert(invalid.trace?.validationErrors.some(value => value.includes('無效或越界')))
  })
  const unavailable = await runScenario({ budget: { engineTimeMs: 10000, maxEngineRounds: 1, maxModelCalls: 6, maxOutputTokens: 10000 },
    engine: async () => { throw new Error('synthetic unavailable') } })
  test('engine unavailable remains factual even when the failing operation exhausts query budget', () => {
    assert.equal(unavailable.trace?.research?.stopReason, 'engine_unavailable')
    assert.equal(unavailable.trace?.research?.operations[0]?.status, 'unavailable')
    assert.equal(unavailable.trace?.research?.updatesSeen, 0)
  })
  const maxed = await runScenario({ budget: { engineTimeMs: 500, maxEngineRounds: 1, maxModelCalls: 6, maxOutputTokens: 10000 } })
  test('engine time/query limits are shared and do not grow between operations', () => {
    assert.equal(maxed.engineCalls.length, 1)
    assert.equal(maxed.trace?.research?.stopReason, 'query_budget')
    assert.equal(maxed.trace?.research?.operations.reduce((sum, item) => sum + item.allocatedMs, 0), 500)
    assert.equal(maxed.engineCalls[0]?.config.rootAnalysisMovetimeMs, 500)
  })
  const constrained = await runScenario({ budget: { engineTimeMs: 10000, maxEngineRounds: 3, maxModelCalls: 2, maxOutputTokens: 4000 } })
  test('small model budget preserves writer capacity and permits one engine confirmation', () => {
    assert.equal(constrained.error, undefined)
    assert.equal(constrained.plannerCalls, 0)
    assert.equal(constrained.engineCalls.length, 1)
    assert.equal(constrained.trace?.research?.stopReason, 'model_budget')
    assert(constrained.requests.length <= 2)
  })
  const noAdapter = await runScenario({ adapter: false })
  test('without an engine adapter there is no research planner or fabricated research trace', () => {
    assert.equal(noAdapter.error, undefined)
    assert.equal(noAdapter.plannerCalls, 0)
    assert.equal(noAdapter.trace?.research, undefined)
  })
  const controller = new AbortController()
  const cancelled = await runScenario({ controller, engine: async (_input, _config, opts) => {
    opts.onInfo?.(progress()); controller.abort(); return analysis()
  } })
  test('cancellation stops before writer, saves cancelled operation, and leaves old answer intact', () => {
    assert.equal((cancelled.error as Error)?.name, 'AbortError')
    assert.equal(cancelled.trace?.status, 'cancelled')
    assert.equal(cancelled.trace?.research?.stopReason, 'cancelled')
    assert.equal(cancelled.trace?.research?.operations[0]?.status, 'cancelled')
    assert.equal(cancelled.trace?.finalText, undefined)
    assert.equal(cancelled.requests.length, 1)
  })
  for (const status of [429, 503]) {
    const failed = await runScenario({ modelError: new AIHttpError(status, 'generation', `HTTP ${status}`, 5000) })
    test(`planner HTTP ${status} preserves provider failure and bounded retries without an answer template`, () => {
      assert.equal((failed.error as AIHttpError)?.status, status)
      assert.equal(failed.trace?.status, 'failed')
      assert.equal(failed.trace?.research?.stopReason, 'provider_error')
      assert.equal(failed.trace?.finalText, undefined)
      assert.equal(failed.engineCalls.length, 0)
      assert.equal(failed.requests.length, 1, 'the 15-second planner phase leaves no safe retry window')
    })
  }
  const realNow = Date.now
  let offset = 0
  Date.now = () => realNow() + offset
  let deadline: Awaited<ReturnType<typeof runScenario>>
  try { deadline = await runScenario({ onPlan: () => { offset = 106000 } }) }
  finally { Date.now = realNow }
  test('the shared deadline cannot start a late engine operation or writer', () => {
    assert.equal(deadline.trace?.research?.stopReason, 'deadline')
    assert.equal(deadline.engineCalls.length, 0)
    assert.equal(deadline.requests.length, 1)
    assert.equal(deadline.trace?.status, 'failed')
  })
  const noNovel = await runScenario({ decisions: [
    { decision: 'research', reason: 'root', tasks: [{ kind: 'root', purpose: 'root' }] },
    { decision: 'research', reason: 'reply', tasks: [{ kind: 'continue_line', purpose: 'reply', evidenceId: 'E1', prefixPlies: 1, move: null }] }
  ], engine: async (input) => ({ ...analysis(input.positionFen, input.positionFen === START_FEN ? rootLine : rootLine.slice(1)), incomplete: true }) })
  test('two operations without any usable new evidence stop without resetting budgets', () => {
    assert.equal(noNovel.engineCalls.length, 2)
    assert.equal(noNovel.trace?.research?.stopReason, 'no_new_evidence')
    assert(noNovel.trace?.research?.operations.every(item => item.status === 'invalid_result' && !item.novel))
    assert.equal(noNovel.trace?.evidence.length, 1)
  })
  const exhausted = await runScenario({ budget: { engineTimeMs: 50, maxEngineRounds: 3, maxModelCalls: 6, maxOutputTokens: 10000 } })
  test('exhausted engine allocation does not issue a planner or a zero-length engine query', () => {
    assert.equal(exhausted.plannerCalls, 0)
    assert.equal(exhausted.engineCalls.length, 0)
    assert.equal(exhausted.trace?.research?.stopReason, 'engine_time_budget')
  })
  console.log(`Question research checks: ${passed} passed.`)
}

main().catch(error => { console.error(error); process.exitCode = 1 })
