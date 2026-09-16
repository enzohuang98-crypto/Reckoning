import type { AppUpdateStatus } from '@shared/types/AppUpdate'
import type { LicenseStatus } from '@shared/types/License'

interface Props {
  updateStatus: AppUpdateStatus | null
  updateBusy: boolean
  license: LicenseStatus | null
  licenseGateDisabled: boolean
  onExportBackup: () => void
  canExportBackup: boolean
  onImportBackup: () => void
  onCheckUpdate: () => void
  onDownloadUpdate: () => void
  onInstallUpdate: () => void
  onSetBackgroundPreparation: (enabled: boolean) => void
  onDeactivateLicense: () => void
}

export function SystemSettingsSection({
  updateStatus,
  updateBusy,
  license,
  licenseGateDisabled,
  onExportBackup,
  canExportBackup,
  onImportBackup,
  onCheckUpdate,
  onDownloadUpdate,
  onInstallUpdate,
  onSetBackgroundPreparation,
  onDeactivateLicense
}: Props): JSX.Element {
  const deactivateLicense = (): void => {
    if (!window.confirm('確定要解除這台電腦上的授權嗎？解除後需要重新輸入 License Key 才能再次啟用。')) return
    onDeactivateLicense()
  }

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

        <section className="card">
          <div className="section-heading">
            <div>
              <span className="eyebrow">LICENSE</span>
              <h3>軟體授權</h3>
            </div>
          </div>
          {license === null ? (
            <p className="muted">正在查詢授權狀態…</p>
          ) : license.activated ? (
            <>
              <div className="engine-status ok">
                已啟用買斷授權
                {license.info && (
                  <div className="license-details">
                    <span>被授權人：{license.info.licensee}</span>
                    <span className="mono">授權編號：{license.info.licenseId}</span>
                    {license.activatedAt && (
                      <span>啟用於 {new Date(license.activatedAt).toLocaleDateString()}</span>
                    )}
                  </div>
                )}
              </div>
              <button className="btn danger" onClick={deactivateLicense}>解除啟用</button>
              <p className="muted small system-note">
                解除只會清除本機紀錄；重新輸入同一組 License Key 即可再次啟用。
              </p>
            </>
          ) : (
            <div className="engine-status warn">
              {license.message ?? '尚未啟用。'}
              {licenseGateDisabled
                ? '（測試版暫不阻擋使用）'
                : '（重新啟動後會顯示啟用頁）'}
            </div>
          )}
        </section>
      </div>

      <section className="card settings-feature-card">
        <div className="section-heading">
          <div>
            <span className="eyebrow">APPLICATION UPDATE</span>
            <h3>版本與自動更新</h3>
          </div>
          {updateStatus && <span className="badge plain">v{updateStatus.currentVersion}</span>}
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
            <label className="row gap">
              <input
                type="checkbox"
                checked={updateStatus.preferences.backgroundPreparationEnabled}
                disabled={updateBusy}
                onChange={(event) =>
                  onSetBackgroundPreparation(event.currentTarget.checked)
                }
              />
              在背景準備新版本（準備完成後不會自動關閉程式）
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
