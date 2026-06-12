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
      stroke="var(--board-line)"
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
          stroke="var(--board-line)"
          strokeWidth={1.5}
        />
      )
    }
    // 河界：中間斷開
    return (
      <g key={`v${c}`}>
        <line x1={px(c)} y1={py(0)} x2={px(c)} y2={py(4)} stroke="var(--board-line)" strokeWidth={1.5} />
        <line x1={px(c)} y1={py(5)} x2={px(c)} y2={py(9)} stroke="var(--board-line)" strokeWidth={1.5} />
      </g>
    )
  })

  const palaces = [
    // 上方九宮 (黑)
    <line key="pt1" x1={px(3)} y1={py(0)} x2={px(5)} y2={py(2)} stroke="var(--board-line)" strokeWidth={1.5} />,
    <line key="pt2" x1={px(5)} y1={py(0)} x2={px(3)} y2={py(2)} stroke="var(--board-line)" strokeWidth={1.5} />,
    // 下方九宮 (紅)
    <line key="pb1" x1={px(3)} y1={py(7)} x2={px(5)} y2={py(9)} stroke="var(--board-line)" strokeWidth={1.5} />,
    <line key="pb2" x1={px(5)} y1={py(7)} x2={px(3)} y2={py(9)} stroke="var(--board-line)" strokeWidth={1.5} />
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
            stroke="var(--jade)"
            strokeWidth={3}
            className="piece-selection"
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
              fill="url(#piece-surface)"
              stroke={isRed ? 'var(--cinnabar)' : 'var(--ink-piece)'}
              strokeWidth={2.25}
              filter="url(#piece-shadow)"
            />
            <circle
              cx={px(c)}
              cy={py(r)}
              r={PIECE_R - 4}
              fill="none"
              stroke={isRed ? 'var(--cinnabar)' : 'var(--ink-piece)'}
              strokeWidth={0.8}
              opacity={0.42}
            />
            <text
              x={px(c)}
              y={py(r) + 1}
              textAnchor="middle"
              dominantBaseline="central"
              fontSize={26}
              fontWeight={700}
              fill={isRed ? 'var(--cinnabar)' : 'var(--ink-piece)'}
              className="piece-glyph"
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
      className="xiangqi-board"
    >
      <defs>
        <linearGradient id="board-surface" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#e7c897" />
          <stop offset="52%" stopColor="#d5ad73" />
          <stop offset="100%" stopColor="#c69559" />
        </linearGradient>
        <radialGradient id="piece-surface" cx="35%" cy="28%" r="75%">
          <stop offset="0%" stopColor="#fffdf3" />
          <stop offset="68%" stopColor="#eee3c8" />
          <stop offset="100%" stopColor="#d1be96" />
        </radialGradient>
        <pattern id="wood-grain" width="72" height="72" patternUnits="userSpaceOnUse">
          <path
            d="M-8 18 C18 5 42 31 80 13 M-12 48 C20 33 43 60 84 41"
            fill="none"
            stroke="#6f4520"
            strokeWidth="1"
            opacity="0.08"
          />
        </pattern>
        <filter id="piece-shadow" x="-30%" y="-30%" width="160%" height="170%">
          <feDropShadow dx="0" dy="3" stdDeviation="2.5" floodColor="#3b210e" floodOpacity="0.38" />
        </filter>
      </defs>
      <rect x="1" y="1" width={WIDTH - 2} height={HEIGHT - 2} rx="14" fill="url(#board-surface)" />
      <rect x="1" y="1" width={WIDTH - 2} height={HEIGHT - 2} rx="14" fill="url(#wood-grain)" />
      <rect
        x="8"
        y="8"
        width={WIDTH - 16}
        height={HEIGHT - 16}
        rx="10"
        fill="none"
        stroke="var(--board-line)"
        strokeWidth="2"
        opacity="0.75"
      />
      {horizontals}
      {verticals}
      {palaces}
      <text
        x={WIDTH / 4}
        y={(py(4) + py(5)) / 2 + 8}
        textAnchor="middle"
        fontSize={22}
        fill="var(--board-line)"
        opacity={0.76}
        className="river-label"
      >
        楚河
      </text>
      <text
        x={(WIDTH / 4) * 3}
        y={(py(4) + py(5)) / 2 + 8}
        textAnchor="middle"
        fontSize={22}
        fill="var(--board-line)"
        opacity={0.76}
        className="river-label"
      >
        漢界
      </text>
      {pieces}
      {clickTargets}
    </svg>
  )
}
