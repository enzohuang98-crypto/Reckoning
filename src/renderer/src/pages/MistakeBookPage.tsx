/**
 * 錯題本頁 (MistakeBookPage) — SDS v0.2 §2.5
 *
 * 顯示存於 localStorage 的錯題本條目（v0.2 形狀）。
 * 提供檢視、標記已理解、刪除。
 */

import { useEffect, useState } from 'react'
import type { MistakeBook } from '@shared/types/MistakeBookEntry'
import { MISTAKE_LEVEL_LABELS } from '@shared/types/MoveComparisonResult'
import {
  loadMistakeBook,
  saveMistakeBook,
  updateMistakeEntry
} from '../storage/localSettings'

const CONFIDENCE_LABEL = { low: '低', medium: '中', high: '高' } as const

export function MistakeBookPage(): JSX.Element {
  const [book, setBook] = useState<MistakeBook>({ entries: [], version: 2 })

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

  const toggleUnderstood = (id: string, understood: boolean): void => {
    setBook(updateMistakeEntry(id, { understood }))
  }

  return (
    <div className="mistake-page">
      <h2>錯題本</h2>
      {book.entries.length === 0 ? (
        <p className="muted">
          目前沒有錯題。在猜著模式中將判定為錯著的局面加入錯題本後，會顯示在這裡。
        </p>
      ) : (
        <ul className="mistake-list">
          {book.entries.map((entry) => (
            <li key={entry.id} className="mistake-item">
              <div className="mistake-head">
                <span className={`quality-tag q-${entry.mistakeLevel}`}>
                  {MISTAKE_LEVEL_LABELS[entry.mistakeLevel]}
                </span>
                {entry.understood && <span className="badge on">已理解</span>}
                <code className="mono">{entry.positionFen}</code>
              </div>
              <div className="mistake-body">
                你走 <b>{entry.userMove}</b> → 最佳 <b>{entry.engineBestMove}</b>
                　評估差距{' '}
                {entry.scoreDifference === null
                  ? '無法計算'
                  : entry.scoreDifference.toFixed(2)}
                　可信度 {CONFIDENCE_LABEL[entry.confidence]}
              </div>
              {entry.userNote && <div className="muted">理由／筆記：{entry.userNote}</div>}
              {entry.explanation && (
                <details className="muted small">
                  <summary>AI 解說</summary>
                  <p className="explanation-text">{entry.explanation}</p>
                </details>
              )}
              <div className="row gap" style={{ marginTop: 6 }}>
                <button
                  className="btn ghost small"
                  onClick={() => toggleUnderstood(entry.id, !entry.understood)}
                >
                  {entry.understood ? '標記為未理解' : '標記為已理解'}
                </button>
                <button className="btn ghost small" onClick={() => remove(entry.id)}>
                  刪除
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
