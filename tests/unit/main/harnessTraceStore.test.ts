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

async function main(): Promise<void> {
let written: unknown = null
const store = new HarnessTraceStore({
  readAsync: async () => [trace],
  writeAsync: async (_name: string, value: unknown) => {
    written = value
  }
} as never)

const exported = await store.listForExport()
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
  readAsync: async () => [legacyTeacherTrace, ordinaryV2Trace, trace]
} as never)
const legacyExport = await legacyStore.listForExport()
assert.deepEqual(
  legacyExport.map((item) => item.id),
  ['trace-legacy-teacher', 'trace-ordinary-v2', trace.id]
)
assert.deepEqual(
  (await legacyStore.listRegressionCases()).map((item) => item.traceId),
  ['trace-legacy-teacher', 'trace-ordinary-v2']
)
const exportedLegacy = legacyExport[0] as unknown as Record<string, unknown>
for (const key of ['evaluation', 'interactionKind', 'teacherCaseSetId', 'teacherCaseKey']) {
  assert.equal(key in exportedLegacy, false, `${key} 不得出現在匯出中`)
}
assert.equal(legacyExport[1].interactionKind, 'ordinary')
assert.equal(legacyExport[1].executionSemanticsVersion, 2)
assert.equal(
  Object.prototype.hasOwnProperty.call(legacyExport[2], 'executionSemanticsVersion'),
  false,
  '舊 trace 不得被推斷成 v2 isolated-input evidence'
)

await store.save(trace)
assert(written)
assert.equal(JSON.stringify(written).includes('should-never-export'), false)
assert.equal(JSON.stringify(written).includes('secrets.json'), false)

// 讀寫都是非同步，但同一個 store 的操作依序執行：連續 save 與 setFeedback 不會互相覆蓋。
let disk: unknown = []
const slowStore = new HarnessTraceStore({
  readAsync: async () => {
    await new Promise((done) => setTimeout(done, 5))
    return disk
  },
  writeAsync: async (_name: string, value: unknown) => {
    await new Promise((done) => setTimeout(done, 5))
    disk = value
  }
} as never)
const traceA = { ...trace, id: 'trace-a' } as HarnessTrace
const traceB = { ...trace, id: 'trace-b' } as HarnessTrace
await Promise.all([
  slowStore.save(traceA),
  slowStore.save(traceB),
  slowStore.setFeedback('trace-a', 'incorrect')
])
const afterConcurrent = await slowStore.list()
assert.deepEqual(afterConcurrent.map((item) => item.id), ['trace-b', 'trace-a'])
assert.equal(afterConcurrent.find((item) => item.id === 'trace-a')?.feedback, 'incorrect')

// 一次寫入失敗不會卡住之後的操作。
let failNext = true
const flakyStore = new HarnessTraceStore({
  readAsync: async () => [],
  writeAsync: async () => {
    if (failNext) {
      failNext = false
      throw new Error('disk full')
    }
  }
} as never)
await assert.rejects(flakyStore.save(traceA), /disk full/)
await flakyStore.save(traceB)

console.log('Harness trace allowlist checks passed.')
}

main().catch((error: unknown) => {
  console.error(error)
  process.exitCode = 1
})
