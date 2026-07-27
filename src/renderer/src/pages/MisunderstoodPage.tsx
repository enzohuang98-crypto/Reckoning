import { useMemo, useState } from 'react'
import type {
  AIConversation,
  MisunderstoodPosition
} from '@shared/types/AppData'
import type { MistakeBookEntry } from '@shared/types/MistakeBookEntry'
import { ExplanationView } from '../features/explanations/ExplanationView'

interface Props {
  entries: MisunderstoodPosition[]
  conversations: AIConversation[]
  onChange: (entries: MisunderstoodPosition[]) => void
  onOpenPosition: (entry: MisunderstoodPosition) => void
  onMoveToMistakeBook: (entry: MistakeBookEntry) => void
}

export function MisunderstoodPage({
  entries,
  conversations,
  onChange,
  onOpenPosition,
  onMoveToMistakeBook
}: Props): JSX.Element {
  const [search, setSearch] = useState('')

  const filtered = useMemo(() => {
    const keyword = search.trim().toLowerCase()
    if (!keyword) return entries
    return entries.filter((entry) =>
      [entry.positionFen, entry.reason, entry.explanation ?? '']
        .join(' ')
        .toLowerCase()
        .includes(keyword)
    )
  }, [entries, search])

  const update = (id: string, patch: Partial<MisunderstoodPosition>): void => {
    onChange(
      entries.map((entry) =>
        entry.id === id
          ? { ...entry, ...patch, updatedAt: new Date().toISOString() }
          : entry
      )
    )
  }

  const moveToMistakeBook = (entry: MisunderstoodPosition): void => {
    const comparison = entry.moveComparison
    if (!entry.engineAnalysis || !comparison?.userMove) return
    const now = new Date().toISOString()
    onMoveToMistakeBook({
      id: crypto.randomUUID(),
      createdAt: now,
      updatedAt: now,
      positionFen: comparison.positionFen,
      sideToMove: comparison.sideToMove,
      userMove: comparison.userMove,
      engineBestMove: comparison.engineBestMove,
      evaluationAfterUserMove: comparison.evaluationAfterUserMove,
      evaluationAfterBestMove: comparison.evaluationAfterBestMove,
      scoreDifference: comparison.scoreDifference,
      mistakeLevel: comparison.mistakeLevel,
      confidence: comparison.confidence,
      uncertaintyReasons: comparison.uncertaintyReasons,
      explanation: entry.explanation ?? '',
      engineAnalysis: entry.engineAnalysis,
      userNote: entry.reason,
      tags: ['待理解'],
      understood: false
    })
    onChange(entries.filter((item) => item.id !== entry.id))
  }

  const deleteEntry = (entry: MisunderstoodPosition): void => {
    if (!window.confirm('確定要永久刪除這個待理解局面嗎？此動作無法復原。')) return
    onChange(entries.filter((item) => item.id !== entry.id))
  }

  return (
    <div className="mistake-page">
      <div className="page-heading">
        <div>
          <span className="eyebrow">DEEP STUDY</span>
          <h1>待理解局面</h1>
          <p>收藏尚未想通的關鍵局面，之後回到分析工作台繼續追問。</p>
        </div>
        <div className="page-count">
          {search.trim() ? `${filtered.length} / ${entries.length} 個局面` : `${entries.length} 個局面`}
        </div>
      </div>
      {entries.length > 0 && (
        <div className="list-toolbar">
          <div className="list-toolbar-row">
            <input
              className="text-input list-toolbar-search"
              value={search}
              placeholder="搜尋 FEN、看不懂的原因或已生成的解說"
              aria-label="搜尋待理解局面"
              onChange={(event) => setSearch(event.target.value)}
            />
            {search.trim() && (
              <button type="button" className="btn ghost" onClick={() => setSearch('')}>
                清除搜尋
              </button>
            )}
          </div>
        </div>
      )}
      {entries.length === 0 ? (
        <div className="empty-state">
          <span className="empty-state-mark">?</span>
          <h3>目前沒有待理解局面</h3>
          <p className="muted">分析完成後，可將需要深入研究的局面收藏到這裡。</p>
        </div>
      ) : filtered.length === 0 ? (
        <p className="muted">找不到符合條件的待理解局面。</p>
      ) : (
        <ul className="mistake-list">
          {filtered.map((entry) => {
            const conversation = conversations.find(
              (item) => item.id === entry.conversationId
            )
            const canMove = Boolean(entry.engineAnalysis && entry.moveComparison?.userMove)
            return (
              <li key={entry.id} className="mistake-item">
                <code className="mono">{entry.positionFen}</code>
                <label className="field">
                  <span className="field-label">看不懂的原因</span>
                  <textarea
                    className="fen-textarea"
                    rows={2}
                    defaultValue={entry.reason}
                    onBlur={(event) => update(entry.id, { reason: event.target.value.trim() })}
                  />
                </label>
                {entry.explanation && (
                  <details>
                    <summary>已生成解說</summary>
                    <ExplanationView text={entry.explanation} />
                  </details>
                )}
                {conversation && (
                  <details>
                    <summary>追問紀錄（{conversation.messages.length} 則）</summary>
                    {conversation.messages.map((message) =>
                      message.role === 'assistant' ? (
                        <ExplanationView key={message.id} text={message.text} />
                      ) : (
                        <p key={message.id} className="explanation-text">
                          <b>問：</b>
                          {message.text}
                        </p>
                      )
                    )}
                  </details>
                )}
                <div className="row gap mistake-item-actions">
                  <button className="btn small" onClick={() => onOpenPosition(entry)}>
                    回到分析並追問
                  </button>
                  <button
                    className="btn ghost small"
                    disabled={!canMove}
                    title={canMove ? undefined : '需先以猜著模式產生比較資料'}
                    onClick={() => moveToMistakeBook(entry)}
                  >
                    移入錯題本
                  </button>
                  <button
                    className="btn danger small"
                    onClick={() => deleteEntry(entry)}
                  >
                    刪除
                  </button>
                </div>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
