import assert from 'node:assert/strict'
import { SseParser } from '../../../src/main/ai/providers/sse'

const parser = new SseParser()
assert.deepEqual(parser.push(': OPENROUTER PROCESSING\n\n'), [])
assert.deepEqual(parser.push('data: {"a":'), [])
assert.deepEqual(parser.push('1}\n'), [])
assert.deepEqual(parser.push('\n'), [{ data: '{"a":1}' }])
assert.deepEqual(parser.push('data: x\r\ndata: y\r\n\r\ndata: [DONE]\n\n'), [
  { data: 'x\ny' },
  { data: '[DONE]' }
])
assert.deepEqual(parser.push('event: message\nid: 3\ndata:no-space\n\n'), [{ data: 'no-space' }])
assert.deepEqual(parser.push('data: tail-without-blank-line'), [])
assert.deepEqual(parser.flush(), [{ data: 'tail-without-blank-line' }])
assert.deepEqual(parser.flush(), [])
console.log('SSE parser tests passed')
