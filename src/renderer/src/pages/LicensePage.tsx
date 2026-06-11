/**
 * 授權啟用頁 (LicensePage) — SDS Q5 買斷授權
 *
 * 未啟用時取代主介面顯示。輸入 License Key 後經 main process 離線驗證
 * （Ed25519 簽章），通過即寫入本機並進入主介面。
 */

import { useState } from 'react'
import type { LicenseStatus } from '@shared/types/License'

interface Props {
  /** 啟用成功後進入主介面 */
  onActivated: (status: LicenseStatus) => void
}

export function LicensePage({ onActivated }: Props): JSX.Element {
  const [key, setKey] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const activate = async (): Promise<void> => {
    const trimmed = key.trim()
    if (!trimmed) {
      setError('請輸入 License Key。')
      return
    }
    setBusy(true)
    setError(null)
    try {
      const status = await window.api.license.activate(trimmed)
      if (status.activated) {
        onActivated(status)
      } else {
        setError(status.message ?? 'License Key 驗證失敗。')
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="setup-wizard">
      <div className="setup-card">
        <h2>象棋 AI 分析講解 — 軟體啟用</h2>
        <p className="muted">
          本軟體為買斷制。請輸入購買時取得的 License Key 以啟用（驗證在本機完成，
          不需要網路連線）。
        </p>

        <section className="card">
          <h3>🔑 License Key</h3>
          <div className="field">
            <textarea
              className="text-input"
              rows={4}
              placeholder="XQA1.…"
              value={key}
              onChange={(e) => {
                setKey(e.target.value)
                setError(null)
              }}
            />
            <p className="muted small">
              金鑰只儲存在本機（不上傳）。更換電腦時重新輸入同一組金鑰即可。
            </p>
          </div>
          {error && <div className="error-text">⚠ {error}</div>}
        </section>

        <div className="setup-actions">
          <button className="btn" onClick={() => void activate()} disabled={busy}>
            {busy ? '驗證中…' : '啟用 →'}
          </button>
        </div>
      </div>
    </div>
  )
}
