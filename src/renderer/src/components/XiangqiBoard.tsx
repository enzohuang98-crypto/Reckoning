/**
 * 象棋棋盤渲染 (XiangqiBoard)
 *
 * 以 SVG 繪製 10 列 x 9 行的中國象棋棋盤（含楚河漢界與九宮斜線），
 * 並在交叉點上渲染棋子。支援點擊交叉點回呼。
 */

import type { BoardGrid } from '@shared/types/BoardState'
import { BOARD_COLS, BOARD_ROWS } from '@shared/types/BoardState'
import { pieceGlyph } from '../logic/pieces'

const CELL = 56
const MARGIN = 34
const WIDTH = MARGIN * 2 + CELL * (BOARD_COLS - 1)
const HEIGHT = MARGIN * 2 + CELL * (BOARD_ROWS - 1)
const PIECE_R = 23

interface Props {
  grid: BoardGrid
  /** 被選取的格子（編輯/著法用），以 [row,col] 表示 */
  selected?: [number, number] | null
  onCellClick?: (row: number, col: number) => void
}

function px(col: number): number {
  return MARGIN + col * CELL
}
function py(row: number): number {
  return MARGIN + row * CELL
}

export function XiangqiBoard({ grid, selected, onCellClick }: Props): JSX.Element {
  const horizontals = Array.from({ length: BOARD_ROWS }, (_, r) => (
    <line
      key={`h${r}`}
      x1={px(0)}
      y1={py(r)}
      x2={px(BOARD_COLS - 1)}
      y2={py(r)}
      stroke="#5a3a1a"
      strokeWidth={1.5}
    />
  ))

  const verticals = Array.from({ length: BOARD_COLS }, (_, c) => {
    if (c === 0 || c === BOARD_COLS - 1) {
      return (
        <line
          key={`v${c}`}
          x1={px(c)}
          y1={py(0)}
          x2={px(c)}
          y2={py(BOARD_ROWS - 1)}
          stroke="#5a3a1a"
          strokeWidth={1.5}
        />
      )
    }
    // 河界：中間斷開
    return (
      <g key={`v${c}`}>
        <line x1={px(c)} y1={py(0)} x2={px(c)} y2={py(4)} stroke="#5a3a1a" strokeWidth={1.5} />
        <line x1={px(c)} y1={py(5)} x2={px(c)} y2={py(9)} stroke="#5a3a1a" strokeWidth={1.5} />
      </g>
    )
  })

  const palaces = [
    // 上方九宮 (黑)
    <line key="pt1" x1={px(3)} y1={py(0)} x2={px(5)} y2={py(2)} stroke="#5a3a1a" strokeWidth={1.5} />,
    <line key="pt2" x1={px(5)} y1={py(0)} x2={px(3)} y2={py(2)} stroke="#5a3a1a" strokeWidth={1.5} />,
    // 下方九宮 (紅)
    <line key="pb1" x1={px(3)} y1={py(7)} x2={px(5)} y2={py(9)} stroke="#5a3a1a" strokeWidth={1.5} />,
    <line key="pb2" x1={px(5)} y1={py(7)} x2={px(3)} y2={py(9)} stroke="#5a3a1a" strokeWidth={1.5} />
  ]

  const clickTargets: JSX.Element[] = []
  const pieces: JSX.Element[] = []
  for (let r = 0; r < BOARD_ROWS; r++) {
    for (let c = 0; c < BOARD_COLS; c++) {
      const isSelected = selected?.[0] === r && selected?.[1] === c
      clickTargets.push(
        <rect
          key={`t${r}-${c}`}
          x={px(c) - CELL / 2}
          y={py(r) - CELL / 2}
          width={CELL}
          height={CELL}
          fill="transparent"
          style={{ cursor: onCellClick ? 'pointer' : 'default' }}
          onClick={() => onCellClick?.(r, c)}
        />
      )
      if (isSelected) {
        pieces.push(
          <circle
            key={`sel${r}-${c}`}
            cx={px(c)}
            cy={py(r)}
            r={PIECE_R + 3}
            fill="none"
            stroke="#2e7d32"
            strokeWidth={3}
          />
        )
      }
      const piece = grid[r][c]
      if (piece) {
        const isRed = piece.color === 'red'
        pieces.push(
          <g key={`p${r}-${c}`} pointerEvents="none">
            <circle
              cx={px(c)}
              cy={py(r)}
              r={PIECE_R}
              fill="#f4e3c1"
              stroke={isRed ? '#c0392b' : '#1a1a1a'}
              strokeWidth={2}
            />
            <text
              x={px(c)}
              y={py(r) + 1}
              textAnchor="middle"
              dominantBaseline="central"
              fontSize={26}
              fontWeight={700}
              fill={isRed ? '#c0392b' : '#1a1a1a'}
            >
              {pieceGlyph(piece)}
            </text>
          </g>
        )
      }
    }
  }

  return (
    <svg
      width={WIDTH}
      height={HEIGHT}
      viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
      role="img"
      aria-label="象棋棋盤"
      style={{ background: '#e9c891', borderRadius: 8, border: '2px solid #5a3a1a' }}
    >
      {horizontals}
      {verticals}
      {palaces}
      <text
        x={WIDTH / 4}
        y={(py(4) + py(5)) / 2 + 8}
        textAnchor="middle"
        fontSize={22}
        fill="#5a3a1a"
        opacity={0.7}
      >
        楚河
      </text>
      <text
        x={(WIDTH / 4) * 3}
        y={(py(4) + py(5)) / 2 + 8}
        textAnchor="middle"
        fontSize={22}
        fill="#5a3a1a"
        opacity={0.7}
      >
        漢界
      </text>
      {pieces}
      {clickTargets}
    </svg>
  )
}
