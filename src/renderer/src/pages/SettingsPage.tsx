/**
 * 設定頁 (SettingsPage)
 *
 * - API 金鑰：透過 window.api.secret（SecretStore / safeStorage）安全儲存，
 *   絕不寫入 localStorage 一般設定。介面只顯示「是否已設定」，不顯示明文。
 * - 一般設定（Provider、模型、語言、引擎參數）：存於 localStorage。
 */

import { useEffect, useState } from 'react'
import {
  PROVIDER_DEFAULT_MODELS,
  type AIProviderId
} from '@shared/types/AIProviderTypes'
import type { AppSettings } from '@shared/types/Settings'
import type { EngineStatus } from '@shared/types/ipc'
import { saveSettings } from '../storage/localSettings'

const PATH_SOURCE_LABEL: Record<NonNullable<EngineStatus['pathSource']>, string> = {
  user: '使用者設定',
  env: '環境變數 PIKAFISH_PATH',
  resource: '打包資源'
}

const PROVIDERS: AIProviderId[] = ['anthropic', 'openai', 'gemini']
const PROVIDER_LABEL: Record<AIProviderId, string> = {
  anthropic: 'Anthropic Claude',
  openai: 'OpenAI（stub）',
  gemini: 'Google Gemini（stub）'
}

interface Props {
  settings: AppSettings
  onSettingsChange: (settings: AppSettings) => void
}

export function SettingsPage({ settings, onSettingsChange }: Props): JSX.Element {
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
    const status = await window.api.engine.setPath(path)
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

  useEffect(() => {
    window.api.secret.isAvailable().then(setEncAvailable)
    void refreshKeyStatus()
    void refreshEngine()
  }, [])

  const update = (patch: Partial<AppSettings>): void => {
    const next = { ...settings, ...patch }
    saveSettings(next)
    onSettingsChange(next)
  }

  const saveKey = async (provider: AIProviderId): Promise<void> => {
    const key = keyInputs[provider].trim()
    if (!key) return
    await window.api.secret.set(provider, key)
    setKeyInputs({ ...keyInputs, [provider]: '' })
    setSavedMsg(`${PROVIDER_LABEL[provider]} 金鑰已安全儲存。`)
    void refreshKeyStatus()
  }

  const deleteKey = async (provider: AIProviderId): Promise<void> => {
    await window.api.secret.delete(provider)
    setSavedMsg(`${PROVIDER_LABEL[provider]} 金鑰已刪除。`)
    void refreshKeyStatus()
  }

  return (
    <div className="settings-page">
      <h2>設定</h2>

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
        <h3>模型與語言</h3>
        <div className="field">
          <label className="field-label">使用中的 Provider</label>
          <select
            className="select"
            value={settings.activeProvider}
            onChange={(e) => update({ activeProvider: e.target.value as AIProviderId })}
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
            value={settings.selectedModels[settings.activeProvider]}
            onChange={(e) =>
              update({
                selectedModels: {
                  ...settings.selectedModels,
                  [settings.activeProvider]: e.target.value
                }
              })
            }
          >
            {PROVIDER_DEFAULT_MODELS[settings.activeProvider].map((m) => (
              <option key={m.id} value={m.id}>
                {m.label}
                {m.isDefault ? '（預設）' : ''}
              </option>
            ))}
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
          <label className="field-label">搜尋深度：{settings.engineDepth}</label>
          <input
            type="range"
            min={6}
            max={24}
            value={settings.engineDepth}
            onChange={(e) => update({ engineDepth: Number(e.target.value) })}
          />
        </div>
        <div className="field">
          <label className="field-label">候選線數量 (MultiPV)：{settings.engineMultiPv}</label>
          <input
            type="range"
            min={1}
            max={5}
            value={settings.engineMultiPv}
            onChange={(e) => update({ engineMultiPv: Number(e.target.value) })}
          />
        </div>
      </section>
    </div>
  )
}
