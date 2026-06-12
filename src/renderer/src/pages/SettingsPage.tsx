/**
 * 設定頁 (SettingsPage)
 *
 * - API 金鑰：透過 window.api.secret（SecretStore / safeStorage）安全儲存，
 *   絕不寫入 localStorage 一般設定。介面只顯示「是否已設定」，不顯示明文。
 * - 一般設定（Provider、模型、語言、引擎參數）：存於 localStorage。
 */

import { useEffect, useState } from 'react'
import {
  ALL_PROVIDER_IDS,
  PROVIDER_DEFAULT_MODELS,
  PROVIDER_LABEL,
  type AIProviderId
} from '@shared/types/AIProviderTypes'
import type { AppSettings } from '@shared/types/Settings'
import type { EngineStatus } from '@shared/types/ipc'
import type { LicenseStatus } from '@shared/types/License'
import { saveSettings } from '../storage/localSettings'
import type { AppDataSnapshot } from '@shared/types/AppData'

const PATH_SOURCE_LABEL: Record<NonNullable<EngineStatus['pathSource']>, string> = {
  user: '使用者設定',
  env: '環境變數 PIKAFISH_PATH',
  resource: '打包資源'
}

const PROVIDERS = ALL_PROVIDER_IDS

interface Props {
  settings: AppSettings
  onSettingsChange: (settings: AppSettings) => void
  onDataImported: (snapshot: AppDataSnapshot) => void
}

