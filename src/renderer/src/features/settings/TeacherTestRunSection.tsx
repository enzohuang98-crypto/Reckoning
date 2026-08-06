import { useEffect, useState } from 'react'
import type { TeacherTestStartInput } from '@shared/types/ipc'
import type { TeacherTestRunStatusV1 } from '@shared/types/Harness'

interface Props {
  status: TeacherTestRunStatusV1
  busy: boolean
  message: string | null
  onStart: (input: TeacherTestStartInput) => void
  onEnd: () => void
}

export function TeacherTestRunSection({
  status,
  busy,
  message,
  onStart,
  onEnd
}: Props): JSX.Element {
  const [releaseTag, setReleaseTag] = useState('')
  const [productSourceCommit, setProductSourceCommit] = useState('')
  const [localError, setLocalError] = useState<string | null>(null)

  useEffect(() => {
    if (!releaseTag && status.currentAppVersion) {
      setReleaseTag(`v${status.currentAppVersion}`)
    }
  }, [releaseTag, status.currentAppVersion])

  const start = (): void => {
    const input = {
      releaseTag: releaseTag.trim(),
      productSourceCommit: productSourceCommit.trim()
    }
    if (!input.releaseTag || !/^[0-9a-f]{40}$/i.test(input.productSourceCommit)) {
      setLocalError('請填入與目前 App version 相符的 tag，以及完整 40 碼 product source commit。')
      return
    }
    setLocalError(null)
    onStart(input)
  }

  const manifest = status.manifest
  return (
    <section className="card settings-feature-card">
      <div className="section-heading">
        <div>
          <span className="eyebrow">TEACHER PILOT EVIDENCE</span>
          <h3>正式老師實測 run</h3>
        </div>
        <span className={`badge ${status.active ? 'on' : 'plain'}`}>
          {status.active ? '進行中' : '未開始'}
        </span>
      </div>
      <p className="muted">
        只在 main process 暫存匿名 run／case／review ID；老師姓名、簽名、API Key、完整路徑與主機名不會進入 export。
        選取安裝檔後會以非同步串流計算 SHA-256，並核對 hash 前後檔案大小與修改時間。
      </p>
      {!status.active && (
        <div className="settings-number-grid">
          <div className="field">
            <label className="field-label">被測 release tag</label>
            <input
              className="text-input"
              value={releaseTag}
              onChange={(event) => setReleaseTag(event.target.value)}
              placeholder={`v${status.currentAppVersion}`}
            />
          </div>
          <div className="field">
            <label className="field-label">product source commit</label>
            <input
              className="text-input"
              value={productSourceCommit}
              onChange={(event) => setProductSourceCommit(event.target.value)}
              placeholder="40 碼 SHA-1"
              spellCheck={false}
            />
          </div>
        </div>
      )}
      {localError && <p className="error-text">{localError}</p>}
      {message && <p className="muted">{message}</p>}
      {status.active && manifest ? (
        <div className="settings-stack">
          <p className="muted">
            <b>testRunId：</b>{manifest.testRunId}
          </p>
          <p className="muted">
            <b>App version：</b>{manifest.artifactClaim.appVersion}
          </p>
          <p className="muted">
            <b>release tag：</b>{manifest.artifactClaim.releaseTag}
          </p>
          <p className="muted">
            <b>source commit：</b>{manifest.artifactClaim.productSourceCommit}
          </p>
          <p className="muted">
            <b>installer：</b>{manifest.artifactClaim.installerFileName} · {manifest.artifactClaim.installerSha256}
          </p>
          <p className="muted">
            <b>runtime：</b>{manifest.runtime.systemVersion} · {manifest.runtime.osBuild} · {manifest.runtime.arch}
          </p>
          <button className="btn danger" onClick={onEnd} disabled={busy}>
            {busy ? '處理中…' : '結束正式實測 run'}
          </button>
        </div>
      ) : (
        <button className="btn primary" onClick={start} disabled={busy}>
          {busy ? '正在核對安裝檔…' : '選取安裝檔並開始正式實測'}
        </button>
      )}
    </section>
  )
}
