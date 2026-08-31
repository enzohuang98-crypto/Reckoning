/**
 * 初始設定嚮導 (SetupWizard)
 *
 * 第一次啟動（引擎路徑與 API 金鑰皆未設定）時取代主介面顯示。
 * 兩個欄位皆可留空跳過；完成後寫入 setup_completed 旗標，之後不再顯示。
 * 金鑰一律走 window.api.secret（safeStorage），絕不寫入 localStorage。
 */

import { useState } from 'react'
import type { AIModelInfo } from '@shared/types/AIProviderTypes'
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
  const [engineSelectionToken, setEngineSelectionToken] =
    useState<string | null>(null)
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<EngineTestResult | null>(null)
  const [apiKey, setApiKey] = useState('')
  const [openRouterModels, setOpenRouterModels] = useState<AIModelInfo[]>([])
  const [selectedOpenRouterModel, setSelectedOpenRouterModel] = useState('')
  const [finishing, setFinishing] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const browse = async (): Promise<void> => {
    try {
      const picked = await window.api.engine.browsePath()
      if (!picked) return
      setEnginePath(picked.displayPath)
      setEngineSelectionToken(picked.token)
      setTestResult(null)
      setError(null)
    } catch {
      setError('無法開啟檔案選擇器，請稍後重試。')
    }
  }

  const runTest = async (): Promise<void> => {
    setTesting(true)
    setTestResult(null)
    setError(null)
    try {
      if (engineSelectionToken) {
        await window.api.engine.setPath(engineSelectionToken)
        setEngineSelectionToken(null)
      }
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
      if (engineSelectionToken) {
        await window.api.engine.setPath(engineSelectionToken)
        setEngineSelectionToken(null)
      }
      const key = apiKey.trim()
      const keyResult = key
        ? await window.api.ai.autoConfigureCredential(
            key,
            selectedOpenRouterModel || undefined
          )
        : null
      if (keyResult && !keyResult.ok) {
        if (selectedOpenRouterModel) {
          setOpenRouterModels([])
          setSelectedOpenRouterModel('')
        }
        setError(keyResult.message)
        return
      }
      if (keyResult?.ok && !keyResult.configured) {
        setOpenRouterModels(keyResult.models)
        setSelectedOpenRouterModel((current) =>
          keyResult.models.some((model) => model.id === current)
            ? current
            : keyResult.models[0]?.id ?? ''
        )
        setError(null)
        return
      }
      const selectedCredential = keyResult?.ok && keyResult.configured
        ? keyResult.credential
        : undefined
      const next = {
        ...settings,
        aiProvider: selectedCredential?.provider ?? settings.aiProvider,
        aiModel: selectedCredential?.model ?? settings.aiModel,
        aiBaseUrl: selectedCredential ? '' : settings.aiBaseUrl
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
            <span className="eyebrow">WELCOME TO XIANGQI AI ANALYZER</span>
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
                placeholder="留白使用安裝版內建 Pikafish，或選擇其他引擎 EXE"
                value={enginePath}
                readOnly
              />
              <button className="btn ghost" onClick={browse}>
                瀏覽…
              </button>
            </div>
            <p className="muted small">
              安裝版已內附 Pikafish；路徑留白即可直接按「測試引擎」。
              若要改用其他引擎，再選擇本機 EXE。<br />
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
              placeholder="贴上 OpenAI、Anthropic、Gemini 或 OpenRouter 官方 API Key"
              value={apiKey}
              onChange={(event) => {
                setApiKey(event.target.value)
                setOpenRouterModels([])
                setSelectedOpenRouterModel('')
              }}
            />
            <p className="muted small">
              程式会自动辨识官方服务、读取实际可用模型并完成一次真实生成验证；
              成功后才以作业系统加密 (safeStorage) 储存于本机。
            </p>
          </div>
          {openRouterModels.length > 0 && (
            <div className="field">
              <label className="field-label" htmlFor="setup-openrouter-free-model">
                OpenRouter 免费模型
              </label>
              <select
                id="setup-openrouter-free-model"
                aria-label="OpenRouter 免费模型"
                className="select"
                value={selectedOpenRouterModel}
                onChange={(event) => setSelectedOpenRouterModel(event.target.value)}
              >
                {openRouterModels.map((model) => (
                  <option key={model.id} value={model.id}>
                    {model.label} · {model.id}
                  </option>
                ))}
              </select>
              <p className="muted small">
                请选择具名 :free 模型；程式不会使用随机免费路由替换你的选择。
              </p>
            </div>
          )}
        </section>

        <div className="setup-actions">
          <button className="btn" onClick={finish} disabled={finishing}>
            {openRouterModels.length > 0 ? '验证模型并完成設定 →' : '完成設定 →'}
          </button>
        </div>
      </div>
    </div>
  )
}
