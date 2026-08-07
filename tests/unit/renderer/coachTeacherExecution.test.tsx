import assert from 'node:assert/strict'
import * as React from 'react'
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer'
import { CoachView } from '../../../src/renderer/src/features/analysis/CoachView'
import type { GenerateExplanationDonePayload } from '../../../src/shared/types/ipc'

function textContent(node: ReactTestInstance): string {
  return node.children
    .map((child) => (typeof child === 'string' ? child : textContent(child)))
    .join('')
}

function props(
  teacherExecution: GenerateExplanationDonePayload['teacherExecution'],
  copied: string[]
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
    teacherTestStatus: {
      currentAppVersion: '0.3.11',
      active: true,
      manifest: null
    },
    teacherExecution: teacherExecution ?? null,
    followUp: '',
    onFollowUpChange: () => undefined,
    onGenerate: () => undefined,
    onContinue: () => undefined,
    onCancel: () => undefined,
    onSubmitFollowUp: () => undefined,
    onCopy: () => undefined,
    onCopyTeacherId: (value) => copied.push(value),
    onFeedback: () => undefined
  }
}

const copied: string[] = []
let renderer: ReactTestRenderer
act(() => {
  renderer = create(
    <CoachView
      {...props(
        {
          interactionKind: 'teacher-prelude',
          executionSemanticsVersion: 2
        },
        copied
      )}
    />
  )
})
assert.match(textContent(renderer!.root), /fixture-only、teacher-confirmation-pending/)
assert.match(textContent(renderer!.root), /不會把上方 prelude 或先前對話送入模型/)
assert.match(textContent(renderer!.root), /非 frozen-case 問題會被阻止/)
assert.match(textContent(renderer!.root), /prelude，不計入正式案例/)

act(() => {
  renderer!.update(
    <CoachView
      {...props(
        {
          interactionKind: 'teacher-formal-case',
          executionSemanticsVersion: 2,
          caseSetId: 'teacher-test-cases-v1',
          caseSetStatus: 'fixture-only; teacher-confirmation-pending',
          caseKey: 'opening-development',
          testCaseId: 'case-id-123',
          externalReviewId: 'review-id-456'
        },
        copied
      )}
    />
  )
})
const formalText = textContent(renderer!.root)
assert.match(formalText, /老師凍結案例已記錄/)
assert.match(formalText, /testCaseId：case-id-123/)
assert.match(formalText, /externalReviewId：review-id-456/)
const copyButtons = renderer!.root
  .findAllByType('button')
  .filter((button) => textContent(button) === '複製')
assert.equal(copyButtons.length, 2)
act(() => {
  copyButtons[0].props.onClick()
  copyButtons[1].props.onClick()
})
assert.deepEqual(copied, ['case-id-123', 'review-id-456'])
act(() => renderer!.unmount())

console.log('Coach teacher execution renderer checks passed.')
