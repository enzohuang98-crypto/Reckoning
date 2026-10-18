import assert from 'node:assert/strict'
import * as React from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { CoachView } from '../../../src/renderer/src/features/analysis/CoachView'
import type { EngineAnalysisResultPayload } from '../../../src/shared/types/ipc'

const result = {
  requestId: 'engine-1',
  analysisId: 'analysis-1',
  engineAnalysis: { displayUserMove: '馬八進七' },
  moveComparison: {}
} as unknown as EngineAnalysisResultPayload

function props(
  overrides: Partial<React.ComponentProps<typeof CoachView>>
): React.ComponentProps<typeof CoachView> {
  return {
    result: null,
    explanation: null,
    conversation: null,
    submittedGuess: null,
    actualMove: null,
    aiBusy: false,
    streamingText: '',
    harnessProgress: null,
    traceId: null,
    aiBlockedReason: null,
    error: null,
    notice: null,
    followUp: '',
    onFollowUpChange: () => undefined,
    onCancel: () => undefined,
    onSubmitFollowUp: () => undefined,
    onCopy: () => undefined,
    onFeedback: () => undefined,
    ...overrides
  }
}

let submitted = 0
let renderer: ReactTestRenderer
act(() => {
  renderer = create(<CoachView {...props({})} />)
})
assert.equal(renderer!.root.findAllByType('input').length, 0, 'no engine result → no question box')

// 合併「問 AI 教練／猜著練習」後，第一次請求（含第一次 AI 失敗後再問）一律從 AskCoachForm 送出；
// CoachView 的輸入框只負責對已有回答追問，畫面上不會同時出現兩個起點。
act(() => {
  renderer!.update(<CoachView {...props({ result, error: 'AI 服務暫時不可用' })} />)
})
assert.equal(
  renderer!.root.findAllByType('input').length,
  0,
  'no answer yet → no follow-up box; the first question goes through the ask form'
)

const conversation = {
  id: 'conversation-1',
  analysisId: 'analysis-1',
  positionFen: 'fen',
  createdAt: 't',
  updatedAt: 't',
  messages: [
    { id: 'm1', role: 'user', text: '為什麼我這步不好？', createdAt: 't' },
    { id: 'm2', role: 'assistant', text: '因為……', createdAt: 't' }
  ]
} as unknown as NonNullable<React.ComponentProps<typeof CoachView>['conversation']>

act(() => {
  renderer!.update(
    <CoachView
      {...props({
        result,
        conversation,
        followUp: '那我應該怎麼走？',
        onSubmitFollowUp: () => {
          submitted += 1
        }
      })}
    />
  )
})
const [input] = renderer!.root.findAllByType('input')
assert.ok(input, 'follow-up box renders once there is an answer')
assert.match(String(input.props.placeholder), /接著追問/)
const ask = renderer!.root
  .findAllByType('button')
  .find((button) => button.children.join('') === '追問')
assert.ok(ask, 'follow-up uses the 追問 label')
assert.equal(ask.props.disabled, false)
act(() => ask.props.onClick())
assert.equal(submitted, 1)
assert.equal(
  renderer!.root.findAllByType('button').some((button) => button.children.join('') === '複製'),
  true,
  'an answer can be copied'
)

act(() => {
  renderer!.update(<CoachView {...props({ result, conversation, aiBusy: true, followUp: 'x' })} />)
})
assert.equal(renderer!.root.findAllByType('input')[0].props.disabled, true)

act(() => {
  renderer!.update(<CoachView {...props({ result, conversation, showQuestion: false })} />)
})
assert.equal(renderer!.root.findAllByType('input').length, 0, 'showQuestion=false hides the follow-up box')
act(() => renderer!.unmount())
console.log('Coach question input renderer checks passed.')
