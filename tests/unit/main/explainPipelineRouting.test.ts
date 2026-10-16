import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  configuredExplainPipeline,
  EXPLAIN_PIPELINE,
  selectExplainPipeline
} from '../../../src/main/ai/explain/pipelineFlag'

assert.equal(EXPLAIN_PIPELINE, 'v2')
assert.equal(selectExplainPipeline({ interactionKind: 'ordinary' }, {}), 'v2')
assert.equal(selectExplainPipeline({ interactionKind: 'teacher-prelude' }, {}), 'v1')
assert.equal(selectExplainPipeline({ interactionKind: 'teacher-formal-case' }, {}), 'v1')
assert.equal(selectExplainPipeline({ interactionKind: 'ordinary' }, { XQA_EXPLAIN_PIPELINE: 'v1' }), 'v1', 'environment rollback')
assert.equal(configuredExplainPipeline({ XQA_EXPLAIN_PIPELINE: 'v3' }), 'v2', 'unknown values keep the default')

// IPC handler 必須先依旗標分流，再呼叫 v1 的 prompt 組裝；v2 只走共用的憑證解析。
const handler = readFileSync(new URL('../../../src/main/ipc/aiExplanationHandlers.ts', import.meta.url), 'utf8')
const v2Branch = handler.indexOf("selectExplainPipeline(execution) === 'v2'")
const v1Build = handler.indexOf('const request = await buildAIExplanationRequest(execution')
assert.ok(v2Branch > 0 && v1Build > v2Branch, 'v2 branch precedes v1 prompt assembly')
const v2Block = handler.slice(v2Branch, v1Build)
assert.match(v2Block, /resolveExplanationCredential\(execution/)
assert.doesNotMatch(v2Block, /buildExplanationPrompt|buildAIExplanationRequest/)
assert.match(v2Block, /aiPreferences\(\)\.get\(\)\)\.openRouterBackupModels/)
assert.doesNotMatch(v2Block, /payload\.backup/i, 'renderer cannot name a backup model')
console.log('explain pipeline routing tests passed')