export function SettingsPage({
  settings,
  onSettingsChange,
  onDataImported
}: Props): JSX.Element {
  const [keyInputs, setKeyInputs] = useState<Record<AIProviderId, string>>({
    anthropic: '',
    openai: '',
    gemini: ''
  })
  const [hasKey, setHasKey] = useState<Record<AIProviderId, boolean>>({
    anthropic: false,
    openai: false,
    gemini: false
  })
  const [encAvailable, setEncAvailable] = useState<boolean | null>(null)
  const [savedMsg, setSavedMsg] = useState<string | null>(null)
  const [operationError, setOperationError] = useState<string | null>(null)

  // 引擎路徑（存於 main 的 StorageService，非 localStorage）
  const [enginePathInput, setEnginePathInput] = useState('')
  const [engineStatus, setEngineStatus] = useState<EngineStatus | null>(null)
  const [engineMsg, setEngineMsg] = useState<string | null>(null)
  /** 是否已存有使用者自訂路徑（即使該路徑暫時無法解析，也允許清除） */
  const [hasUserPath, setHasUserPath] = useState(false)

  const refreshEngine = async (): Promise<void> => {
    const [path, status] = await Promise.all([
      window.api.engine.getPath(),
      window.api.engine.status()
    ])
    setEnginePathInput(path ?? '')
    setHasUserPath(path !== null && path.trim().length > 0)
    setEngineStatus(status)
  }

  const saveEnginePath = async (path: string | null): Promise<void> => {
    let status: EngineStatus
    try {
      status = await window.api.engine.setPath(path)
    } catch {
      setEngineMsg('⚠ 路徑格式無效；請選擇本機磁碟上的引擎可執行檔。')
      return
    }
    setEngineStatus(status)
    setEnginePathInput(path ?? '')
    const provided = path !== null && path.trim().length > 0
    setHasUserPath(provided)

    let msg: string
    if (provided && status.pathSource !== 'user') {
      // 指定了路徑，但實際生效來源不是它（檔案不存在 / 解析失敗）
      msg = status.available
        ? `⚠ 找不到指定的檔案，目前改用「${
            status.pathSource ? PATH_SOURCE_LABEL[status.pathSource] : '無'
          }」。請確認路徑是否正確。`
        : `⚠ ${status.message ?? '指定的路徑無法使用。'}`
    } else if (provided) {
      msg = '✓ 已套用使用者指定的引擎路徑。'
    } else {
      // 清除自訂路徑
      msg = status.available
        ? `✓ 已清除自訂路徑，改用「${
            status.pathSource ? PATH_SOURCE_LABEL[status.pathSource] : '無'
          }」。`
        : '已清除自訂路徑。目前未偵測到可用引擎。'
    }
    setEngineMsg(msg)
  }

  const browseEnginePath = async (): Promise<void> => {
    const picked = await window.api.engine.browsePath()
    if (!picked) return
    setEnginePathInput(picked)
    await saveEnginePath(picked)
  }

  const refreshKeyStatus = async (): Promise<void> => {
    const entries = await Promise.all(
      PROVIDERS.map(async (p) => [p, await window.api.secret.has(p)] as const)
    )
    setHasKey(Object.fromEntries(entries) as Record<AIProviderId, boolean>)
  }

  // 買斷授權狀態（SDS Q5）
  const [license, setLicense] = useState<LicenseStatus | null>(null)

  useEffect(() => {
    window.api.secret.isAvailable().then(setEncAvailable).catch(() => setEncAvailable(false))
    void refreshKeyStatus().catch(() => setOperationError('無法查詢 API Key 狀態。'))
    void refreshEngine().catch(() => setOperationError('無法查詢引擎狀態。'))
    window.api.license.status().then(setLicense).catch(() => setLicense(null))
  }, [])

  const deactivateLicense = async (): Promise<void> => {
    const status = await window.api.license.deactivate()
    setLicense(status)
    // 解除後主介面會在下次啟動時要求重新輸入 License Key
  }

  const update = (patch: Partial<AppSettings>): void => {
    const next = { ...settings, ...patch }
    onSettingsChange(next)
    const saved = saveSettings(next)
    if (!saved.ok) setOperationError(saved.message ?? '設定儲存失敗。')
    else setOperationError(null)
  }

  const saveKey = async (provider: AIProviderId): Promise<void> => {
    const key = keyInputs[provider].trim()
    if (!key) return
    try {
      await window.api.secret.set(provider, key)
      setKeyInputs({ ...keyInputs, [provider]: '' })
      setSavedMsg(`${PROVIDER_LABEL[provider]} 金鑰已安全儲存。`)
      setOperationError(null)
      void refreshKeyStatus()
    } catch {
      setOperationError('無法安全儲存 API Key，系統不會以明文保存。')
    }
  }

  const deleteKey = async (provider: AIProviderId): Promise<void> => {
    try {
      await window.api.secret.delete(provider)
      setSavedMsg(`${PROVIDER_LABEL[provider]} 金鑰已刪除。`)
      setOperationError(null)
      void refreshKeyStatus()
    } catch {
      setOperationError('API Key 刪除失敗，請稍後重試。')
    }
  }

  const exportBackup = async (): Promise<void> => {
    const result = await window.api.data.exportBackup()
    if (result.ok) {
      setSavedMsg(`資料已匯出：${result.filePath}`)
      setOperationError(null)
    } else if (!result.cancelled) {
      setOperationError(result.message ?? '資料匯出失敗。')
    }
  }

  const importBackup = async (): Promise<void> => {
    const result = await window.api.data.importBackup()
    if (result.ok) {
      onDataImported(result.snapshot)
      const total = Object.values(result.summary).reduce((sum, count) => sum + count, 0)
      setSavedMsg(`匯入完成，共新增 ${total} 筆資料；重複資料已略過。`)
      setOperationError(null)
    } else if (!result.cancelled) {
      setOperationError(result.message ?? '資料匯入失敗。')
    }
  }

  return (
    <div className="settings-page">
      <div className="page-heading">
        <div>
          <span className="eyebrow">SYSTEM PREFERENCES</span>
          <h1>設定</h1>
          <p>管理本機引擎、AI 模型、資料備份與分析深度。</p>
        </div>
        <div className="heading-status">
          <span className="status-dot" />
          資料保存在本機
        </div>
      </div>
      {operationError && <div className="error-text">⚠ {operationError}</div>}

      <div className="settings-grid">
      <section className="card">
        <h3>AI Provider 金鑰</h3>
        {encAvailable === false && (
          <div className="error-text">
            ⚠ 此系統不支援安全加密儲存，將拒絕保存金鑰以保護安全。
          </div>
        )}
        <p className="muted">
          金鑰以作業系統加密 (safeStorage) 儲存於本機，永不寫入一般設定或上傳。
        </p>
        {PROVIDERS.map((provider) => (
          <div key={provider} className="key-row">
            <div className="key-head">
              <b>{PROVIDER_LABEL[provider]}</b>
              <span className={`badge ${hasKey[provider] ? 'on' : 'off'}`}>
                {hasKey[provider] ? '已設定' : '未設定'}
              </span>
            </div>
            <div className="row gap">
              <input
                className="text-input"
                type="password"
                placeholder={`輸入 ${PROVIDER_LABEL[provider]} API Key`}
                value={keyInputs[provider]}
                onChange={(e) =>
                  setKeyInputs({ ...keyInputs, [provider]: e.target.value })
                }
              />
              <button className="btn" onClick={() => saveKey(provider)}>
                儲存
              </button>
              {hasKey[provider] && (
                <button className="btn danger" onClick={() => deleteKey(provider)}>
                  刪除
                </button>
              )}
            </div>
          </div>
        ))}
        {savedMsg && <div className="success-text">{savedMsg}</div>}
      </section>

      <section className="card">
        <h3>資料備份與還原</h3>
        <p className="muted">
          備份包含錯題本、待理解局面、保存局面、猜著紀錄與 AI 對話；不包含 API Key。
        </p>
        <div className="row gap">
          <button className="btn" onClick={() => void exportBackup()}>
            匯出 JSON 備份
          </button>
          <button className="btn ghost" onClick={() => void importBackup()}>
            匯入並合併
          </button>
        </div>
      </section>

      <section className="card">
        <h3>模型與解說</h3>
        <div className="field">
          <label className="field-label">使用中的 Provider</label>
          <select
            className="select"
            value={settings.aiProvider}
            onChange={(e) => {
              const aiProvider = e.target.value as AIProviderId
              // 切換 Provider 時改用該家預設模型（不得用 "default" 字串）
              const defaultModel =
                PROVIDER_DEFAULT_MODELS[aiProvider].find((m) => m.isDefault) ??
                PROVIDER_DEFAULT_MODELS[aiProvider][0]
              update({ aiProvider, aiModel: defaultModel.id })
            }}
          >
            {PROVIDERS.map((p) => (
              <option key={p} value={p}>
                {PROVIDER_LABEL[p]}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label className="field-label">模型</label>
          <select
            className="select"
            value={settings.aiModel}
            onChange={(e) => update({ aiModel: e.target.value })}
          >
            {PROVIDER_DEFAULT_MODELS[settings.aiProvider].map((m) => (
              <option key={m.id} value={m.id}>
                {m.label}
                {m.isDefault ? '（預設）' : ''}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label className="field-label">你的棋力（影響 AI 解說深淺）</label>
          <select
            className="select"
            value={settings.userLevel}
            onChange={(e) => update({ userLevel: e.target.value as AppSettings['userLevel'] })}
          >
            <option value="basic">初學</option>
            <option value="intermediate">中級</option>
            <option value="advanced">進階</option>
          </select>
        </div>
        <div className="field">
          <label className="field-label">解說語言</label>
          <select
            className="select"
            value={settings.language}
            onChange={(e) =>
              update({ language: e.target.value as AppSettings['language'] })
            }
          >
            <option value="zh-TW">繁體中文</option>
            <option value="zh-CN">简体中文</option>
            <option value="en">English</option>
          </select>
        </div>
      </section>

      <section className="card">
        <h3>Pikafish 引擎</h3>
        <p className="muted">
          指定本機 Pikafish 可執行檔路徑。優先序：此處設定 &gt; 環境變數 PIKAFISH_PATH &gt;
          打包資源。路徑安全儲存於本機設定檔（非金鑰），重啟後自動沿用。
        </p>
        {engineStatus && (
          <div className={`engine-status ${engineStatus.available ? 'ok' : 'warn'}`}>
            {engineStatus.available
              ? `✓ ${engineStatus.engineName} 就緒（來源：${
                  engineStatus.pathSource
                    ? PATH_SOURCE_LABEL[engineStatus.pathSource]
                    : '無'
                }${
                  engineStatus.protocol
                    ? `，協定：${engineStatus.protocol.toUpperCase()}`
                    : ''
                }）`
              : `⚠ ${engineStatus.message ?? `${engineStatus.engineName} 未就緒`}`}
            {engineStatus.resolvedPath && (
              <div className="mono muted small">{engineStatus.resolvedPath}</div>
            )}
          </div>
        )}
        <div className="field">
          <label className="field-label">引擎可執行檔路徑</label>
          <div className="row gap">
            <input
              className="text-input"
              type="text"
              placeholder="例如 C:\\Tools\\pikafish\\pikafish.exe"
              value={enginePathInput}
              onChange={(e) => setEnginePathInput(e.target.value)}
            />
            <button className="btn ghost" onClick={browseEnginePath}>
              瀏覽…
            </button>
          </div>
        </div>
        <div className="row gap">
          <button className="btn" onClick={() => saveEnginePath(enginePathInput)}>
            儲存並套用
          </button>
          <button className="btn ghost" onClick={() => void refreshEngine()}>
            重新偵測
          </button>
          {hasUserPath && (
            <button className="btn danger" onClick={() => saveEnginePath(null)}>
              清除自訂路徑
            </button>
          )}
        </div>
        {engineMsg && (
          <div className={engineMsg.startsWith('✓') ? 'success-text' : 'error-text'}>
            {engineMsg}
          </div>
        )}
      </section>

      <section className="card">
        <h3>引擎參數</h3>
        <div className="field">
          <label className="field-label">
            局面分析時間：{(settings.rootAnalysisMovetimeMs / 1000).toFixed(1)} 秒
          </label>
          <input
            type="range"
            min={1000}
            max={10000}
            step={500}
            value={settings.rootAnalysisMovetimeMs}
            onChange={(e) => update({ rootAnalysisMovetimeMs: Number(e.target.value) })}
          />
        </div>
        <div className="field">
          <label className="field-label">
            猜測著法評估時間：{(settings.userMoveEvalMovetimeMs / 1000).toFixed(1)} 秒
          </label>
          <input
            type="range"
            min={500}
            max={3000}
            step={100}
            value={settings.userMoveEvalMovetimeMs}
            onChange={(e) => update({ userMoveEvalMovetimeMs: Number(e.target.value) })}
          />
        </div>
        <div className="field">
          <label className="field-label">候選著法數量 (MultiPV)：{settings.multiPv}</label>
          <input
            type="range"
            min={1}
            max={5}
            value={settings.multiPv}
            onChange={(e) => update({ multiPv: Number(e.target.value) })}
          />
        </div>
      </section>

      <section className="card">
        <h3>軟體授權</h3>
        {license === null ? (
          <p className="muted">查詢授權狀態中…</p>
        ) : license.activated ? (
          <>
            <div className="engine-status ok">
              ✓ 已啟用（買斷授權）
              {license.info && (
                <div className="muted small">
                  被授權人：{license.info.licensee}　授權編號：
                  <span className="mono">{license.info.licenseId}</span>
                  {license.activatedAt &&
                    `　啟用於 ${new Date(license.activatedAt).toLocaleDateString()}`}
                </div>
              )}
            </div>
            <div className="row gap">
              <button className="btn danger" onClick={() => void deactivateLicense()}>
                解除啟用
              </button>
            </div>
            <p className="muted small">
              解除啟用只清除本機紀錄；重新輸入同一組 License Key 即可再次啟用。
            </p>
          </>
        ) : (
          <div className="engine-status warn">
            ⚠ {license.message ?? '尚未啟用。'}（重新啟動程式後會顯示啟用頁）
          </div>
        )}
      </section>
      </div>
    </div>
  )
}
