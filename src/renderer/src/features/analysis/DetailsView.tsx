import type { EngineRegistrySnapshot } from '@shared/types/EngineRegistry'
import type { AppSettings } from '@shared/types/Settings'
import type { EngineAnalysisResultPayload } from '@shared/types/ipc'
import { EngineResultSummary } from './EngineResultSummary'

interface Props {
  result: EngineAnalysisResultPayload | null
  settings: AppSettings
  registry: EngineRegistrySnapshot
  primaryEngineId: string | null
  verificationEngineId: string | null
  busy: boolean
  aiBusy: boolean
  diagnostics: string[]
  onSelectPrimary: (id: string) => void
  onSelectVerification: (id: string | null) => void
}

export function DetailsView({
  result,
  settings,
  registry,
  primaryEngineId,
  verificationEngineId,
  busy,
  aiBusy,
  diagnostics,
  onSelectPrimary,
  onSelectVerification
}: Props): JSX.Element {
  const analysis = result?.engineAnalysis

  return (
    <div className="analysis-view-content details-view">
      <div className="view-heading">
        <div>
          <span className="eyebrow">ANALYSIS DATA</span>
          <h3>引擎與原始資料</h3>
        </div>
        <span className="badge plain">進階</span>
      </div>

      <section className="detail-card">
        <div className="section-heading">
          <h4>本次使用引擎</h4>
          <span className="muted small">切換後會自動重新分析</span>
        </div>
        {registry.installations.length > 0 ? (
          <div className="analysis-engine-selectors">
            <div className="field">
              <label className="field-label">主引擎</label>
              <select
                className="select"
                value={primaryEngineId ?? ''}
                disabled={busy || aiBusy}
                onChange={(event) => onSelectPrimary(event.target.value)}
              >
                {registry.installations.map((engine) => (
                  <option key={engine.id} value={engine.id}>
                    {engine.displayName}{engine.verified ? '' : '（未驗證）'}
                  </option>
                ))}
              </select>
            </div>
            {settings.crossEngineEnabled && registry.installations.length > 1 && (
              <div className="field">
                <label className="field-label">複核引擎</label>
                <select
                  className="select"
                  value={verificationEngineId ?? ''}
                  disabled={busy || aiBusy}
                  onChange={(event) => onSelectVerification(event.target.value || null)}
                >
                  <option value="">不複核</option>
                  {registry.installations
                    .filter((engine) => engine.id !== primaryEngineId)
                    .map((engine) => (
                      <option key={engine.id} value={engine.id}>
                        {engine.displayName}{engine.verified ? '' : '（未驗證）'}
                      </option>
                    ))}
                </select>
              </div>
            )}
          </div>
        ) : (
          <div className="engine-status warn">尚未加入可用引擎，請到設定頁完成設定。</div>
        )}
      </section>

      {result ? (
        <>
          <EngineResultSummary result={result} />

          <section className="detail-card">
            <div className="section-heading">
              <h4>{analysis?.engineName ?? '引擎'}原始輸出</h4>
              <span className="muted small">
                最佳著法 {analysis?.displayBestMove ?? '無'} · 深度 {analysis?.depth ?? '—'}
              </span>
            </div>
            {analysis?.rawAnalysis ? (
              <details className="raw-engine-analysis" open>
                <summary>主局面分析</summary>
                <pre>{analysis.rawAnalysis.root.join('\n') || '（沒有原始輸出）'}</pre>
                {analysis.rawAnalysis.userMove && (
                  <>
                    <h5>猜測著法二次分析</h5>
                    <pre>{analysis.rawAnalysis.userMove.join('\n') || '（沒有原始輸出）'}</pre>
                  </>
                )}
              </details>
            ) : (
              <div className="muted">本次分析沒有保留原始輸出。</div>
            )}

            {result.verificationEngineAnalysis?.rawAnalysis && (
              <details className="raw-engine-analysis">
                <summary>{result.verificationEngineAnalysis.engineName} 複核原始分析</summary>
                <pre>
                  {result.verificationEngineAnalysis.rawAnalysis.root.join('\n') ||
                    '（沒有原始輸出）'}
                </pre>
              </details>
            )}
          </section>
        </>
      ) : (
        <div className="panel-empty-state">
          <span className="empty-state-mark">i</span>
          <h3>尚無分析資料</h3>
          <p>完成一次引擎分析後，這裡會顯示原始輸出。</p>
        </div>
      )}

      {diagnostics.length > 0 && (
        <details className="raw-engine-analysis">
          <summary>引擎診斷輸出</summary>
          <pre>{diagnostics.join('\n')}</pre>
        </details>
      )}
    </div>
  )
}
