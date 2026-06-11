/**
 * 初始設定嚮導 (SetupWizard)
 *
 * 第一次啟動（引擎路徑與 API 金鑰皆未設定）時取代主介面顯示。
 * 兩個欄位皆可留空跳過；完成後寫入 setup_completed 旗標，之後不再顯示。
 * 金鑰一律走 window.api.secret（safeStorage），絕不寫入 localStorage。
 */

import { useState } from 'react'
import {
  ALL_PROVIDER_IDS,
  PROVIDER_LABEL,
  type AIProviderId
} from '@shared/types/AIProviderTypes'
import type { AppSettings } from '@shared/types/Settings'
import type { EngineTestResult } from '@shared/types/ipc'
import { markSetupCompleted, saveSettings } from '../storage/localSettings'

interface Props {
  settings: AppSettings
  onSettingsChange: (settings: AppSettings) => void
  /** 完成（或跳過）設定後進入主介面 */
  onComplete: () => void
}

export function SetupWizard({ settings, onSettingsChange, onComplete }: Props): JSX.Element {
  const [enginePath, setEnginePath] = useState('')
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<EngineTestResult | null>(null)
  const [provider, setProvider] = useState<AIProviderId>(settings.aiProvider)
  const [apiKey, setApiKey] = useState('')
  const [finishing, setFinishing] = useState(false)

  const browse = async (): Promise<void> => {
    const picked = await window.api.engine.browsePath()
    if (!picked) return
    setEnginePath(picked)
    setTestResult(null)
  }

  const runTest = async (): Promise<void> => {
    setTesting(true)
    setTestResult(null)
    try {
      const trimmed = enginePath.trim()
      if (trimmed) await window.api.engine.setPath(trimmed)
      setTestResult(await window.api.engine.test())
    } finally {
      setTesting(false)
    }
  }

  const finish = async (): Promise<void> => {
    setFinishing(true)
    try {
      const trimmed = enginePath.trim()
      if (trimmed) await window.api.engine.setPath(trimmed)
      const key = apiKey.trim()
      if (key) await window.api.secret.set(provider, key)
      if (provider !== settings.aiProvider) {
        const next = { ...settings, aiProvider: provider }
        saveSettings(next)
        onSettingsChange(next)
      }
      markSetupCompleted()
      onComplete()
    } finally {
      setFinishing(false)
    }
  }

  return (
    <div className="setup-wizard">
      <div className="setup-card">
        <h2>象棋 AI 分析講解 — 初始設定</h2>
        <p className="muted">
          兩項皆可留空之後再到「設定」頁補齊，但建議現在完成以啟用完整功能。
        </p>

        <section className="card">
          <h3>📦 引擎設定</h3>
          <div className="field">
            <label className="field-label">引擎路徑</label>
            <div className="row gap">
              <input
                className="text-input"
                type="text"
                placeholder="例如 C:\\Tools\\pikafish\\pikafish.exe"
                value={enginePath}
                onChange={(e) => {
                  setEnginePath(e.target.value)
                  setTestResult(null)
                }}
              />
              <button className="btn ghost" onClick={browse}>
                瀏覽…
              </button>
            </div>
            <p className="muted small">
              支援：Pikafish（UCI）、象棋小蟲、象棋旋風、象棋名手、烏雲象棋（UCCI）。
              協定會自動偵測。
            </p>
          </div>
          <div className="row gap">
            <button className="btn" onClick={runTest} disabled={testing}>
              {testing ? '測試中…' : '測試引擎'}
            </button>
            {testResult &&
              (testResult.ok ? (
                <span className="success-text">
                  ✓ 連線成功：{testResult.engineName}
                  {testResult.protocol ? `（${testResult.protocol.toUpperCase()}）` : ''}
                </span>
              ) : (
                <span className="error-text">⚠ {testResult.message ?? '測試失敗'}</span>
              ))}
          </div>
        </section>

        <section className="card">
          <h3>🤖 AI 解說設定</h3>
          <div className="field">
            <label className="field-label">Provider</label>
            <select
              className="select"
              value={provider}
              onChange={(e) => setProvider(e.target.value as AIProviderId)}
            >
              {ALL_PROVIDER_IDS.map((p) => (
                <option key={p} value={p}>
                  {PROVIDER_LABEL[p]}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label className="field-label">API Key</label>
            <input
              className="text-input"
              type="password"
              placeholder={provider === 'anthropic' ? 'sk-ant-…' : '輸入 API Key'}
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
            />
            <p className="muted small">
              金鑰以作業系統加密 (safeStorage) 儲存於本機，永不寫入一般設定或上傳。
            </p>
          </div>
        </section>

        <div className="setup-actions">
          <button className="btn" onClick={finish} disabled={finishing}>
            完成設定 →
          </button>
        </div>
      </div>
    </div>
  )
}
