import assert from 'node:assert/strict'
import React from 'react'
import TestRenderer from 'react-test-renderer'
import { parseFen } from '../../../src/shared/logic/board/fen'
import { START_FEN } from '../../../src/shared/types/BoardState'
import { BoardEditor } from '../../../src/renderer/src/features/board/BoardEditor'

const parsed = parseFen(START_FEN)
assert.equal(parsed.valid, true)
if (!parsed.valid) process.exit(1)

const originalWindow = globalThis.window
Object.defineProperty(globalThis, 'window', {
  configurable: true,
  value: {
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    confirm: () => true
  }
})

try {
  let renderer!: TestRenderer.ReactTestRenderer
  TestRenderer.act(() => {
    renderer = TestRenderer.create(
      <BoardEditor
        board={parsed.board}
        onChange={() => undefined}
        toolsOpen={false}
        guessSelectionActive={false}
        onGuessMoveSelected={() => undefined}
        onGuessSelectionCancel={() => undefined}
        savedPositions={[]}
        onSavePosition={() => undefined}
        onLoadSavedPosition={() => undefined}
        onDeleteSavedPosition={() => undefined}
        replayCandidates={[
          {
            move: 'h2e2',
            displayMove: '炮二平五',
            score: null,
            evaluation: null,
            depth: 18,
            principalVariation: ['h2e2', 'h9g7'],
            displayPrincipalVariation: ['炮二平五', '马8进7']
          }
        ]}
      />
    )
  })

  const boardWrap = renderer.root.find(
    (node) => node.type === 'div' && node.props.className === 'board-wrap'
  )
  TestRenderer.act(() => {
    boardWrap.props.onContextMenu({
      preventDefault: () => undefined,
      clientX: 120,
      clientY: 80
    })
  })
  const openReplay = renderer.root.findAllByType('button').find(
    (button) => button.children.join('') === '查看引擎想法'
  )
  assert(openReplay)
  assert.equal(openReplay.props.disabled, false)

  TestRenderer.act(() => openReplay.props.onClick())
  assert.equal(renderer.root.findAll((node) => node.props.role === 'dialog').length, 1)
  const next = renderer.root.findAllByType('button').find(
    (button) => button.children.join('') === '下一步 →'
  )
  assert(next)
  TestRenderer.act(() => next.props.onClick())
  assert.match(
    renderer.root.findAllByType('span').map((node) => node.children.join('')).join(' '),
    /第 1 手：炮二平五/
  )
  console.log('棋盘右键 PV 重播 UI 测试：通过')
} finally {
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: originalWindow
  })
}
