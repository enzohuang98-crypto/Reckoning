/**
 * 初始設定嚮導 (SetupWizard)
 *
 * 第一次啟動（引擎路徑與 API 金鑰皆未設定）時取代主介面顯示。
 * 兩個欄位皆可留空跳過；完成後寫入 setup_completed 旗標，之後不再顯示。
 * 金鑰一律走 window.api.secret（safeStorage），絕不寫入 localStorage。
 */

import { useState } from 'react'
import {
  PROVIDER_DEFAULT_MODELS,
  PROVIDER_LABEL,
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
  const [apiKey, setApiKey] = useState('')
  const [finishing, setFinishing] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const browse = async (): Promise<void> => {
    const picked = await window.api.engine.browsePath()
    if (!picked) return
    setEnginePath(picked)
    setTestResult(null)
  }

  const runTest = async (): Promise<void> => {
    setTesting(true)
    setTestResult(null)
    setError(null)
    try {
      const trimmed = enginePath.trim()
      if (trimmed) await window.api.engine.setPath(trimmed)
      setTestResult(await window.api.engine.test())
    } catch {
      setError('引擎測試失敗，請確認檔案路徑與執行權限。')
    } finally {
      setTesting(false)
    }
  }

  const finish = async (): Promise<void> => {
    setFinishing(true)
    setError(null)
    try {
      const trimmed = enginePath.trim()
      if (trimmed) await window.api.engine.setPath(trimmed)
      const key = apiKey.trim()
      const keyResult = key ? await window.api.secret.set(key) : null
      if (keyResult) {
        const defaultModel =
          PROVIDER_DEFAULT_MODELS[keyResult.provider].find((model) => model.isDefault) ??
          PROVIDER_DEFAULT_MODELS[keyResult.provider][0]
        const next = {
          ...settings,
          aiProvider: keyResult.provider,
          aiModel: defaultModel.id
        }
        const saved = saveSettings(next)
        if (!saved.ok) {
          setError(saved.message ?? '設定儲存失敗。')
          return
        }
        onSettingsChange(next)
      }
      const marked = markSetupCompleted()
      if (!marked.ok) {
        setError(marked.message ?? '無法保存初始設定狀態。')
        return
      }
      onComplete()
    } catch {
      setError('無法安全儲存設定或 API Key；系統不會以明文保存金鑰。')
    } finally {
      setFinishing(false)
    }
  }

  return (
    <div className="setup-wizard">
      <div className="setup-card">
        <div className="setup-brand">
          <span className="brand-seal large" aria-hidden="true">象</span>
          <div>
            <span className="eyebrow">WELCOME TO XIANGLI</span>
            <h1>建立你的象棋分析工作台</h1>
            <p>連接本機引擎與 AI 教練，之後也能隨時在「設定」頁調整。</p>
          </div>
        </div>
        {error && <div className="error-text">⚠ {error}</div>}

        <section className="card">
          <div className="setup-step">
            <span>01</span>
            <div>
              <h3>引擎設定</h3>
              <p>選擇本機 Pikafish 或相容的 UCI／UCCI 引擎。</p>
            </div>
          </div>
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
          {testResult?.diagnostics && testResult.diagnostics.length > 0 && (
            <details className="raw-engine-analysis">
              <summary>查看測試原始輸出</summary>
              <pre>{testResult.diagnostics.join('\n')}</pre>
            </details>
          )}
        </section>

        <section className="card">
          <div className="setup-step">
            <span>02</span>
            <div>
              <h3>AI 解說設定</h3>
              <p>API Key 只會以作業系統加密後保存在這台電腦。</p>
            </div>
          </div>
          <div className="field">
            <label className="field-label">API Key</label>
            <input
              className="text-input"
              type="password"
              placeholder="貼上 Claude、Gemini 或 OpenAI API Key"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
            />
            <p className="muted small">
              系統會自動辨識 {PROVIDER_LABEL.anthropic}、{PROVIDER_LABEL.gemini} 或{' '}
              {PROVIDER_LABEL.openai}。金鑰以作業系統加密 (safeStorage) 儲存於本機。
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
