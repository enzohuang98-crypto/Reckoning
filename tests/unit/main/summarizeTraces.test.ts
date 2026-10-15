import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  formatTraceSummary,
  normalizeValidationError,
  summarizeTraces
} from '../../../tools/acceptance/summarize-traces'

const exported: unknown = JSON.parse(
  readFileSync(new URL('../../fixtures/harness-traces/sample-export.json', import.meta.url), 'utf8')
)
const summary = summarizeTraces(exported)

assert.equal(summary.traceCount, 3)
assert.deepEqual(summary.status, { failed: 2, completed: 1 })
assert.deepEqual(summary.pipelineVersion, { v1: 2, v2: 1 })
assert.deepEqual(summary.answerKind, { ai: 1 })
assert.deepEqual(summary.providerFailures, {
  'generation_incomplete / output_truncated': 1,
  'rate_limited / HTTP 429': 1
})
assert.deepEqual(summary.models, { 'vendor/a:free': 2, 'vendor/b:free': 1 })
assert.deepEqual(summary.modelCalls, { '1': 2, '2': 1 })
assert.equal(summary.durationMs.median, 30000)
assert.equal(summary.durationMs.max, 100500)
// 兩個不同編號、不同著法的因果鏈錯誤歸為同一類，且同一 trace 內只算一次。
assert.deepEqual(summary.topValidationErrors[0], { error: '一鍵完整解說正文只有 N 個漢字', count: 2 })
assert.deepEqual(summary.topValidationErrors[1], { error: '# 缺少「…」的因果鏈', count: 1 })
assert.equal(normalizeValidationError('K12 第 3 段'), '# 第 N 段')

const text = formatTraceSummary(summary)
for (const secret of ['SECRET-FEN', 'SECRET-QUESTION', 'SECRET-FINAL-TEXT', '炮二平五']) {
  assert.equal(text.includes(secret), false, `summary must not leak ${secret}`)
}
assert.equal(summarizeTraces(null).traceCount, 0)
console.log('summarizeTraces tests passed')
