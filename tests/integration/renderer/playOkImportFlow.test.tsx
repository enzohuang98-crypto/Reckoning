import assert from 'node:assert/strict'
import * as React from 'react'
import { performance } from 'node:perf_hooks'
import {
  act,
  create,
  type ReactTestInstance,
  type ReactTestRenderer
} from 'react-test-renderer'
import {
  GameImportPanel,
  type ImportedMoveSelection
} from '../../../src/renderer/src/features/board/GameImportPanel'
import { parseFen } from '../../../src/shared/logic/board/fen'
import { START_FEN } from '../../../src/shared/types/BoardState'

const WXF = `FORMAT  WXF
RED test
BLACK test
RESULT  *
START{
 1. C8.5 h2+3   2. H8+7 r1.2
}END`

function textContent(node: ReactTestInstance): string {
  return node.children
    .map((child) => (typeof child === 'string' ? child : textContent(child)))
    .join('')
}

function buttonByText(root: ReactTestInstance, label: string): ReactTestInstance {
  const button = root
    .findAllByType('button')
    .find((candidate) => textContent(candidate).includes(label))
  assert.ok(button, `找不到按鈕：${label}`)
  return button
}

function main(): void {
  const start = parseFen(START_FEN)
  assert.equal(start.valid, true)
  if (!start.valid) throw new Error(start.message)

  const boardChanges: string[] = []
  const selections: ImportedMoveSelection[] = []
  let renderer: ReactTestRenderer | null = null
  try {
    act(() => {
      renderer = create(
        <GameImportPanel
          board={start.board}
          onBoardChange={(board) => boardChanges.push(board.fen)}
          onMoveSelect={(selection) => selections.push(selection)}
        />
      )
    })
    assert.ok(renderer)
    const textarea = renderer.root.findByType('textarea')
    act(() => textarea.props.onChange({ target: { value: WXF } }))
    act(() => buttonByText(renderer.root, '從開局匯入').props.onClick())

    assert.equal(boardChanges.length, 1)
    assert.match(textContent(renderer.root), /1\.C8\.5/)
    const clickedAt = performance.now()
    act(() => buttonByText(renderer.root, '1.C8.5').props.onClick())
    const statusVisibleAt = performance.now()

    assert.ok(statusVisibleAt - clickedAt < 200, '選步狀態必須在 200ms 內同步可見')
    assert.equal(selections.length, 1)
    assert.equal(selections[0].position.fen, START_FEN, '第一手必須綁走前局面')
    assert.equal(selections[0].move, 'b2e2')
    assert.equal(selections[0].displayMove, 'C8.5')
    assert.equal(selections[0].plyIndex, 0)
    assert.match(textContent(renderer.root), /已選第 1 手 C8\.5，正在比較實戰步與 AI 首選/)
    const status = renderer.root.findAll(
      (node) => node.props.role === 'status'
    )
    assert.equal(status.length, 1)

    act(() => buttonByText(renderer.root, '1.C8.5').props.onClick())
    assert.equal(selections.length, 2, '重按同一手也必須產生新的明確選取事件')
    console.log('PlayOK renderer import flow tests passed')
  } finally {
    if (renderer) act(() => renderer?.unmount())
  }
}

main()
