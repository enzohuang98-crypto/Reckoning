/**
 * 擺棋編輯器 (BoardEditor)
 *
 * 手動擺棋：預設為移動模式；先點棋子、再點目的地即可搬移。
 * 選取調色盤棋子後可放置/替換棋子；選「清除」可移除棋子。
 * 可切換輪走方。每次變更即時重算 FEN 回呼上層。
 */

import { useEffect, useState } from 'react'
import { XiangqiBoard } from './XiangqiBoard'
import { PIECE_PALETTE, makePiece } from '../logic/pieces'
import { serializeFen } from '@shared/logic/fen'
import { createEmptyGrid } from '@shared/logic/fen'
import { applyUciMove, formatUciMove } from '@shared/logic/moves'
import type { BoardState, PieceColor, PieceType } from '@shared/types/BoardState'
import type { SavedPosition } from '@shared/types/AppData'

interface Props {
  board: BoardState
  onChange: (board: BoardState) => void
  savedPositions: SavedPosition[]
  onSavePosition: (name: string) => void
  onLoadSavedPosition: (position: SavedPosition) => void
  onDeleteSavedPosition: (id: string) => void
}

type Tool =
  | { kind: 'move' }
  | { kind: 'piece'; color: PieceColor; type: PieceType }
  | { kind: 'erase' }

export function BoardEditor({
  board,
  onChange,
  savedPositions,
  onSavePosition,
  onLoadSavedPosition,
  onDeleteSavedPosition
}: Props): JSX.Element {
  const [tool, setTool] = useState<Tool>({ kind: 'move' })
  const [selected, setSelected] = useState<[number, number] | null>(null)
  const [moveError, setMoveError] = useState<string | null>(null)
  const [positionName, setPositionName] = useState('')

  const selectTool = (next: Tool): void => {
    setSelected(null)
    setMoveError(null)
    setTool((current) => {
      if (
        current.kind === next.kind &&
        (current.kind !== 'piece' ||
          (next.kind === 'piece' &&
            current.color === next.color &&
            current.type === next.type))
      ) {
        return { kind: 'move' }
      }
      return next
    })
  }

  useEffect(() => {
    setSelected(null)
    setMoveError(null)
  }, [board.fen])

  useEffect(() => {
    const cancelSelection = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        setSelected(null)
        setTool({ kind: 'move' })
        setMoveError(null)
      }
    }
    window.addEventListener('keydown', cancelSelection)
    return () => window.removeEventListener('keydown', cancelSelection)
  }, [])

  const reserialize = (next: BoardState): void => {
    onChange({
      ...next,
      fen: serializeFen(next.grid, next.sideToMove, next.halfmoveClock, next.fullmoveNumber)
    })
  }

  const handleCellClick = (row: number, col: number): void => {
    const grid = board.grid.map((r) => r.slice())
    if (tool.kind === 'move') {
      if (!selected) {
        const piece = grid[row][col]
        if (!piece) {
          setMoveError('請先選擇要移動的棋子。')
        } else if (piece.color !== board.sideToMove) {
          setMoveError(`現在輪到${board.sideToMove === 'red' ? '紅' : '黑'}方走。`)
        } else {
          setSelected([row, col])
          setMoveError(null)
        }
        return
      }
      const [fromRow, fromCol] = selected
      if (fromRow === row && fromCol === col) {
        setSelected(null)
        setMoveError(null)
        return
      }
      const target = grid[row][col]
      if (target?.color === board.sideToMove) {
        setSelected([row, col])
        setMoveError(null)
        return
      }
      const move = formatUciMove({ fromRow, fromCol, toRow: row, toCol: col })
      const result = move ? applyUciMove(board, move) : null
      if (!result || !result.valid) {
        setMoveError(result?.message ?? '棋盤座標無效。')
        return
      }
      setSelected(null)
      setMoveError(null)
      onChange(result.board)
      return
    } else if (tool.kind === 'erase') {
      grid[row][col] = null
    } else {
      grid[row][col] = makePiece(tool.type, tool.color)
    }
    reserialize({ ...board, grid })
  }

  const setSide = (sideToMove: PieceColor): void => {
    reserialize({ ...board, sideToMove })
  }

  const clearBoard = (): void => {
    setSelected(null)
    setTool({ kind: 'move' })
    setMoveError(null)
    reserialize({ ...board, grid: createEmptyGrid(), halfmoveClock: 0, fullmoveNumber: 1 })
  }

  const savePosition = (): void => {
    const name = positionName.trim() || `局面 ${savedPositions.length + 1}`
    onSavePosition(name)
    setPositionName('')
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
              onClick={() => selectTool({ kind: 'piece', color, type: p.type })}
              title={`${p.type}（再次點擊可回到移動模式）`}
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
        <XiangqiBoard grid={board.grid} selected={selected} onCellClick={handleCellClick} />
      </div>
      <div className="editor-controls">
        <div className="panel-heading compact">
          <div>
            <span className="eyebrow">BOARD TOOLS</span>
            <h3>擺棋工具</h3>
          </div>
          <span className={`tool-indicator ${tool.kind}`}>
            {tool.kind === 'move' ? '移動' : tool.kind === 'erase' ? '清除' : '放置'}
          </span>
        </div>
        <div className="palette-group">
          <div className="row gap">
            <button
              className={`btn ${tool.kind === 'move' ? '' : 'ghost'}`}
              onClick={() => selectTool({ kind: 'move' })}
            >
              移動棋子
            </button>
            <button
              className={`btn ${tool.kind === 'erase' ? 'danger' : 'ghost'}`}
              onClick={() => selectTool({ kind: 'erase' })}
            >
              清除棋子
            </button>
            <button className="btn danger" onClick={clearBoard}>
              清空棋盤
            </button>
          </div>
          <p className="muted small editor-hint">
            {tool.kind === 'move'
              ? selected
                ? '已選取棋子，請點擊目的地；再點同一格或按 Esc 可取消。'
                : '先點擊要移動的棋子，再點擊目的地。'
              : tool.kind === 'erase'
                ? '點擊棋盤上的棋子即可清除；再次點擊「清除棋子」可退出。'
                : '點擊棋盤可放置或替換棋子；再次點擊目前棋子可退出。'}
          </p>
          {moveError && <div className="error-text small">{moveError}</div>}
        </div>
        {renderPalette('red')}
        {renderPalette('black')}
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
          <span className="palette-label">保存局面</span>
          <div className="row gap">
            <input
              className="text-input"
              value={positionName}
              placeholder="局面名稱（選填）"
              onChange={(event) => setPositionName(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') savePosition()
              }}
            />
            <button className="btn" onClick={savePosition}>
              保存
            </button>
          </div>
          {savedPositions.length > 0 && (
            <ul className="saved-position-list">
              {savedPositions.map((position) => (
                <li key={position.id}>
                  <button className="link-btn" onClick={() => onLoadSavedPosition(position)}>
                    {position.name}
                  </button>
                  <button
                    className="btn ghost small"
                    onClick={() => onDeleteSavedPosition(position.id)}
                  >
                    刪除
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="palette-group">
          <span className="palette-label">目前 FEN</span>
          <code className="fen-output">{board.fen}</code>
        </div>
      </div>
    </div>
  )
}
