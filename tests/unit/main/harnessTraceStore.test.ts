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

// 老師測試已移除（P4-5）：舊紀錄中的 teacher 欄位在匯出時一律丟棄，匯出包含所有 trace。
const legacyTeacherTrace = {
  ...trace,
  id: 'trace-legacy-teacher',
  evaluation: {
    schemaVersion: 1,
    testRunId: 'teacher-run-a',
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
const ordinaryV2Trace = {
  ...trace,
  id: 'trace-ordinary-v2',
  interactionKind: 'ordinary',
  executionSemanticsVersion: 2,
  feedback: 'unclear'
} as unknown as HarnessTrace
const legacyStore = new HarnessTraceStore({
  read: () => [legacyTeacherTrace, ordinaryV2Trace, trace]
} as never)
assert.deepEqual(
  legacyStore.listForExport().map((item) => item.id),
  ['trace-legacy-teacher', 'trace-ordinary-v2', trace.id]
)
assert.deepEqual(
  legacyStore.listRegressionCases().map((item) => item.traceId),
  ['trace-legacy-teacher', 'trace-ordinary-v2']
)
const exportedLegacy = legacyStore.listForExport()[0] as unknown as Record<string, unknown>
for (const key of ['evaluation', 'interactionKind', 'teacherCaseSetId', 'teacherCaseKey']) {
  assert.equal(key in exportedLegacy, false, `${key} 不得出現在匯出中`)
}
assert.equal(legacyStore.listForExport()[1].interactionKind, 'ordinary')
assert.equal(legacyStore.listForExport()[1].executionSemanticsVersion, 2)
assert.equal(
  Object.prototype.hasOwnProperty.call(legacyStore.listForExport()[2], 'executionSemanticsVersion'),
  false,
  '舊 trace 不得被推斷成 v2 isolated-input evidence'
)

store.save(trace)
assert(written)
assert.equal(JSON.stringify(written).includes('should-never-export'), false)
assert.equal(JSON.stringify(written).includes('secrets.json'), false)

console.log('Harness trace allowlist checks passed.')
