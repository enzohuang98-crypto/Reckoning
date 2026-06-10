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
import { saveSettings } from '../storage/localSettings'

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

  const refreshKeyStatus = async (): Promise<void> => {
    const entries = await Promise.all(
      PROVIDERS.map(async (p) => [p, await window.api.secret.has(p)] as const)
    )
    setHasKey(Object.fromEntries(entries) as Record<AIProviderId, boolean>)
  }

  useEffect(() => {
    window.api.secret.isAvailable().then(setEncAvailable)
    void refreshKeyStatus()
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
