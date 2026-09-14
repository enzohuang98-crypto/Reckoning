import assert from 'node:assert/strict'
import * as React from 'react'
import { act, create, type ReactTestInstance } from 'react-test-renderer'
import { HarnessProgressCard } from '../../../src/renderer/src/features/analysis/HarnessProgressCard'
import type { HarnessProgressPayload } from '../../../src/shared/types/Harness'

function textContent(node: ReactTestInstance): string {
  return node.children
    .map((child) => (typeof child === 'string' ? child : textContent(child)))
    .join('')
}

let now = 10_000
let interval: (() => void) | null = null
const originalNow = Date.now
const previousWindow = Object.getOwnPropertyDescriptor(globalThis, 'window')
Date.now = () => now
Object.defineProperty(globalThis, 'window', {
  configurable: true,
  value: {
    setInterval: (callback: () => void) => {
      interval = callback
      return 1
    },
    clearInterval: () => {
      interval = null
    }
  }
})

const progress: HarnessProgressPayload = {
  requestId: 'timer-request',
  phase: 'consequence_review',
  message: 'waiting',
  elapsedMs: 0,
  modelCallsUsed: 1,
  engineRoundsUsed: 0,
  evidenceCount: 2,
  depth: 12,
  displayPrincipalVariation: [],
  verifiedConsequenceCount: 0
}

try {
  let renderer!: ReturnType<typeof create>
  act(() => {
    renderer = create(
      <HarnessProgressCard progress={progress} onContinue={() => undefined} onCancel={() => undefined} />
    )
  })
  assert.match(textContent(renderer.root), /等待 AI 回覆與整理解說 · 0 秒/)
  now += 1_100
  act(() => interval?.())
  assert.match(textContent(renderer.root), /等待 AI 回覆與整理解說 · 1 秒/)
  now += 1_000
  act(() => interval?.())
  assert.match(textContent(renderer.root), /等待 AI 回覆與整理解說 · 2 秒/)
  assert.match(textContent(renderer.root), /取消 AI 解說/)
  act(() => renderer.unmount())
  assert.equal(interval, null)
  console.log('Harness progress timer checks passed')
} finally {
  Date.now = originalNow
  if (previousWindow) Object.defineProperty(globalThis, 'window', previousWindow)
  else Reflect.deleteProperty(globalThis, 'window')
}
