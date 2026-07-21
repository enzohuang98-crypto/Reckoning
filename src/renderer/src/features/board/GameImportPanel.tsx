/**
 * 棋譜匯入面板 (GameImportPanel)
 *
 * 貼上 PlayOK WXF 棋譜或 UCI 著法序列，從開局或目前局面匯入。
 * 每一手經 applyUciMove 完整驗證
 * （兵種走法、蹩馬腿、塞象眼、送將、王不見王），任一手不合法即整批拒絕並指出原因。
 * 匯入後可用導覽按鈕或點擊著法逐步檢視，棋盤即時同步，可對任一步執行引擎分析。
 */

import { useState } from 'react'
import { parseFen } from '@shared/logic/board/fen'
import { parseGameRecord } from '@shared/logic/board/PlayOkWxf'
import { START_FEN, type BoardState } from '@shared/types/BoardState'

interface Props {
  board: BoardState
  onBoardChange: (board: BoardState) => void
  onMoveSelect: (selection: ImportedMoveSelection) => void
}

export interface ImportedMoveSelection {
  /** 被點擊著法走之前的局面。 */
  position: BoardState
  move: string
  displayMove: string
  plyIndex: number
}

interface ImportedGame {
  /** positions[0] 為起始局面，positions[i] 為走完第 i 手後的局面 */
  positions: BoardState[]
  moves: string[]
  displayMoves: string[]
}

export function GameImportPanel({
  board,
  onBoardChange,
  onMoveSelect
}: Props): JSX.Element {
  const [movesText, setMovesText] = useState('')
  const [game, setGame] = useState<ImportedGame | null>(null)
  /** 目前檢視位置：0 = 起始局面，i = 第 i 手之後 */
  const [cursor, setCursor] = useState(0)
  const [selectedPly, setSelectedPly] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)

  const importMoves = (start: BoardState): void => {
    setError(null)
    const parsed = parseGameRecord(movesText, start)
    if (!parsed.valid) {
      setError(parsed.message)
      return
    }
    setGame(parsed)
    setCursor(parsed.positions.length - 1)
    setSelectedPly(null)
    onBoardChange(parsed.positions[parsed.positions.length - 1])
  }

  const importFromStart = (): void => {
    const parsed = parseFen(START_FEN)
    if (parsed.valid) importMoves(parsed.board)
  }

  const goto = (index: number): void => {
    if (!game) return
    const clamped = Math.max(0, Math.min(game.positions.length - 1, index))
    setCursor(clamped)
    setSelectedPly(null)
    onBoardChange(game.positions[clamped])
  }

  const selectMove = (index: number): void => {
    if (!game) return
    setCursor(index)
    setSelectedPly(index)
    onMoveSelect({
      position: game.positions[index],
      move: game.moves[index],
      displayMove: game.displayMoves[index],
      plyIndex: index
    })
  }

  const clear = (): void => {
    setGame(null)
    setCursor(0)
    setSelectedPly(null)
    setError(null)
    // 清除棋譜時也清除上一次實戰步選取，避免舊分析繼續顯示。
    onBoardChange(board)
  }

  return (
    <div className="import-panel">
      <label className="field-label">棋譜匯入（PlayOK WXF 或 UCI）</label>
      <textarea
        className="fen-textarea"
        value={movesText}
        spellCheck={false}
        rows={5}
        onChange={(e) => setMovesText(e.target.value)}
        placeholder={'貼上 FORMAT WXF … START{…}END，或 h2e2 h9g7 b2e2'}
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
              {selectedPly !== null
                ? `第 ${selectedPly + 1}/${game.moves.length} 手走前`
                : cursor === 0
                  ? '起始局面'
                  : `第 ${cursor}/${game.moves.length} 手走後`}
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
                className={`move-chip ${selectedPly === i ? 'current' : ''}`}
                title={`分析第 ${i + 1} 手（顯示走前局面）`}
                onClick={() => selectMove(i)}
              >
                {i + 1}.{game.displayMoves[i]}
              </button>
            ))}
          </div>
          {selectedPly !== null && (
            <div className="notice-text small" role="status">
              已選第 {selectedPly + 1} 手 {game.displayMoves[selectedPly]}，正在比較實戰步與 AI 首選。
            </div>
          )}
        </div>
      )}
    </div>
  )
}
