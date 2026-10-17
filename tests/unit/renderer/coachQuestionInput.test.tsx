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
    onContinue: () => undefined,
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

// 第一次 AI 失敗（error 有值、沒有對話）時仍可直接提問。
act(() => {
  renderer!.update(
    <CoachView
      {...props({
        result,
        error: 'AI 服務暫時不可用',
        followUp: '為什麼我這步不好？',
        onSubmitFollowUp: () => {
          submitted += 1
        }
      })}
    />
  )
})
const [input] = renderer!.root.findAllByType('input')
assert.ok(input, 'question box must render once an engine result exists')
assert.match(String(input.props.placeholder), /直接問/)
const ask = renderer!.root
  .findAllByType('button')
  .find((button) => button.children.join('') === '提問')
assert.ok(ask, 'first question uses the 提問 label')
assert.equal(ask.props.disabled, false)
act(() => ask.props.onClick())
assert.equal(submitted, 1)
assert.equal(
  renderer!.root.findAllByType('button').some((button) => button.children.join('') === '複製'),
  false,
  'nothing to copy before any answer'
)

act(() => {
  renderer!.update(<CoachView {...props({ result, aiBusy: true, followUp: 'x' })} />)
})
assert.equal(renderer!.root.findAllByType('input')[0].props.disabled, true)

// 猜著練習尚未提交時，畫面上只留「你的走法」一個輸入處。
act(() => {
  renderer!.update(<CoachView {...props({ result, showQuestion: false })} />)
})
assert.equal(
  renderer!.root.findAllByType('input').length,
  0,
  'guess drafting hides the question box so there is only one place to type'
)
act(() => renderer!.unmount())
console.log('Coach question input renderer checks passed.')
