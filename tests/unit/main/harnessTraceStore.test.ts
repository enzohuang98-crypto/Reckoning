import { strict as assert } from 'node:assert'
import { HarnessTraceStore } from '../../../src/main/storage/HarnessTraceStore'
import type { HarnessTrace } from '../../../src/shared/types/Harness'

const trace = {
  id: 'trace-allowlist',
  createdAt: new Date().toISOString(),
  positionFen: '4k4/9/9/9/9/9/9/9/9/4K4 w',
  mode: 'research',
  primaryEngineId: 'engine-1',
  phases: [],
  evidence: [],
  validationErrors: [],
  modelCalls: 1,
  engineRounds: 1,
  status: 'completed',
  providerDiagnostic: {
    stage: 'generation',
    category: 'generation_incomplete',
    reason: 'output_truncated',
    retryable: true,
    finishReason: 'length',
    outputTokens: 2500,
    message: 'safe diagnostic'
  },
  finalText: 'safe text',
  apiKey: 'should-never-export',
  authorization: 'Bearer should-never-export',
  absolutePath: 'C:\\Users\\teacher\\secrets.json'
} as unknown as HarnessTrace & Record<string, unknown>

let written: unknown = null
const store = new HarnessTraceStore({
  read: () => [trace],
  write: (_name: string, value: unknown) => {
    written = value
  }
} as never)

const exported = store.listForExport()
assert.equal(exported.length, 1)
assert.equal(JSON.stringify(exported).includes('should-never-export'), false)
assert.equal(JSON.stringify(exported).includes('secrets.json'), false)
assert.equal(Object.prototype.hasOwnProperty.call(exported[0], 'apiKey'), false)
assert.deepEqual(exported[0].providerDiagnostic, {
  stage: 'generation',
  category: 'generation_incomplete',
  reason: 'output_truncated',
  retryable: true,
  finishReason: 'length',
  outputTokens: 2500,
  message: 'safe diagnostic'
})

const teacherRunId = 'teacher-run-a'
const teacherTrace = {
  ...trace,
  id: 'trace-teacher-run-a',
  evaluation: {
    schemaVersion: 1,
    testRunId: teacherRunId,
    testCaseId: 'case-a',
    canonicalizationVersion: 1,
    externalReviewId: 'review-a'
  },
  interactionKind: 'teacher-formal-case',
  executionSemanticsVersion: 2,
  teacherCaseSetId: 'teacher-test-cases-v1',
  teacherCaseKey: 'case-a',
  feedback: 'incorrect'
} as unknown as HarnessTrace
const previousRunTrace = {
  ...trace,
  id: 'trace-previous-run',
  evaluation: {
    schemaVersion: 1,
    testRunId: 'teacher-run-previous',
    testCaseId: 'case-previous',
    canonicalizationVersion: 1,
    externalReviewId: 'review-previous'
  },
  feedback: 'incorrect'
} as unknown as HarnessTrace
const runScopedStore = new HarnessTraceStore({
  read: () => [teacherTrace, previousRunTrace]
} as never)
assert.deepEqual(
  runScopedStore.listForExport(teacherRunId).map((item) => item.id),
  ['trace-teacher-run-a']
)
assert.deepEqual(
  runScopedStore.listRegressionCases(teacherRunId).map((item) => item.traceId),
  ['trace-teacher-run-a']
)
const exportedTeacherTrace = runScopedStore.listForExport(teacherRunId)[0]
assert.equal(exportedTeacherTrace.interactionKind, 'teacher-formal-case')
assert.equal(exportedTeacherTrace.executionSemanticsVersion, 2)
assert.equal(exportedTeacherTrace.teacherCaseSetId, 'teacher-test-cases-v1')
assert.equal(exportedTeacherTrace.teacherCaseKey, 'case-a')
assert.equal(
  Object.prototype.hasOwnProperty.call(runScopedStore.listForExport('teacher-run-previous')[0], 'executionSemanticsVersion'),
  false,
  '舊 trace 不得被推斷成 v2 isolated-input evidence'
)

const partialUsageTrace = { ...trace, usage: { inputTokens: 30, finishReason: 'stop', apiKey: 'should-never-export' } } as HarnessTrace
const partialUsageStore = new HarnessTraceStore({ read: () => [partialUsageTrace] } as never)
assert.deepEqual(partialUsageStore.listForExport()[0].usage, { inputTokens: 30, finishReason: 'stop' },
  'Partial provider counts retain reported fields without inventing output or exporting unknown keys')

store.save(trace)
assert(written)
assert.equal(JSON.stringify(written).includes('should-never-export'), false)
assert.equal(JSON.stringify(written).includes('secrets.json'), false)

const privateFields = { prompt: 'should-never-export', headers: { authorization: 'should-never-export' },
  apiKey: 'should-never-export', rawLines: ['should-never-export'], rawReasoning: 'should-never-export' }
const origin = { operationId: 'research-op', searchPositionFen: trace.positionFen,
  searchSideToMove: 'black', prefix: ['h2e2'], searchDepth: 18,
  searchPrincipalVariation: Array(40).fill('h9g7'), omittedSearchPlies: 2,
  searchUserMove: 'b9c7', lineRole: 'hypothesis', rootRelativeEvaluation: 'unknown', ...privateFields }
const update = { requestId: 'research-r', operationId: 'research-op', phase: 'root_analysis',
  positionFen: trace.positionFen, sideToMove: 'black', depth: 18, candidateRank: 2,
  principalVariation: Array(40).fill('h9g7'), displayPrincipalVariation: Array(40).fill('馬8進7'),
  omittedPlies: 3, provisional: true, ...privateFields }
