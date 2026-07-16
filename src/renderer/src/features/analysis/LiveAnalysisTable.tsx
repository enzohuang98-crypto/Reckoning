import type {
  EngineAnalysisProgressPayload,
  EngineAnalysisResultPayload,
  EngineStatus
} from '@shared/types/ipc'
import type { EngineThoughtEntry } from './EngineConsole'

function formatElapsedMs(value?: number | null): string {
  if (value === undefined || value === null || !Number.isFinite(value) || value < 0) {
    return '—'
  }
  return `${(value / 1000).toFixed(1)}s`
}

function formatLargeNumber(value?: number | null): string {
  if (value === undefined || value === null || !Number.isFinite(value)) return '—'
  if (value >= 1_000_000_000) return `${(value / 1_000_000_000).toFixed(1)}B`
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}K`
  return String(value)
}

function analysisMethod(item: EngineThoughtEntry): string {
  const role = item.engineRole === 'verification' ? '複核引擎' : '主引擎'
  const phase =
    item.phase === 'user_move_analysis'
      ? '著法複核'
      : item.phase === 'finalizing'
        ? '結果整理'
        : '主線搜尋'
  return `${role} · ${phase}`
}

function currentPhase(progress: EngineAnalysisProgressPayload | null): string {
  if (!progress) return '分析中'
  if (progress.phase === 'user_move_analysis') return '著法複核中'
  if (progress.phase === 'finalizing') return '整理結果中'
  if (progress.phase === 'preparing_engine') return '準備分析中'
  return '主線搜尋中'
}

function continuationAfterMove(item: EngineThoughtEntry): string[] {
  return item.displayMove && item.displayPrincipalVariation[0] === item.displayMove
    ? item.displayPrincipalVariation.slice(1)
    : item.displayPrincipalVariation
}

function resultNotice(result: EngineAnalysisResultPayload | null): string | null {
  if (!result) return null
  if (result.engineDisagreement) {
    return '主引擎與複核引擎方向不同，請一併查看兩邊的候選著與 PV。'
  }
  return result.verificationWarning ?? null
}

interface Props {
  status: EngineStatus | null
  progress: EngineAnalysisProgressPayload | null
  busy: boolean
  thoughts: EngineThoughtEntry[]
  result: EngineAnalysisResultPayload | null
  error: string | null
  notice: string | null
  liveElapsedMs: number | null
  sinceLastThoughtMs: number | null
}

export function LiveAnalysisTable({
  status,
  progress,
  busy,
  thoughts,
  result,
  error,
  notice,
  liveElapsedMs,
  sinceLastThoughtMs
}: Props): JSX.Element {
  const rows = thoughts.slice().reverse()
  const resultWarning = resultNotice(result)
  const stateClass = !status?.available
    ? 'is-unavailable'
    : busy
      ? 'is-busy'
      : result
        ? 'is-ready'
        : 'is-idle'
  const statusText = !status?.available
    ? '未就緒'
    : busy
      ? `${currentPhase(progress)} ${formatElapsedMs(liveElapsedMs)}`
      : result
        ? '分析完成'
        : '等待分析'
  const statusTitle =
    busy && sinceLastThoughtMs !== null && sinceLastThoughtMs >= 3000
      ? `引擎仍在運算，${formatElapsedMs(sinceLastThoughtMs)}未回報新資料。`
      : undefined

  return (
    <section className="live-analysis-table" aria-live="polite">
      <div className="live-analysis-table-head">
        <h2>局面分析</h2>
        <span className={`live-analysis-status ${stateClass}`} title={statusTitle}>
          {statusText}
        </span>
      </div>

      {error && (
        <p className="live-analysis-message error-text" role="alert">
          分析未完成：{error}
        </p>
      )}
      {!status?.available && (
        <p className="live-analysis-message engine-status warn">
          {status?.message ?? '尚未設定可用引擎'}
        </p>
      )}
      {(notice ?? resultWarning) && (
        <p className="live-analysis-message engine-status warn">
          {notice ?? resultWarning}
        </p>
      )}

      <div className="live-analysis-table-scroll">
        <table aria-label="逐深度局面分析數字與分析找法">
          <thead>
            <tr>
              <th scope="col">分析找法</th>
              <th scope="col">分數</th>
              <th scope="col">深度</th>
              <th scope="col">時間</th>
              <th scope="col">NPS</th>
              <th scope="col">節點</th>
              <th scope="col" className="live-analysis-line-column">
                最佳著／候選與 PV
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td className="live-analysis-empty" colSpan={7}>
                  {busy
                    ? '正在等待第一筆分析資料。'
                    : '尚無分析資料；開始分析後會顯示數字、候選著與主線。'}
                </td>
              </tr>
            ) : (
              rows.map((item, index) => {
                const continuation = continuationAfterMove(item)
                return (
                  <tr className={index === 0 ? 'latest' : undefined} key={item.id}>
                    <td>
                      <b className="live-analysis-method">{analysisMethod(item)}</b>
                      {item.engineName && <span className="live-analysis-engine">{item.engineName}</span>}
                    </td>
                    <td>{item.scoreRaw ?? '—'}</td>
                    <td>
                      {item.depth ?? '—'}
                      {item.selDepth !== undefined && item.selDepth !== null
                        ? ` / ${item.selDepth}`
                        : ''}
                    </td>
                    <td>{formatElapsedMs(item.elapsedMs)}</td>
                    <td>{formatLargeNumber(item.nps)}</td>
                    <td>{formatLargeNumber(item.nodes)}</td>
                    <td className="live-analysis-cell-line">
                      <b>{item.displayMove ?? '—'}</b>
                      <span>
                        {continuation.length > 0
                          ? continuation.slice(0, 14).join('　')
                          : '尚無後續主線'}
                      </span>
                    </td>
                  </tr>
                )
              })
            )}
          </tbody>
        </table>
      </div>
    </section>
  )
}
