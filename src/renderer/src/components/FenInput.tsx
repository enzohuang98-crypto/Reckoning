/**
 * FEN 輸入 (FenInput)
 *
 * 貼上/輸入 FEN 字串，驗證後回呼 BoardState 給上層渲染棋盤。
 */

import { useEffect, useState } from 'react'
import { validateFenInput } from '@shared/logic/ValidationUtils'
import { START_FEN, type BoardState } from '@shared/types/BoardState'

interface Props {
  initialFen?: string
  onValidBoard: (board: BoardState) => void
}

export function FenInput({ initialFen = START_FEN, onValidBoard }: Props): JSX.Element {
  const [value, setValue] = useState(initialFen)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setValue(initialFen)
    setError(null)
  }, [initialFen])

  const apply = (): void => {
    const result = validateFenInput(value)
    if (result.valid) {
      setError(null)
      onValidBoard(result.board)
    } else {
      setError(result.message)
    }
  }

  return (
    <div className="fen-input">
      <label className="field-label">FEN 字串</label>
      <textarea
        className="fen-textarea"
        value={value}
        spellCheck={false}
        rows={2}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          // Enter 直接套用 FEN（FEN 為單行，不需要換行）；輸入法選字中的 Enter 不觸發
          if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
            e.preventDefault()
            apply()
          }
        }}
        placeholder="貼上或輸入 FEN，例如：rnbakabnr/9/1c5c1/..."
      />
      <div className="row gap">
        <button className="btn" onClick={apply}>
          套用 FEN
        </button>
        <button
          className="btn ghost"
          onClick={() => {
            setValue(START_FEN)
            setError(null)
            const result = validateFenInput(START_FEN)
            if (result.valid) onValidBoard(result.board)
          }}
        >
          重設為開局
        </button>
      </div>
      {error && <div className="error-text">⚠ {error}</div>}
    </div>
  )
}
