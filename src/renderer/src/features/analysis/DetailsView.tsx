import type { EngineRegistrySnapshot } from '@shared/types/EngineRegistry'
import type { AppSettings } from '@shared/types/Settings'
import type { EngineAnalysisResultPayload } from '@shared/types/ipc'

interface Props {
  result: EngineAnalysisResultPayload | null
  settings: AppSettings
  registry: EngineRegistrySnapshot
  primaryEngineId: string | null
  verificationEngineId: string | null
  busy: boolean
  aiBusy: boolean
  collectionReason: string
  diagnostics: string[]
  onCollectionReasonChange: (value: string) => void
  onSaveMisunderstood: () => void
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
  collectionReason,
  diagnostics,
  onCollectionReasonChange,
  onSaveMisunderstood,
  onSelectPrimary,
  onSelectVerification
}: Props): JSX.Element {
  const analysis = result?.engineAnalysis
  const verificationChoices = registry.installations.filter(
    (engine) => engine.id !== primaryEngineId
  )
  const showVerificationControl =
    settings.crossEngineEnabled &&
    verificationEngineId !== null &&
    verificationChoices.length > 0
  const hasAdvancedDiagnostics = Boolean(
    analysis?.rawAnalysis ||
      result?.verificationEngineAnalysis?.rawAnalysis ||
      diagnostics.length > 0
  )

  return (
    <div className="analysis-view-content details-view">
      <div className="view-heading">
        <h3>分析資料</h3>
      </div>

      <section className="detail-card">
        <div className="section-heading">
          <h4>引擎選擇</h4>
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
            {showVerificationControl && (
              <div className="field">
                <label className="field-label">複核引擎</label>
                <select
                  className="select"
                  value={verificationEngineId ?? ''}
                  disabled={busy || aiBusy}
                  onChange={(event) => onSelectVerification(event.target.value || null)}
                >
                  <option value="">不複核</option>
                  {verificationChoices.map((engine) => (
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
        <section className="detail-card">
          <div className="section-heading">
            <h4>收藏目前局面</h4>
            <span className="muted small">保存到「待理解局面」</span>
          </div>
          <div className="analysis-bookmark-row">
            <input
              className="text-input"
              value={collectionReason}
              placeholder="例如：看不懂中炮交換"
              onChange={(event) => onCollectionReasonChange(event.target.value)}
            />
            <button className="btn ghost small" onClick={onSaveMisunderstood}>收藏</button>
          </div>
        </section>
      ) : (
        <div className="panel-empty-state">
          <span className="empty-state-mark">i</span>
          <h3>尚無分析資料</h3>
          <p>完成一次引擎分析後，可在這裡收藏局面與查看進階診斷。</p>
        </div>
      )}

      {hasAdvancedDiagnostics && (
        <details className="raw-engine-analysis">
          <summary>進階診斷（原始引擎輸出）</summary>
          {analysis?.rawAnalysis && (
            <>
              <h5>{analysis.engineName ?? '主引擎'}：主局面分析</h5>
              <pre>{analysis.rawAnalysis.root.join('\n') || '（沒有原始輸出）'}</pre>
              {analysis.rawAnalysis.userMove && (
                <>
                  <h5>猜著後的二次分析</h5>
                  <pre>{analysis.rawAnalysis.userMove.join('\n') || '（沒有原始輸出）'}</pre>
                </>
              )}
            </>
          )}
          {result?.verificationEngineAnalysis?.rawAnalysis && (
            <>
              <h5>{result.verificationEngineAnalysis.engineName}：複核局面分析</h5>
              <pre>
                {result.verificationEngineAnalysis.rawAnalysis.root.join('\n') ||
                  '（沒有原始輸出）'}
              </pre>
            </>
          )}
          {diagnostics.length > 0 && (
            <>
              <h5>診斷輸出</h5>
              <pre>{diagnostics.join('\n')}</pre>
            </>
          )}
        </details>
      )}
    </div>
  )
}
