/**
 * 錯題本頁 (MistakeBookPage)
 *
 * 顯示存於 localStorage 的錯題本條目。MVP 提供檢視與刪除。
 */

import { useEffect, useState } from 'react'
import type { MistakeBook } from '@shared/types/MistakeBookEntry'
import { MOVE_QUALITY_LABELS } from '@shared/types/MoveComparisonResult'
import { loadMistakeBook, saveMistakeBook } from '../storage/localSettings'

export function MistakeBookPage(): JSX.Element {
  const [book, setBook] = useState<MistakeBook>({ entries: [], version: 1 })

  useEffect(() => {
    setBook(loadMistakeBook())
  }, [])

  const remove = (id: string): void => {
    const next: MistakeBook = {
      ...book,
      entries: book.entries.filter((e) => e.id !== id)
    }
    saveMistakeBook(next)
    setBook(next)
  }

  return (
    <div className="mistake-page">
      <h2>錯題本</h2>
      {book.entries.length === 0 ? (
        <p className="muted">
          目前沒有錯題。於分析時將判定為錯著的局面加入錯題本後，會顯示在這裡。
        </p>
      ) : (
        <ul className="mistake-list">
          {book.entries.map((entry) => (
            <li key={entry.id} className="mistake-item">
              <div className="mistake-head">
                <span className={`quality-tag q-${entry.comparison.quality}`}>
                  {MOVE_QUALITY_LABELS[entry.comparison.quality]}
                </span>
                <code className="mono">{entry.fen}</code>
              </div>
              <div className="mistake-body">
                實際 <b>{entry.playedMoveUci}</b> → 最佳 <b>{entry.bestMoveUci}</b>
                　厘子損失 {entry.comparison.centipawnLoss}
              </div>
              {entry.note && <div className="muted">筆記：{entry.note}</div>}
              <button className="btn ghost small" onClick={() => remove(entry.id)}>
                刪除
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
