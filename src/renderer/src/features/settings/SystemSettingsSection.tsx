import type { AppUpdateStatus } from '@shared/types/AppUpdate'
import type { LicenseStatus } from '@shared/types/License'

interface Props {
  updateStatus: AppUpdateStatus | null
  updateBusy: boolean
  license: LicenseStatus | null
  licenseGateDisabled: boolean
  onExportBackup: () => void
  onImportBackup: () => void
  onCheckUpdate: () => void
  onDownloadUpdate: () => void
  onInstallUpdate: () => void
  onDeactivateLicense: () => void
}

export function SystemSettingsSection({
  updateStatus,
  updateBusy,
  license,
  licenseGateDisabled,
  onExportBackup,
  onImportBackup,
  onCheckUpdate,
  onDownloadUpdate,
  onInstallUpdate,
  onDeactivateLicense
}: Props): JSX.Element {
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
            備份包含錯題本、待理解局面、保存局面、猜著紀錄與 AI 對話；不包含 API Key。
          </p>
          <div className="row gap">
            <button className="btn" onClick={onExportBackup}>匯出 JSON 備份</button>
            <button className="btn ghost" onClick={onImportBackup}>匯入並合併</button>
          </div>
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
              <button className="btn danger" onClick={onDeactivateLicense}>解除啟用</button>
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
                }
                onClick={onCheckUpdate}
              >
                {updateStatus.phase === 'checking' ? '檢查中…' : '立即檢查'}
              </button>
              {updateStatus.phase === 'available' && (
                <button className="btn" disabled={updateBusy} onClick={onDownloadUpdate}>
                  下載更新
                </button>
              )}
              {updateStatus.phase === 'downloaded' && (
                <button className="btn" disabled={updateBusy} onClick={onInstallUpdate}>
                  重新啟動並安裝
                </button>
              )}
            </div>
          </>
        )}
      </section>
    </div>
  )
}
