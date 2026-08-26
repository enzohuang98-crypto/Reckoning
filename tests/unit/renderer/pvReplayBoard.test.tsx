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
          },
          {
            move: 'b2e2',
            displayMove: '炮八平五',
            score: null,
            evaluation: null,
            depth: 18,
            principalVariation: ['b2e2', 'b9c7'],
            displayPrincipalVariation: ['炮八平五', '馬2進3']
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
  TestRenderer.act(() => {
    renderer.update(
      <BoardEditor
        board={parsed.board}
        onChange={() => undefined}
        highlightedMove={null}
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
            move: 'b2e2',
            displayMove: '炮八平五',
            score: null,
            evaluation: null,
            depth: 22,
            principalVariation: ['b2e2', 'b9c7', 'b0c2'],
            displayPrincipalVariation: ['炮八平五', '馬2進3', '馬八進七']
          },
          {
            move: 'h2e2',
            displayMove: '炮二平五',
            score: null,
            evaluation: null,
            depth: 22,
            principalVariation: ['h2e2', 'h9g7', 'b0c2'],
            displayPrincipalVariation: ['炮二平五', '馬8進7', '馬八進七']
          }
        ]}
      />
    )
  })
  assert.equal(
    renderer.root.findAll((node) => node.props.role === 'dialog').length,
    1,
    '分析更新時右鍵重播視窗應保持開啟'
  )
  const selectedLine = renderer.root.findAll(
    (node) => node.props.role === 'tab' && node.props['aria-selected'] === true
  )[0]
  assert.match(
    selectedLine.children.join(''),
    /炮二平五/,
    '候選排名重排時應追蹤同一個根著，不得突然跳到另一條主線'
  )
  assert.match(
    renderer.root.findAllByType('span').map((node) => node.children.join('')).join(' '),
    /第 1 手：炮二平五/,
    '候選排名重排時重播棋盤應留在同一條主線與同一步'
  )
  assert.match(
    renderer.root.findAllByType('button').map((button) => button.children.join('')).join(' '),
    /3\. 馬八進七/,
    '右鍵重播視窗應即時顯示引擎新延伸的主線'
  )
  const nextAfterUpdate = renderer.root.findAllByType('button').find(
    (button) => button.children.join('') === '下一步 →'
  )
  assert(nextAfterUpdate)
  TestRenderer.act(() => nextAfterUpdate.props.onClick())
  assert.match(
    renderer.root.findAllByType('span').map((node) => node.children.join('')).join(' '),
    /第 2 手：馬8進7/
  )
  TestRenderer.act(() => {
    renderer.update(
      <BoardEditor
        board={parsed.board}
        onChange={() => undefined}
        highlightedMove={null}
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
            move: 'b2e2',
            displayMove: '炮八平五',
            score: null,
            evaluation: null,
            depth: 23,
            principalVariation: ['b2e2', 'b9c7', 'b0c2'],
            displayPrincipalVariation: ['炮八平五', '馬2進3', '馬八進七']
          },
          {
            move: 'h2e2',
            displayMove: '炮二平五',
            score: null,
            evaluation: null,
            depth: 23,
            principalVariation: ['h2e2', 'c9e7', 'b0c2'],
            displayPrincipalVariation: ['炮二平五', '象7進5', '馬八進七']
          }
        ]}
      />
    )
  })
  assert.match(
    renderer.root.findAllByType('span').map((node) => node.children.join('')).join(' '),
    /第 2 手：馬8進7/,
    '引擎改寫已走過的前綴時，重播棋盤不得在使用者眼前跳局面'
  )
  console.log('棋盘右键 PV 重播 UI 测试：通过')
} finally {
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: originalWindow
  })
}