const researchRecord = { ...trace,
  modelCallDiagnostics: [{ callIndex: 1, stage: 'research_planner', model: 'synthetic-model',
    maxOutputTokens: 1000, responseFormat: 'json', reasoningPolicy: 'bounded_1000_excluded', reasoningMaxTokens: 250,
    durationMs: 20, status: 'completed', ...privateFields }],
  evidence: [{ id: 'E2', engineId: 'test', engineName: 'test', purpose: 'legal continuation',
    positionFen: trace.positionFen, displayMove: '炮二平五', depth: null, score: null,
    displayPrincipalVariation: ['炮二平五', '馬8進7'], researchOrigin: origin,
    analysis: { positionFen: trace.positionFen, sideToMove: 'red', bestMove: 'h2e2',
      scoreAfterUserMove: null, scoreAfterBestMove: null, evaluationAfterUserMove: null,
      evaluationAfterBestMove: null, userMoveEvaluationSource: 'unavailable', depth: null,
      candidateMoves: [], principalVariation: ['h2e2', 'h9g7'], incomplete: false,
      warnings: [], engineName: 'test', rawAnalysis: { root: ['should-never-export'] }, ...privateFields } }],
  research: { stopReason: 'no_new_evidence', operations: [{ id: 'research-op', kind: 'continue_line',
    purpose: 'legal continuation', positionFen: trace.positionFen, sourceEvidenceId: 'E1',
    prefix: ['h2e2'], allocatedMs: 3000, status: 'completed', evidenceIds: ['E2'], novel: true, ...privateFields }],
    updates: [...Array.from({ length: 100 }, () => ({ ...update })),
      { ...update, candidateRank: 7 }, { ...update, operationId: 'foreign-operation' },
      { ...update, principalVariation: ['raw info depth should-never-export'] }],
    updatesSeen: 104, omittedUpdates: 4, invalidUpdates: 1, ...privateFields }
}
const researchStore = new HarnessTraceStore({ read: () => [researchRecord] } as never)
const persistedResearch = researchStore.listForExport()[0]!
assert.equal(persistedResearch.modelCallDiagnostics?.[0]?.stage, 'research_planner')
assert.equal(persistedResearch.modelCallDiagnostics?.[0]?.reasoningMaxTokens, 250)
assert.equal(persistedResearch.modelCallDiagnostics?.[0]?.reasoningTokens, undefined,
  'the requested ceiling cannot become measured reasoning consumption')
for (const invalidCeiling of [-1, 0, 1.5, 1001, '250']) {
  const invalid = { ...researchRecord, modelCallDiagnostics: researchRecord.modelCallDiagnostics.map(item =>
    ({ ...item, reasoningMaxTokens: invalidCeiling })) }
  assert.equal(new HarnessTraceStore({ read: () => [invalid] } as never).listForExport()[0]?.modelCallDiagnostics?.[0]?.reasoningMaxTokens, undefined)
}
assert.equal(persistedResearch.evidence[0]?.researchOrigin?.lineRole, 'hypothesis')
assert.equal(persistedResearch.evidence[0]?.researchOrigin?.searchDepth, 18)
assert.equal(persistedResearch.evidence[0]?.researchOrigin?.searchSideToMove, 'black')
assert.equal(persistedResearch.evidence[0]?.researchOrigin?.rootRelativeEvaluation, 'unknown')
assert.equal(persistedResearch.evidence[0]?.researchOrigin?.searchPrincipalVariation.length, 32)
assert.equal(persistedResearch.evidence[0]?.researchOrigin?.omittedSearchPlies, 10)
assert.equal(persistedResearch.research?.stopReason, 'no_new_evidence')
assert.equal(persistedResearch.research?.updates.length, 96)
assert.equal(persistedResearch.research?.updatesSeen, 104)
assert.equal(persistedResearch.research?.omittedUpdates, 8)
assert.equal(persistedResearch.research?.invalidUpdates, 4)
assert.equal(persistedResearch.research?.updates[0]?.principalVariation.length, 32)
assert.equal(persistedResearch.research?.updates[0]?.omittedPlies, 11)
assert.equal(persistedResearch.research?.updates[0]?.provisional, true)
assert.equal(JSON.stringify(persistedResearch).includes('should-never-export'), false)
const roundTripped = new HarnessTraceStore({ read: () => [persistedResearch] } as never).listForExport()[0]
assert.deepEqual(roundTripped, persistedResearch, 'repeated sanitation must not recount earlier omissions')

const advancedRecord = structuredClone(researchRecord)
const advancedPrefix = ['h2e2', 'h9g7', 'h0g2', 'i9h9', 'i0h0', 'g6g5', 'h0h6', 'c6c5',
  'b2c2', 'c9e7', 'b0a2', 'b9d8', 'a0b0', 'h7i7', 'h6h9', 'g7h9']
advancedRecord.evidence[0]!.researchOrigin.prefix = advancedPrefix
advancedRecord.research.operations[0]!.prefix = advancedPrefix
const advancedStored = new HarnessTraceStore({ read: () => [advancedRecord] } as never).listForExport()[0]!
assert.deepEqual(advancedStored.evidence[0]?.researchOrigin?.prefix, advancedPrefix)
assert.deepEqual(advancedStored.research?.operations[0]?.prefix, advancedPrefix,
  'a legitimate later search cannot silently lose its verified ancestry after eight plies')

console.log('Harness trace allowlist and bounded research provenance checks passed.')
