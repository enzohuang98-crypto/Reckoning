/**
 * 初始設定嚮導 (SetupWizard)
 *
 * 第一次啟動（引擎路徑與 API 金鑰皆未設定）時取代主介面顯示。
 * 兩個欄位皆可留空跳過；完成後寫入 setup_completed 旗標，之後不再顯示。
 * 金鑰一律走 window.api.secret（safeStorage），絕不寫入 localStorage。
 */

import { useState } from 'react'
import {
  AI_COMPATIBLE_PRESETS,
  ALL_PROVIDER_IDS,
  PROVIDER_DEFAULT_MODELS,
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
  const [apiKey, setApiKey] = useState('')
  const [aiProvider, setAiProvider] = useState<AIProviderId>(settings.aiProvider)
  const [aiModel, setAiModel] = useState(settings.aiModel)
  const [aiBaseUrl, setAiBaseUrl] = useState(settings.aiBaseUrl)
  const [finishing, setFinishing] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const browse = async (): Promise<void> => {
    try {
      const picked = await window.api.engine.browsePath()
      if (!picked) return
      setEnginePath(picked)
      setTestResult(null)
      setError(null)
    } catch {
      setError('無法開啟檔案選擇器；請直接輸入引擎 EXE 的完整路徑。')
    }
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
      const credential = {
        provider: aiProvider,
        model: aiModel,
        ...(aiProvider === 'openai-compatible'
          ? { baseUrl: aiBaseUrl }
          : {})
      }
      const keyResult = key
        ? await window.api.secret.set({ ...credential, apiKey: key })
        : null
      const selectedCredential =
        keyResult?.status.activeCredential ?? credential
      const next = {
        ...settings,
        aiProvider: selectedCredential.provider,
        aiModel: selectedCredential.model,
        aiBaseUrl:
          selectedCredential.provider === 'openai-compatible'
            ? selectedCredential.baseUrl ?? ''
            : ''
      }
      const saved = saveSettings(next)
      if (!saved.ok) {
        setError(saved.message ?? '設定儲存失敗。')
        return
      }
      onSettingsChange(next)
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
            <label className="field-label">AI Provider</label>
            <select
              aria-label="初始設定 API Provider"
              className="select"
              value={aiProvider}
              onChange={(event) => {
                const provider = event.target.value as AIProviderId
                const models = PROVIDER_DEFAULT_MODELS[provider]
                const selected = models.find((model) => model.isDefault) ?? models[0]
                setAiProvider(provider)
                setAiModel(selected.id)
                setAiBaseUrl(
                  provider === 'openai-compatible'
                    ? AI_COMPATIBLE_PRESETS.find((preset) => preset.id === 'ollama')
                        ?.baseUrl ?? ''
                    : ''
                )
              }}
            >
              {ALL_PROVIDER_IDS.map((provider) => (
                <option key={provider} value={provider}>
                  {PROVIDER_LABEL[provider]}
                </option>
              ))}
            </select>
          </div>

          {aiProvider === 'openai-compatible' ? (
            <>
              <div className="field">
                <label className="field-label">Base URL</label>
                <input
                  className="text-input"
                  value={aiBaseUrl}
                  onChange={(event) => setAiBaseUrl(event.target.value)}
                />
              </div>
              <div className="field">
                <label className="field-label">模型 ID</label>
                <input
                  className="text-input"
                  value={aiModel}
                  onChange={(event) => setAiModel(event.target.value)}
                />
              </div>
            </>
          ) : (
            <div className="field">
              <label className="field-label">金鑰要綁定的模型</label>
              <select
                aria-label="初始設定 API 模型"
                className="select"
                value={aiModel}
                onChange={(event) => setAiModel(event.target.value)}
              >
                {PROVIDER_DEFAULT_MODELS[aiProvider].map((model) => (
                  <option key={model.id} value={model.id}>
                    {model.label}{model.isDefault ? '（預設）' : ''}
                  </option>
                ))}
              </select>
            </div>
          )}
          <div className="field">
            <label className="field-label">API Key</label>
            <input
              className="text-input"
              type="password"
              placeholder={`貼上 ${PROVIDER_LABEL[aiProvider]} · ${aiModel} API Key`}
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
            />
            <p className="muted small">
              金鑰只會綁定到上方選定的 Provider 與模型，並以作業系統加密
              (safeStorage) 儲存於本機；不會自動套用到其他模型。
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
