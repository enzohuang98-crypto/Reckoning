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

store.save(trace)
assert(written)
assert.equal(JSON.stringify(written).includes('should-never-export'), false)
assert.equal(JSON.stringify(written).includes('secrets.json'), false)

console.log('Harness trace allowlist checks passed.')
