import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import {
  XiangqiBoard,
  boardCellAriaLabel,
  nextBoardCell
} from '../../src/renderer/src/features/board/XiangqiBoard'
import type { BoardGrid } from '../../src/shared/types/BoardState'

const emptyGrid: BoardGrid = Array.from({ length: 10 }, () => Array(9).fill(null))
emptyGrid[0][0] = { type: 'rook', color: 'black', code: 'r' }
emptyGrid[9][4] = { type: 'king', color: 'red', code: 'K' }

assert.deepEqual(nextBoardCell(5, 4, 'ArrowUp'), [4, 4])
assert.deepEqual(nextBoardCell(5, 4, 'ArrowDown'), [6, 4])
assert.deepEqual(nextBoardCell(5, 4, 'ArrowLeft'), [5, 3])
assert.deepEqual(nextBoardCell(5, 4, 'ArrowRight'), [5, 5])
assert.deepEqual(nextBoardCell(0, 0, 'ArrowUp'), [0, 0])
assert.deepEqual(nextBoardCell(0, 0, 'ArrowLeft'), [0, 0])
assert.deepEqual(nextBoardCell(9, 8, 'ArrowDown'), [9, 8])
assert.deepEqual(nextBoardCell(9, 8, 'ArrowRight'), [9, 8])

assert.equal(boardCellAriaLabel(emptyGrid, 0, 0), '第 1 橫列、第 1 直行，黑方車')
assert.equal(boardCellAriaLabel(emptyGrid, 4, 3), '第 5 橫列、第 4 直行，空位')
assert.equal(boardCellAriaLabel(emptyGrid, 9, 4), '第 10 橫列、第 5 直行，紅方帥')

const interactiveBoard = renderToStaticMarkup(
  createElement(XiangqiBoard, { grid: emptyGrid, onCellClick: () => undefined })
)
assert.match(interactiveBoard, /role="grid"/)
assert.match(interactiveBoard, /aria-rowcount="10"/)
assert.match(interactiveBoard, /aria-colcount="9"/)
assert.equal(interactiveBoard.match(/role="row"/g)?.length, 10)
assert.equal(interactiveBoard.match(/role="gridcell"/g)?.length, 90)
assert.equal(interactiveBoard.match(/tabindex="0"/g)?.length, 1)
assert.equal(interactiveBoard.match(/tabindex="-1"/g)?.length, 89)

const staticBoard = renderToStaticMarkup(createElement(XiangqiBoard, { grid: emptyGrid }))
assert.match(staticBoard, /role="img"/)
assert.doesNotMatch(staticBoard, /role="gridcell"/)
assert.doesNotMatch(staticBoard, /tabindex=/)

const highlightedBoard = renderToStaticMarkup(
  createElement(XiangqiBoard, { grid: emptyGrid, highlightedMove: 'a9a8' })
)
assert.match(highlightedBoard, /actual-move-highlight/)
assert.match(highlightedBoard, /marker-end="url\(#actual-move-arrow\)"/)

const source = readFileSync(
  resolve('src/renderer/src/features/board/XiangqiBoard.tsx'),
  'utf8'
)

assert.match(source, /role=\{interactive \? 'grid' : 'img'\}/)
assert.match(source, /role="row"/)
assert.match(source, /role="gridcell"/)
assert.match(source, /aria-rowcount=\{interactive \? BOARD_ROWS : undefined\}/)
assert.match(source, /aria-colcount=\{interactive \? BOARD_COLS : undefined\}/)
assert.match(source, /tabIndex=\{isActive \? 0 : -1\}/)
assert.match(source, /event\.key === 'Enter' \|\| event\.key === ' '/)
assert.match(source, /onCellClick\?\.\(row, col\)/)
assert.match(source, /aria-hidden="true"/)
assert.match(source, /highlightedMove \? parseUciMove\(highlightedMove\) : null/)

console.log('  ✓ 棋盤具備 10×9 grid 語義、座標名稱、roving tabindex 與完整鍵盤操作')
