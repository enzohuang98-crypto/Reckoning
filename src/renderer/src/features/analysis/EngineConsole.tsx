import type {
  EngineAnalysisProgressPayload,
  EngineStatus
} from '@shared/types/ipc'

export interface EngineThoughtEntry {
  id: string
  phase: EngineAnalysisProgressPayload['phase']
  elapsedMs: number
  depth: number | null
  selDepth?: number | null
  nodes?: number | null
  nps?: number | null
  scoreRaw: string | null
  displayMove?: string
  displayPrincipalVariation: string[]
  engineRole?: 'primary' | 'verification'
  engineName?: string
}

function formatLargeNumber(value?: number | null): string | null {
  if (value === undefined || value === null) return null
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}K`
  return String(value)
}

export function formatElapsedMs(value: number): string {
  return `${(value / 1000).toFixed(1)}s`
}

export function thoughtSignature(entry: EngineThoughtEntry): string {
  return [
    entry.phase,
    entry.depth ?? 'none',
    entry.selDepth ?? 'none',
    entry.scoreRaw ?? 'none',
    entry.displayMove ?? 'none',
    entry.engineRole ?? 'primary',
    entry.engineName ?? 'unknown',
    entry.displayPrincipalVariation.join('|')
  ].join('::')
}

function phaseText(phase: EngineAnalysisProgressPayload['phase']): string {
  switch (phase) {
    case 'preparing_engine':
      return '正在啟動象棋引擎'
    case 'root_analysis':
      return '正在分析目前局面'
    case 'user_move_analysis':
      return '正在驗證你的著法'
    case 'finalizing':
      return '正在整理分析結果'
  }
}

function EngineThoughtRow({
  item,
  latest
}: {
  item: EngineThoughtEntry
  latest?: boolean
}): JSX.Element {
  return (
    <div className={`engine-console-row${latest ? ' latest' : ''}`}>
      <div className="engine-console-meta">
        <b>
          {item.engineRole === 'verification' ? '複核' : '主引擎'} ·{' '}
          {item.phase === 'user_move_analysis' ? '你的著法後' : '局面分析'}
        </b>
        {item.engineName && <span>{item.engineName}</span>}
        <span>深度 {item.depth ?? '—'}</span>
        <span>分數 {item.scoreRaw ?? '等待分數'}</span>
        <span>耗時 {formatElapsedMs(item.elapsedMs)}</span>
        <span>NPS {formatLargeNumber(item.nps) ?? '—'}</span>
        {item.nodes !== undefined && item.nodes !== null && (
          <span>節點 {formatLargeNumber(item.nodes)}</span>
        )}
      </div>
      <div className="engine-console-pv">
        {item.displayPrincipalVariation.length > 0
          ? item.displayPrincipalVariation.slice(0, 18).join('　')
          : item.displayMove ?? '引擎尚未輸出主線'}
      </div>
    </div>
  )
}

interface Props {
  status: EngineStatus | null
  progress: EngineAnalysisProgressPayload | null
  busy: boolean
  completedDepth: number | null
  thoughts: EngineThoughtEntry[]
  liveElapsedMs: number | null
  sinceLastThoughtMs: number | null
}

export function EngineConsole({
  status,
  progress,
  busy,
  completedDepth,
  thoughts,
  liveElapsedMs,
  sinceLastThoughtMs
}: Props): JSX.Element {
  const reversed = thoughts.slice().reverse()
  const [latestThought, ...historyThoughts] = reversed
  const activeEngineLabel = progress
    ? `${progress.engineRole === 'verification' ? '複核引擎' : '主引擎'}${
        progress.engineName ? ` ${progress.engineName}` : ''
      }`
    : null

  return (
    <section className="engine-console" aria-live="polite">
      <div className="engine-console-header">
        <div>
          <span className="eyebrow">LIVE ENGINE</span>
          <h3>{status?.engineName ?? '象棋引擎'}即時思考</h3>
        </div>
        <span className={`badge ${busy ? 'on' : completedDepth ? 'plain' : 'off'}`}>
          {busy ? '持續更新' : completedDepth ? `深度 ${completedDepth}` : '等待分析'}
        </span>
      </div>

      <div className="engine-console-status">
        <span>
          {busy && progress
            ? `${activeEngineLabel} · ${phaseText(progress.phase)} · ${progress.percent}%`
            : completedDepth
              ? `分析完成 · 深度 ${completedDepth}`
              : '尚未開始分析'}
        </span>
        {busy && liveElapsedMs !== null && (
          <span>
            已進行 {formatElapsedMs(liveElapsedMs)}
            {sinceLastThoughtMs !== null && sinceLastThoughtMs >= 3000
              ? ` · 引擎思考中，${formatElapsedMs(sinceLastThoughtMs)}未回報新資料`
              : ''}
          </span>
        )}
      </div>

      <div className="engine-console-feed">
        {!latestThought ? (
          <div className="engine-console-empty">
            {busy
              ? '引擎已啟動，正在等待第一筆深度資料。'
              : '棋盤變更後會自動分析；深度、原始分數、NPS 與主線會持續出現在這裡。'}
          </div>
        ) : (
          <>
            <EngineThoughtRow item={latestThought} latest />
            {historyThoughts.length > 0 && (
              <div className="engine-console-history">
                {historyThoughts.map((item) => (
                  <EngineThoughtRow item={item} key={item.id} />
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </section>
  )
}
