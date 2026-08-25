import { useState } from 'react'
import { PROVIDER_LABEL } from '@shared/types/AIProviderTypes'
import type { AppSettings } from '@shared/types/Settings'
import type { SecretStatus } from '@shared/types/ipc'
import type { SettingsUpdater } from './types'

interface Props {
  settings: AppSettings
  update: SettingsUpdater
  apiKey: string
  onApiKeyChange: (value: string) => void
  secretStatus: SecretStatus
  encryptionAvailable: boolean | null
  secretBusy: boolean
  onConnectKey: () => void
  onDeleteKey: () => void
}

export function AiSettingsSection({
  settings,
  update,
  apiKey,
  onApiKeyChange,
  secretStatus,
  encryptionAvailable,
  secretBusy,
  onConnectKey,
  onDeleteKey
}: Props): JSX.Element {
  const [deleteConfirmation, setDeleteConfirmation] = useState(false)
  const active = secretStatus.activeCredential

  return (
    <div className="settings-section-grid">
      <section className="card settings-feature-card">
        <div className="section-heading">
          <div>
            <span className="eyebrow">SECURE AI CONNECTION</span>
            <h3>AI API 金钥匙</h3>
          </div>
          <span className={`badge ${secretStatus.configured ? 'on' : 'off'}`}>
            {secretStatus.configured ? '已连线' : '未设定'}
          </span>
        </div>

        <p className="muted">
          直接贴上 OpenAI、Anthropic Claude 或 Google Gemini 的官方 API Key。
          程式会自动辨识服务、读取这把钥匙实际可用的模型，并以真实生成验证；成功后才加密储存。
        </p>

        {encryptionAvailable === false && (
          <div className="error-text">
            此系统不支援安全加密储存，程式会拒绝以明文保存金钥匙。
          </div>
        )}

        <div className="settings-key-input">
          <input
            aria-label="AI API Key"
            className="text-input"
            type="password"
            autoComplete="off"
            spellCheck={false}
            placeholder="贴上 API Key"
            value={apiKey}
            disabled={secretBusy || encryptionAvailable === false}
            onChange={(event) => onApiKeyChange(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && apiKey.trim() && !secretBusy) onConnectKey()
            }}
          />
          <button
            className="btn"
            onClick={onConnectKey}
            disabled={!apiKey.trim() || secretBusy || encryptionAvailable === false}
          >
            {secretBusy ? '辨识、验证与连线中…' : '自动连线'}
          </button>
        </div>

        {active && (
          <div className="key-row">
            <div className="key-head"><b>目前使用中</b></div>
            <div className="row gap">
              <span>{PROVIDER_LABEL[active.provider]} · {active.model}</span>
              <button
                className="btn danger small"
                disabled={secretBusy}
                onClick={() => {
                  if (!deleteConfirmation) {
                    setDeleteConfirmation(true)
                    return
                  }
                  setDeleteConfirmation(false)
                  onDeleteKey()
                }}
              >
                {deleteConfirmation ? '再次按下确认删除' : '删除金钥匙'}
              </button>
              {deleteConfirmation && (
                <button className="btn ghost small" onClick={() => setDeleteConfirmation(false)}>
                  取消
                </button>
              )}
            </div>
          </div>
        )}
      </section>

      <section className="card">
        <div className="section-heading">
          <div>
            <span className="eyebrow">EXPLANATION PREFERENCES</span>
            <h3>解说偏好</h3>
          </div>
        </div>

        <div className="field">
          <label className="field-label">你的棋力（影响解说深浅）</label>
          <select
            className="select"
            value={settings.userLevel}
            onChange={(event) =>
              update({ userLevel: event.target.value as AppSettings['userLevel'] })
            }
          >
            <option value="basic">初学</option>
            <option value="intermediate">中级</option>
            <option value="advanced">进阶</option>
          </select>
        </div>

        <div className="field">
          <label className="field-label">解说语言</label>
          <select
            className="select"
            value={settings.language}
            onChange={(event) =>
              update({ language: event.target.value as AppSettings['language'] })
            }
          >
            <option value="zh-TW">繁體中文</option>
            <option value="zh-CN">简体中文</option>
            <option value="en">English</option>
          </select>
        </div>
      </section>
    </div>
  )
}
