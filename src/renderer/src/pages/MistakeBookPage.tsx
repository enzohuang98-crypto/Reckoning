import { useMemo, useState } from 'react'
import type { MistakeBookEntry } from '@shared/types/MistakeBookEntry'
import { MISTAKE_LEVEL_LABELS, type MistakeLevel } from '@shared/types/MoveComparisonResult'
import { parseFen } from '@shared/logic/board/fen'
import { formatChineseMove } from '@shared/logic/board/ChineseNotation'
import { ExplanationView } from '../features/explanations/ExplanationView'

type LevelFilter = 'all' | MistakeLevel
type UnderstoodFilter = 'all' | 'understood' | 'not_understood'

const LEVEL_FILTER_OPTIONS: LevelFilter[] = [
  'all',
  'major_blunder',
  'serious_mistake',
  'mistake',
  'inaccuracy',
  'acceptable_or_tiny_inaccuracy',
  'unknown'
]

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
  const [levelFilter, setLevelFilter] = useState<LevelFilter>('all')
  const [understoodFilter, setUnderstoodFilter] = useState<UnderstoodFilter>('all')
  const [tagDrafts, setTagDrafts] = useState<Record<string, string>>({})

  const filtered = useMemo(() => {
    const keyword = search.trim().toLowerCase()
    return entries.filter((entry) => {
      if (levelFilter !== 'all' && entry.mistakeLevel !== levelFilter) return false
      if (understoodFilter === 'understood' && !entry.understood) return false
      if (understoodFilter === 'not_understood' && entry.understood) return false
      if (!keyword) return true
      return [
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
    })
  }, [entries, search, levelFilter, understoodFilter])

  const filtersActive =
    search.trim() !== '' || levelFilter !== 'all' || understoodFilter !== 'all'

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
        <div className="page-count">
          {filtersActive ? `${filtered.length} / ${entries.length} 筆` : `${entries.length} 筆紀錄`}
        </div>
      </div>
      <div className="list-toolbar">
        <div className="list-toolbar-row">
          <input
            className="text-input list-toolbar-search"
            value={search}
            placeholder="搜尋 FEN、著法、筆記、解說或標籤"
            aria-label="搜尋錯題本"
            onChange={(event) => setSearch(event.target.value)}
          />
          <select
            className="select list-toolbar-select"
            value={levelFilter}
            aria-label="依錯誤等級篩選"
            onChange={(event) => setLevelFilter(event.target.value as LevelFilter)}
          >
            {LEVEL_FILTER_OPTIONS.map((level) => (
              <option key={level} value={level}>
                {level === 'all' ? '全部等級' : MISTAKE_LEVEL_LABELS[level]}
              </option>
            ))}
          </select>
          <select
            className="select list-toolbar-select"
            value={understoodFilter}
            aria-label="依是否已理解篩選"
            onChange={(event) => setUnderstoodFilter(event.target.value as UnderstoodFilter)}
          >
            <option value="all">全部狀態</option>
            <option value="understood">已理解</option>
            <option value="not_understood">未理解</option>
          </select>
          {filtersActive && (
            <button
              type="button"
              className="btn ghost"
              onClick={() => {
                setSearch('')
                setLevelFilter('all')
                setUnderstoodFilter('all')
              }}
            >
              清除篩選
            </button>
          )}
        </div>
      </div>
      {entries.length === 0 ? (
        <p className="muted">目前沒有錯題。</p>
      ) : filtered.length === 0 ? (
        <p className="muted">找不到符合篩選條件的錯題。</p>
      ) : (
        <ul className="mistake-list">
          {filtered.map((entry) => (
            <li key={entry.id} className="mistake-item">
              <div className="mistake-head">
                <span className={`quality-tag q-${entry.mistakeLevel}`}>
                  {MISTAKE_LEVEL_LABELS[entry.mistakeLevel]}
                </span>
                {entry.understood && <span className="badge on">已理解</span>}
              </div>
              {/* 這張卡片講的就是「你走了什麼、該走什麼」，所以它是標題行。 */}
              <p className="mistake-headline">
                <span className="mistake-move played">
                  <small>你走</small>
                  {localizedMove(entry.positionFen, entry.userMove)}
                </span>
                <span className="mistake-arrow" aria-hidden="true">→</span>
                <span className="mistake-move best">
                  <small>最佳</small>
                  {localizedMove(
                    entry.positionFen,
                    entry.engineBestMove,
                    entry.engineAnalysis.displayBestMove
                  )}
                </span>
              </p>
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
                <code className="mono mistake-fen">{entry.positionFen}</code>
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
