import type { AppSettings } from '@shared/types/Settings'
import type { SettingsUpdater } from './types'

interface Props {
  settings: AppSettings
  update: SettingsUpdater
  canUseCrossEngine: boolean
  traceCount: number
  onExportTraces: () => void
  onClearTraces: () => void
}

function boundedNumber(value: string, min: number, max: number): number | null {
  if (!value.trim()) return null
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return null
  return Math.max(min, Math.min(max, parsed))
}

export function HarnessSettingsSection({
  settings,
  update,
  canUseCrossEngine,
  traceCount,
  onExportTraces,
  onClearTraces
}: Props): JSX.Element {
  return (
    <div className="settings-section-grid">
      <section className="card settings-feature-card">
        <div className="section-heading">
          <div>
            <span className="eyebrow">EXPLANATION QUALITY LOOP</span>
            <h3>AI 解說 Harness</h3>
          </div>
          <span className="badge on">因果鏈驗證</span>
        </div>

        <p className="muted">
          Harness 會加深最佳著法與你的著法，驗證目的、錯失機會、對手利用與具體後果，
          並只重寫未達標的區塊。
        </p>

        <div className="field">
          <label className="field-label">預設回答模式</label>
          <select
            className="select"
            value={settings.harnessAnswerMode}
            onChange={(event) =>
              update({
                harnessAnswerMode: event.target.value as AppSettings['harnessAnswerMode']
              })
            }
          >
            <option value="research">完整研究</option>
            <option value="focused">聚焦回答</option>
          </select>
        </div>

        <div className="settings-toggle-list">
          <label className="check-row">
            <input
              type="checkbox"
              checked={settings.harnessAutoRun}
              onChange={(event) => update({ harnessAutoRun: event.target.checked })}
            />
            <span>
              <b>分析完成後自動解說</b>
              <small>只套用一般局面；點棋譜著法仍只跑引擎，按一次「AI 解說」才產生完整說明。</small>
            </span>
          </label>
          <label className="check-row">
            <input
              type="checkbox"
              checked={settings.harnessReuseEvidence}
              onChange={(event) => update({ harnessReuseEvidence: event.target.checked })}
            />
            <span>
              <b>追問沿用既有證據</b>
              <small>關閉時每次追問都會重新驗證引擎資料。</small>
            </span>
          </label>
          {canUseCrossEngine && (
            <label className="check-row">
              <input
                type="checkbox"
                checked={settings.crossEngineEnabled}
                onChange={(event) => update({ crossEngineEnabled: event.target.checked })}
              />
              <span>
                <b>啟用複核引擎</b>
                <small>只會使用你另外加入並選定的第二個產品引擎。</small>
              </span>
            </label>
          )}
        </div>
      </section>

      <div className="settings-stack">
        <section className="card">
          <div className="section-heading">
            <div>
              <span className="eyebrow">RESEARCH BUDGET</span>
              <h3>研究預算</h3>
            </div>
          </div>

          <div className="settings-number-grid">
            <div className="field">
              <label className="field-label">每輪研究秒數（20–60）</label>
              <input
                className="text-input"
                type="number"
                min={20}
                max={60}
                value={settings.harnessEngineTimeMs / 1000}
                onChange={(event) => {
                  const value = boundedNumber(event.target.value, 20, 60)
                  if (value !== null) update({ harnessEngineTimeMs: value * 1000 })
                }}
              />
            </div>
            <div className="field">
              <label className="field-label">完整研究模型呼叫（3–10）</label>
              <input
                className="text-input"
                type="number"
                min={3}
                max={10}
                value={settings.harnessResearchMaxModelCalls}
                onChange={(event) => {
                  const value = boundedNumber(event.target.value, 3, 10)
                  if (value !== null) update({ harnessResearchMaxModelCalls: value })
                }}
              />
            </div>
            <div className="field">
              <label className="field-label">完整研究輸出 tokens</label>
              <input
                className="text-input"
                type="number"
                min={500}
                max={20000}
                step={500}
                value={settings.harnessResearchMaxOutputTokens}
                onChange={(event) => {
                  const value = boundedNumber(event.target.value, 500, 20000)
                  if (value !== null) update({ harnessResearchMaxOutputTokens: value })
                }}
              />
            </div>
            <div className="field">
              <label className="field-label">聚焦回答模型呼叫（3–10）</label>
              <input
                className="text-input"
                type="number"
                min={3}
                max={10}
                value={settings.harnessFocusedMaxModelCalls}
                onChange={(event) => {
                  const value = boundedNumber(event.target.value, 3, 10)
                  if (value !== null) update({ harnessFocusedMaxModelCalls: value })
                }}
              />
            </div>
            <div className="field">
              <label className="field-label">聚焦回答輸出 tokens</label>
              <input
                className="text-input"
                type="number"
                min={500}
                max={20000}
                step={500}
                value={settings.harnessFocusedMaxOutputTokens}
                onChange={(event) => {
                  const value = boundedNumber(event.target.value, 500, 20000)
                  if (value !== null) update({ harnessFocusedMaxOutputTokens: value })
                }}
              />
            </div>
          </div>
        </section>

        <section className="card">
          <div className="section-heading">
            <div>
              <span className="eyebrow">LOCAL DIAGNOSTICS</span>
              <h3>解說診斷紀錄</h3>
            </div>
            <span className="badge plain">{traceCount} 筆</span>
          </div>
          <p className="muted">
            診斷紀錄保存在本機，可匯出作為回歸案例；不包含 API Key。
          </p>
          <div className="row gap">
            <button className="btn ghost" onClick={onExportTraces}>匯出診斷</button>
            <button className="btn danger" onClick={onClearTraces}>清除紀錄</button>
          </div>
        </section>
      </div>
    </div>
  )
}
