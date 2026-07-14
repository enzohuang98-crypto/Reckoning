import { useMemo, useState } from 'react'
import type { MistakeBookEntry } from '@shared/types/MistakeBookEntry'
import { MISTAKE_LEVEL_LABELS } from '@shared/types/MoveComparisonResult'
import { parseFen } from '@shared/logic/board/fen'
import { formatChineseMove } from '@shared/logic/board/ChineseNotation'
import { ExplanationView } from '../features/explanations/ExplanationView'

interface Props {
  entries: MistakeBookEntry[]
  onChange: (entries: MistakeBookEntry[]) => void
  onOpenPosition: (fen: string) => void
}

function localizedMove(fen: string, move: string, stored?: string): string {
  if (stored) return stored
  const parsed = parseFen(fen)
  return parsed.valid
    ? formatChineseMove(parsed.board, move) ?? '無法辨識著法'
    : '無法辨識著法'
}

export function MistakeBookPage({
  entries,
  onChange,
  onOpenPosition
}: Props): JSX.Element {
  const [search, setSearch] = useState('')
  const [tagDrafts, setTagDrafts] = useState<Record<string, string>>({})

  const filtered = useMemo(() => {
    const keyword = search.trim().toLowerCase()
    if (!keyword) return entries
    return entries.filter((entry) =>
      [
        entry.positionFen,
        entry.userMove,
        entry.engineBestMove,
        entry.userNote ?? '',
        entry.explanation,
        entry.tags.join(' ')
      ]
        .join(' ')
        .toLowerCase()
        .includes(keyword)
    )
  }, [entries, search])

  const update = (id: string, patch: Partial<MistakeBookEntry>): void => {
    onChange(
      entries.map((entry) =>
        entry.id === id
          ? { ...entry, ...patch, updatedAt: new Date().toISOString() }
          : entry
      )
    )
  }

  const addTag = (entry: MistakeBookEntry): void => {
    const tag = (tagDrafts[entry.id] ?? '').trim()
    if (!tag || entry.tags.includes(tag)) return
    update(entry.id, { tags: [...entry.tags, tag] })
    setTagDrafts((current) => ({ ...current, [entry.id]: '' }))
  }

  const removeTag = (entry: MistakeBookEntry, tag: string): void => {
    if (!window.confirm(`確定要移除標籤「${tag}」嗎？`)) return
    update(entry.id, { tags: entry.tags.filter((item) => item !== tag) })
  }

  const deleteEntry = (entry: MistakeBookEntry): void => {
    if (!window.confirm('確定要永久刪除這筆錯題嗎？此動作無法復原。')) return
    onChange(entries.filter((item) => item.id !== entry.id))
  }

  return (
    <div className="mistake-page">
      <div className="page-heading">
        <div>
          <span className="eyebrow">REVIEW & IMPROVE</span>
          <h1>錯題本</h1>
          <p>把每一次判斷偏差整理成可搜尋、可追蹤的複盤資料。</p>
        </div>
        <div className="page-count">{entries.length} 筆紀錄</div>
      </div>
      <div className="list-toolbar">
        <input
          className="text-input"
          value={search}
          placeholder="搜尋 FEN、著法、筆記、解說或標籤"
          onChange={(event) => setSearch(event.target.value)}
        />
      </div>
      {entries.length === 0 ? (
        <p className="muted">目前沒有錯題。</p>
      ) : filtered.length === 0 ? (
        <p className="muted">找不到符合條件的錯題。</p>
      ) : (
        <ul className="mistake-list">
          {filtered.map((entry) => (
            <li key={entry.id} className="mistake-item">
              <div className="mistake-head">
                <span className={`quality-tag q-${entry.mistakeLevel}`}>
                  {MISTAKE_LEVEL_LABELS[entry.mistakeLevel]}
                </span>
                {entry.understood && <span className="badge on">已理解</span>}
                <code className="mono">{entry.positionFen}</code>
              </div>
              <div className="mistake-body">
                你走 <b>{localizedMove(entry.positionFen, entry.userMove)}</b> → 最佳{' '}
                <b>
                  {localizedMove(
                    entry.positionFen,
                    entry.engineBestMove,
                    entry.engineAnalysis.displayBestMove
                  )}
                </b>
              </div>
              <label className="field">
                <span className="field-label">筆記</span>
                <textarea
                  className="fen-textarea"
                  rows={2}
                  defaultValue={entry.userNote ?? ''}
                  onBlur={(event) => update(entry.id, { userNote: event.target.value.trim() || undefined })}
                />
              </label>
              <div className="tag-editor">
                {entry.tags.map((tag) => (
                  <button
                    key={tag}
                    className="badge on"
                    title="點擊移除標籤"
                    onClick={() => removeTag(entry, tag)}
                  >
                    {tag} ×
                  </button>
                ))}
                <input
                  className="text-input"
                  value={tagDrafts[entry.id] ?? ''}
                  placeholder="新增標籤"
                  onChange={(event) =>
                    setTagDrafts((current) => ({ ...current, [entry.id]: event.target.value }))
                  }
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') addTag(entry)
                  }}
                />
                <button className="btn ghost small" onClick={() => addTag(entry)}>
                  加入
                </button>
              </div>
              <details className="mistake-details">
                <summary>單筆詳情與原始分析</summary>
                {entry.explanation && <ExplanationView text={entry.explanation} />}
                <div className="muted small">
                  深度 {entry.engineAnalysis.depth ?? '—'}；候選著法：{' '}
                  {entry.engineAnalysis.candidateMoves
                    .map((candidate) =>
                      localizedMove(
                        entry.positionFen,
                        candidate.move,
                        candidate.displayMove
                      )
                    )
                    .join('、') || '無'}
                </div>
              </details>
              <div className="row gap mistake-item-actions">
                <button className="btn ghost small" onClick={() => onOpenPosition(entry.positionFen)}>
                  回到原局面
                </button>
                <button
                  className="btn ghost small"
                  onClick={() => update(entry.id, { understood: !entry.understood })}
                >
                  {entry.understood ? '標記為未理解' : '標記為已理解'}
                </button>
                <button
                  className="btn danger small"
                  onClick={() => deleteEntry(entry)}
                >
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
