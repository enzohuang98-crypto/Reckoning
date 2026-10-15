import assert from 'node:assert/strict'
import type { ConversationMessage } from '../../../src/shared/types/AppData'
import {
  buildConversationHistoryForRequest,
  HISTORY_TRUNCATION_MARKER,
  MAX_REQUEST_HISTORY_MESSAGE_CHARS,
  MAX_REQUEST_HISTORY_MESSAGES
} from '../../../src/renderer/src/features/analysis/aiRequest'

function message(index: number, text: string): ConversationMessage {
  return {
    id: `m${index}`,
    role: index % 2 === 0 ? 'user' : 'assistant',
    text,
    createdAt: '2026-10-15T00:00:00.000Z'
  }
}

assert.equal(buildConversationHistoryForRequest(undefined), undefined)
assert.deepEqual(buildConversationHistoryForRequest([]), [])

const many = Array.from({ length: 10 }, (_, index) => message(index, `第 ${index} 則`))
const recent = buildConversationHistoryForRequest(many)!
assert.equal(recent.length, MAX_REQUEST_HISTORY_MESSAGES)
assert.deepEqual(recent.map((item) => item.id), ['m4', 'm5', 'm6', 'm7', 'm8', 'm9'])

const long = 'x'.repeat(5_000)
const [truncated] = buildConversationHistoryForRequest([message(1, long)])!
assert.equal(
  truncated.text,
  `${'x'.repeat(MAX_REQUEST_HISTORY_MESSAGE_CHARS)}${HISTORY_TRUNCATION_MARKER}`
)
assert.equal(many[0].text, '第 0 則', 'original conversation must not be mutated')

const exact = 'y'.repeat(MAX_REQUEST_HISTORY_MESSAGE_CHARS)
assert.equal(buildConversationHistoryForRequest([message(1, exact)])![0].text, exact)
console.log('aiRequest tests passed')
