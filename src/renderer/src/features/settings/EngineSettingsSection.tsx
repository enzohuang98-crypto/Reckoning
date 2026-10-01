import {
  ENGINE_PROFILES,
  type EngineProfileId,
  type EngineRegistrySnapshot
} from '@shared/types/EngineRegistry'
import type { EngineTestResult } from '@shared/types/ipc'

interface Props {
  registry: EngineRegistrySnapshot
  newProfile: EngineProfileId
  onNewProfileChange: (profile: EngineProfileId) => void
  newName: string
  onNewNameChange: (name: string) => void
  newPath: string
  testingEngineId: string | null
  message: string | null
  testResult: EngineTestResult | null
  onBrowse: () => void
  onAdd: () => void
  onRefresh: () => void
  onTest: (id: string) => void
  onRemove: (id: string) => void
  onSelect: (activeId: string) => void
}

export function EngineSettingsSection({
  registry,
  newProfile,
  onNewProfileChange,
  newName,
  onNewNameChange,
  newPath,
  testingEngineId,
  message,
  testResult,
  onBrowse,
  onAdd,
  onRefresh,
  onTest,
  onRemove,
  onSelect
}: Props): JSX.Element {
  const removeEngine = (id: string, name: string): void => {
    if (!window.confirm(`確定要從清單移除引擎「${name}」嗎？之後需要重新加入才能使用。`)) return
    onRemove(id)
  }

  return (
    <div className="settings-section-grid engine-settings-layout">
      <section className="card settings-feature-card">
        <div className="section-heading">
          <div>
            <span className="eyebrow">LOCAL ENGINES</span>
            <h3>已加入的象棋引擎</h3>
          </div>
          <button className="btn ghost small" onClick={onRefresh}>重新整理</button>
        </div>

        <p className="muted">
          使用內建 Pikafish，或選擇一個已加入的引擎。完成握手與短搜尋測試後才會標示「已驗證」。
        </p>

        <div className="engine-install-list">
          {registry.installations.length === 0 && (
            <div className="engine-status warn">尚未加入任何引擎。</div>
          )}
          {registry.installations.map((engine) => (
            <div className="engine-install-item" key={engine.id}>
              <div>
                <div className="engine-item-title">
                  <b>{engine.detectedName ?? engine.displayName}</b>
                  <span className={`badge ${engine.verified ? 'on' : 'off'}`}>
                    {engine.verified ? '已驗證' : '未驗證'}
                  </span>
                </div>
                <div className="muted small">
                  {engine.protocol?.toUpperCase() ?? '自動偵測'} ·{' '}
                  {ENGINE_PROFILES.find((profile) => profile.id === engine.profileId)?.label ??
                    '自訂引擎'}
                </div>
                <div className="mono muted small" title={engine.executablePath}>
                  {engine.executablePath}
                </div>
                {engine.lastError && <div className="error-text small">{engine.lastError}</div>}
              </div>
              <div className="engine-item-actions">
                <button
                  className="btn ghost small"
                  disabled={testingEngineId === engine.id}
                  onClick={() => onTest(engine.id)}
                >
                  {testingEngineId === engine.id ? '測試中…' : '測試'}
                </button>
                <button
                  className="btn danger small"
                  onClick={() => removeEngine(engine.id, engine.detectedName ?? engine.displayName)}
                >
                  移除
                </button>
              </div>
            </div>
          ))}
        </div>

        {registry.installations.length > 0 && (
          <div className="engine-selection-grid">
            <div className="field">
              <label className="field-label">預設主引擎</label>
              <select
                className="select"
                value={registry.activeEngineId ?? ''}
                onChange={(event) => onSelect(event.target.value)}
              >
                {registry.installations.map((engine) => (
                  <option value={engine.id} key={engine.id}>{engine.displayName}</option>
                ))}
              </select>
            </div>
          </div>
        )}
      </section>

      <div className="settings-stack">
        <section className="card">
          <div className="section-heading">
            <div>
              <span className="eyebrow">ADD ENGINE</span>
              <h3>加入本機引擎</h3>
            </div>
          </div>

          <div className="engine-add-box">
            <div className="field">
              <label className="field-label">引擎類型</label>
              <select
                className="select"
                value={newProfile}
                onChange={(event) => onNewProfileChange(event.target.value as EngineProfileId)}
              >
                {ENGINE_PROFILES.map((profile) => (
                  <option key={profile.id} value={profile.id}>{profile.label}</option>
                ))}
              </select>
              <div className="muted small">
                {ENGINE_PROFILES.find((profile) => profile.id === newProfile)?.description}
              </div>
            </div>
            <div className="field">
              <label className="field-label">顯示名稱（可留空）</label>
              <input
                className="text-input"
                value={newName}
                onChange={(event) => onNewNameChange(event.target.value)}
                placeholder="例如：我的旋風引擎"
              />
            </div>
          </div>

          <div className="field">
            <label className="field-label">引擎 EXE</label>
            <div className="settings-path-input">
              <input
                className="text-input"
                value={newPath}
                readOnly
                placeholder="按「瀏覽」選擇本機引擎 EXE"
              />
              <button className="btn ghost" onClick={onBrowse}>瀏覽…</button>
            </div>
          </div>

          <button className="btn" onClick={onAdd}>加入引擎</button>
          {message && <div className="notice-text">{message}</div>}
          {testResult && (
            <div className={testResult.ok ? 'success-text' : 'error-text'}>
              {testResult.ok
                ? `搜尋成功：${testResult.engineName ?? '象棋引擎'}${
                    testResult.protocol ? `（${testResult.protocol.toUpperCase()}）` : ''
                  }`
                : testResult.message ?? '引擎測試失敗。'}
            </div>
          )}
          {testResult?.diagnostics && testResult.diagnostics.length > 0 && (
            <details className="raw-engine-analysis">
              <summary>查看測試原始輸出</summary>
              <pre>{testResult.diagnostics.join('\n')}</pre>
            </details>
          )}
        </section>


      </div>
    </div>
  )
}
