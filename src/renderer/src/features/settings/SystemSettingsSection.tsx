import type { AppUpdateStatus } from '@shared/types/AppUpdate'

interface Props {
  updateStatus: AppUpdateStatus | null
  updateBusy: boolean
  onExportBackup: () => void
  canExportBackup: boolean
  onImportBackup: () => void
  onCheckUpdate: () => void
  onDownloadUpdate: () => void
  onInstallUpdate: () => void
  onSetBackgroundPreparation: (enabled: boolean) => void
}

export function SystemSettingsSection({
  updateStatus,
  updateBusy,
  onExportBackup,
  canExportBackup,
  onImportBackup,
  onCheckUpdate,
  onDownloadUpdate,
  onInstallUpdate,
  onSetBackgroundPreparation
}: Props): JSX.Element {
  const installUpdate = (): void => {
    if (!window.confirm('更新已準備完成。現在要先保存資料，再重新啟動 Reckoning 完成更新嗎？')) return
    onInstallUpdate()
  }

  return (
    <div className="settings-section-grid">
      <div className="settings-stack">
        <section className="card settings-feature-card">
          <div className="section-heading">
            <div>
              <span className="eyebrow">LOCAL DATA</span>
              <h3>資料備份與還原</h3>
            </div>
          </div>
          <p className="muted">
            备份包含保存局面、猜着纪录与 AI 对话；不包含 API Key。
          </p>
          <div className="row gap">
            <button
              className="btn"
              disabled={!canExportBackup}
              onClick={onExportBackup}
            >
              匯出 JSON 備份
            </button>
            <button className="btn ghost" onClick={onImportBackup}>匯入並合併</button>
          </div>
          {!canExportBackup && (
            <p className="muted small">
              目前資料讀取失敗；先完成重新讀取，避免把保護用的空白資料誤當成備份。
            </p>
          )}
        </section>


      </div>

      <section className="card settings-feature-card">
        <div className="section-heading">
          <div>
            <span className="eyebrow">APPLICATION UPDATE</span>
            <h3>版本與自動更新</h3>
          </div>
          {updateStatus && (
            <span className="badge plain" role="status" aria-label={`目前版本 v${updateStatus.currentVersion}`}>
              v{updateStatus.currentVersion}
            </span>
          )}
        </div>

        {updateStatus === null ? (
          <p className="muted">正在讀取版本資訊…</p>
        ) : (
          <>
            <div
              className={`engine-status ${
                updateStatus.phase === 'error' || updateStatus.phase === 'unconfigured'
                  ? 'warn'
                  : 'ok'
              }`}
            >
              {updateStatus.message}
            </div>
            {updateStatus.availableVersion && (
              <p className="muted">可用版本：{updateStatus.availableVersion}</p>
            )}
            <label className="background-update-choice">
              <input
                type="checkbox"
                checked={updateStatus.preferences.backgroundPreparationEnabled}
                disabled={updateBusy}
                onChange={(event) =>
                  onSetBackgroundPreparation(event.currentTarget.checked)
                }
              />
              <span>在背景準備新版本（準備完成後不會自動關閉程式）</span>
            </label>
            {updateStatus.phase === 'downloading' && (
              <progress
                className="update-progress"
                max={100}
                value={updateStatus.downloadPercent ?? 0}
              />
            )}
            <div className="row gap">
              <button
                className="btn ghost"
                disabled={
                  updateBusy ||
                  !updateStatus.automaticChecksEnabled ||
                  updateStatus.phase === 'checking' ||
                  updateStatus.phase === 'downloading'
                  || updateStatus.phase === 'downloaded'
                  || updateStatus.phase === 'installing'
                }
                onClick={onCheckUpdate}
              >
                {updateStatus.phase === 'checking' ? '檢查中…' : '立即檢查'}
              </button>
              {updateStatus.phase === 'downloaded' && (
                <button data-update-action="install" className="btn" disabled={updateBusy} onClick={installUpdate}>
                  重新啟動完成更新
                </button>
              )}
              {updateStatus.phase === 'available' && (
                <button
                  className="btn"
                  disabled={updateBusy}
                  onClick={onDownloadUpdate}
                >
                  立即背景準備
                </button>
              )}
            </div>
          </>
        )}
      </section>
    </div>
  )
}
