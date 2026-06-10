/**
 * 棋譜匯入面板 (GameImportPanel)
 *
 * 貼上 UCI 著法序列（空白或換行分隔，如 "h2e2 h9g7 b2e2"），
 * 從開局或目前局面匯入。每一手經 applyUciMove 完整驗證
 * （兵種走法、蹩馬腿、塞象眼、送將、王不見王），任一手不合法即整批拒絕並指出原因。
 * 匯入後可用導覽按鈕或點擊著法逐步檢視，棋盤即時同步，可對任一步執行引擎分析。
 */

import { useState } from 'react'
import { parseFen } from '@shared/logic/fen'
import { applyUciMove } from '@shared/logic/moves'
import { START_FEN, type BoardState } from '@shared/types/BoardState'

interface Props {
  board: BoardState
  onBoardChange: (board: BoardState) => void
}

interface ImportedGame {
  /** positions[0] 為起始局面，positions[i] 為走完第 i 手後的局面 */
  positions: BoardState[]
  moves: string[]
}

export function GameImportPanel({ board, onBoardChange }: Props): JSX.Element {
  const [movesText, setMovesText] = useState('')
  const [game, setGame] = useState<ImportedGame | null>(null)
  /** 目前檢視位置：0 = 起始局面，i = 第 i 手之後 */
  const [cursor, setCursor] = useState(0)
  const [error, setError] = useState<string | null>(null)

  const importMoves = (start: BoardState): void => {
    setError(null)
    const moves = movesText
      .trim()
      .toLowerCase()
      .split(/\s+/)
      .filter(Boolean)
    if (moves.length === 0) {
      setError('請先貼上著法序列，例如：h2e2 h9g7 b2e2')
      return
    }
    const positions: BoardState[] = [start]
    let current = start
    for (let i = 0; i < moves.length; i++) {
      const applied = applyUciMove(current, moves[i])
      if (!applied.valid) {
        setError(`第 ${i + 1} 手 ${moves[i]} 不合法：${applied.message}`)
        return
      }
      current = applied.board
      positions.push(current)
    }
    setGame({ positions, moves })
    setCursor(positions.length - 1)
    onBoardChange(positions[positions.length - 1])
  }

  const importFromStart = (): void => {
    const parsed = parseFen(START_FEN)
    if (parsed.valid) importMoves(parsed.board)
  }

  const goto = (index: number): void => {
    if (!game) return
    const clamped = Math.max(0, Math.min(game.positions.length - 1, index))
    setCursor(clamped)
    onBoardChange(game.positions[clamped])
  }

  const clear = (): void => {
    setGame(null)
    setCursor(0)
    setError(null)
  }

  return (
    <div className="import-panel">
      <label className="field-label">棋譜匯入（UCI 著法，空白分隔）</label>
      <textarea
        className="fen-textarea"
        value={movesText}
        spellCheck={false}
        rows={2}
        onChange={(e) => setMovesText(e.target.value)}
        placeholder="例如：h2e2 h9g7 b2e2 b9c7"
      />
      <div className="row gap">
        <button className="btn" onClick={importFromStart}>
          從開局匯入
        </button>
        <button className="btn ghost" onClick={() => importMoves(board)}>
          從目前局面匯入
        </button>
        {game && (
          <button className="btn ghost" onClick={clear}>
            清除
          </button>
        )}
      </div>
      {error && <div className="error-text">⚠ {error}</div>}
      {game && (
        <div className="game-nav">
          <div className="row gap">
            <button className="btn ghost small" onClick={() => goto(0)} disabled={cursor === 0}>
              ⏮ 開頭
            </button>
            <button
              className="btn ghost small"
              onClick={() => goto(cursor - 1)}
              disabled={cursor === 0}
            >
              ◀ 上一手
            </button>
            <span className="muted small">
              {cursor === 0 ? '起始局面' : `第 ${cursor}/${game.moves.length} 手`}
            </span>
            <button
              className="btn ghost small"
              onClick={() => goto(cursor + 1)}
              disabled={cursor === game.moves.length}
            >
              下一手 ▶
            </button>
            <button
              className="btn ghost small"
              onClick={() => goto(game.moves.length)}
              disabled={cursor === game.moves.length}
            >
              結尾 ⏭
            </button>
          </div>
          <div className="move-chips">
            {game.moves.map((m, i) => (
              <button
                key={`${i}-${m}`}
                className={`move-chip ${cursor === i + 1 ? 'current' : ''}`}
                title={`跳到第 ${i + 1} 手之後`}
                onClick={() => goto(i + 1)}
              >
                {i + 1}.{m}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
