/**
 * 擺棋編輯器 (BoardEditor)
 *
 * 手動擺棋：選取調色盤棋子後點擊棋盤交叉點放置；選「清除」可移除棋子。
 * 可切換輪走方。每次變更即時重算 FEN 回呼上層。
 */

import { useState } from 'react'
import { XiangqiBoard } from './XiangqiBoard'
import { PIECE_PALETTE, makePiece } from '../logic/pieces'
import { serializeFen } from '@shared/logic/fen'
import type { BoardState, PieceColor, PieceType } from '@shared/types/BoardState'

interface Props {
  board: BoardState
  onChange: (board: BoardState) => void
}

type Tool =
  | { kind: 'piece'; color: PieceColor; type: PieceType }
  | { kind: 'erase' }

export function BoardEditor({ board, onChange }: Props): JSX.Element {
  const [tool, setTool] = useState<Tool>({ kind: 'piece', color: 'red', type: 'king' })

  const reserialize = (next: BoardState): void => {
    onChange({
      ...next,
      fen: serializeFen(next.grid, next.sideToMove, next.halfmoveClock, next.fullmoveNumber)
    })
  }

  const handleCellClick = (row: number, col: number): void => {
    const grid = board.grid.map((r) => r.slice())
    if (tool.kind === 'erase') {
      grid[row][col] = null
    } else {
      grid[row][col] = makePiece(tool.type, tool.color)
    }
    reserialize({ ...board, grid })
  }

  const setSide = (sideToMove: PieceColor): void => {
    reserialize({ ...board, sideToMove })
  }

  const renderPalette = (color: PieceColor): JSX.Element => (
    <div className="palette-group">
      <span className="palette-label">{color === 'red' ? '紅方' : '黑方'}</span>
      <div className="palette-row">
        {PIECE_PALETTE[color].map((p) => {
          const active =
            tool.kind === 'piece' && tool.color === color && tool.type === p.type
          return (
            <button
              key={`${color}-${p.type}`}
              className={`palette-piece ${color} ${active ? 'active' : ''}`}
              onClick={() => setTool({ kind: 'piece', color, type: p.type })}
              title={p.type}
            >
              {p.glyph}
            </button>
          )
        })}
      </div>
    </div>
  )

  return (
    <div className="board-editor">
      <div className="board-wrap">
        <XiangqiBoard grid={board.grid} onCellClick={handleCellClick} />
      </div>
      <div className="editor-controls">
        <h3>擺棋工具</h3>
        {renderPalette('red')}
        {renderPalette('black')}
        <div className="palette-group">
          <button
            className={`btn ${tool.kind === 'erase' ? 'danger' : 'ghost'}`}
            onClick={() => setTool({ kind: 'erase' })}
          >
            🧹 清除棋子
          </button>
        </div>
        <div className="palette-group">
          <span className="palette-label">輪走方</span>
          <div className="row gap">
            <button
              className={`btn ${board.sideToMove === 'red' ? '' : 'ghost'}`}
              onClick={() => setSide('red')}
            >
              紅方先
            </button>
            <button
              className={`btn ${board.sideToMove === 'black' ? '' : 'ghost'}`}
              onClick={() => setSide('black')}
            >
              黑方先
            </button>
          </div>
        </div>
        <div className="palette-group">
          <span className="palette-label">目前 FEN</span>
          <code className="fen-output">{board.fen}</code>
        </div>
      </div>
    </div>
  )
}
