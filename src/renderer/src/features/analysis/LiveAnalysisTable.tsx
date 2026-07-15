import type {
  EngineAnalysisResultPayload,
  EngineStatus
} from '@shared/types/ipc'

export const MAX_ENGINE_THOUGHTS = 80

export interface EngineThoughtEntry {
  id: string
  phase: 'preparing_engine' | 'root_analysis' | 'user_move_analysis' | 'finalizing'
  elapsedMs: number
  depth: number | null
  selDepth?: number | null
  displayScore: string | null
  displayMove?: string
  displayPrincipalVariation: string[]
  engineRole?: 'primary' | 'verification'
  engineName?: string
}

export function formatElapsedMs(value?: number | null): string {
  if (value === undefined || value === null || !Number.isFinite(value) || value < 0) {
    return '—'
  }
  return (value / 1000).toFixed(1) + ' 秒'
}

export function thoughtSignature(entry: EngineThoughtEntry): string {
  return [
    entry.depth ?? 'none',
    entry.displayScore ?? 'none',
    entry.displayMove ?? 'none',
    entry.engineRole ?? 'primary',
    entry.engineName ?? 'unknown',
    entry.displayPrincipalVariation.join('|')
  ].join('::')
}

export function appendThought(
  entries: EngineThoughtEntry[],
  entry: EngineThoughtEntry
): EngineThoughtEntry[] {
  const signature = thoughtSignature(entry)
  if (entries.some((item) => thoughtSignature(item) === signature)) return entries
  return [...entries, entry].slice(-MAX_ENGINE_THOUGHTS)
}

export function newestFirst(entries: EngineThoughtEntry[]): EngineThoughtEntry[] {
  return entries.slice().reverse()
}

export function continuationAfterBestMove(entry: EngineThoughtEntry): string[] {
  const principalVariation = entry.displayPrincipalVariation
  return entry.displayMove && principalVariation[0] === entry.displayMove
    ? principalVariation.slice(1)
    : principalVariation
}

export function analysisStatusLabel(
  status: EngineStatus | null,
  busy: boolean
): '分析中' | '已暫停' | '未就緒' {
  if (!status?.available) return '未就緒'
  return busy ? '分析中' : '已暫停'
}

function engineLabel(item: EngineThoughtEntry): string {
  const role = item.engineRole === 'verification' ? '複核' : '主'
  return item.engineName ? [role, item.engineName].join(' · ') : role
}

export function resultNotice(result: EngineAnalysisResultPayload | null): string | null {
  if (!result) return null
  if (result.engineDisagreement) {
    return '主引擎與複核引擎出現分歧，請交叉確認局面分析與 AI 解說。'
  }
  if (result.verificationWarning) return result.verificationWarning
  return null
}

interface Props {
  status: EngineStatus | null
  busy: boolean
  thoughts: EngineThoughtEntry[]
  result: EngineAnalysisResultPayload | null
  error: string | null
}

export function LiveAnalysisTable({
  status,
  busy,
  thoughts,
  result,
  error
}: Props): JSX.Element {
  const rows = newestFirst(thoughts)
  const statusLabel = analysisStatusLabel(status, busy)
  const notice = resultNotice(result)

  return (
    <section className="live-analysis-table" aria-live="polite">
      <div className="live-analysis-table-head">
        <h2>局面分析</h2>
        <span className={'live-analysis-status ' + statusLabel}>{statusLabel}</span>
      </div>

      {error && (
        <p className="live-analysis-message error-text" role="alert">
          分析未完成：{error}。請檢查引擎設定後再重新分析。
        </p>
      )}
      {!status?.available && (
        <p className="live-analysis-message engine-status warn">
          {status?.message ?? '尚未設定可用引擎'}。請到「設定」完成引擎設定或重新測試。
        </p>
      )}
      {notice && <p className="live-analysis-message engine-status warn">{notice}</p>}

      <div className="live-analysis-table-scroll">
        <table aria-label="逐深度局面分析">
          <thead>
            <tr>
              <th scope="col">類型／引擎</th>
              <th scope="col">深度</th>
              <th scope="col">時間</th>
              <th scope="col">局面評估</th>
              <th scope="col" className="live-analysis-column">
                局面分析
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td className="live-analysis-empty" colSpan={5}>
                  {busy ? '正在等待第一筆深度資料。' : '尚無分析資料；按「開始分析」建立局面分析。'}
                </td>
              </tr>
            ) : (
              rows.map((item, index) => (
                <tr className={index === 0 ? 'latest' : undefined} key={item.id}>
                  <td>{engineLabel(item)}</td>
                  <td>{item.depth ?? '—'}</td>
                  <td>{formatElapsedMs(item.elapsedMs)}</td>
                  <td>{item.displayScore ?? '—'}</td>
                  <td className="live-analysis-cell-analysis">
                    <b>{item.displayMove ?? '—'}</b>
                    <span>
                      {continuationAfterBestMove(item).length > 0
                        ? continuationAfterBestMove(item).slice(0, 17).join('　')
                        : '—'}
                    </span>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </section>
  )
}
