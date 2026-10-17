import { useState } from 'react'
import {
  PROVIDER_LABEL,
  type AIModelInfo
} from '@shared/types/AIProviderTypes'
import type { AppSettings } from '@shared/types/Settings'
import type { SecretStatus } from '@shared/types/ipc'
import {
  AiConnectionStatus,
  type AiConnectionStage
} from './AiConnectionStatus'
import type { SettingsUpdater } from './types'

interface Props {
  settings: AppSettings
  update: SettingsUpdater
  apiKey: string
  onApiKeyChange: (value: string) => void
  secretStatus: SecretStatus
  encryptionAvailable: boolean | null
  secretBusy: boolean
  openRouterModels: AIModelInfo[]
  selectedOpenRouterModel: string
  onOpenRouterModelChange: (model: string) => void
  onConnectKey: () => void
  onRefreshOpenRouterModels?: () => void
  onLoadSavedOpenRouterModels?: () => void
  onSwitchSavedOpenRouterModel?: () => void
  savedModelsLoaded?: boolean
  savedModelsError?: string | null
  onDeleteKey: () => void
  connectionStage?: AiConnectionStage
  /** 已保存的 OpenRouter 備援模型（最多 2 個）。 */
  backupModels?: string[]
  onBackupModelsChange?: (models: string[]) => void
  onSaveBackupModels?: () => void
}

export function AiSettingsSection({
  settings,
  update,
  apiKey,
  onApiKeyChange,
  secretStatus,
  encryptionAvailable,
  secretBusy,
  openRouterModels,
  selectedOpenRouterModel,
  onOpenRouterModelChange,
  onConnectKey,
  onRefreshOpenRouterModels,
  onLoadSavedOpenRouterModels,
  onSwitchSavedOpenRouterModel,
  savedModelsLoaded = false,
  savedModelsError = null,
  onDeleteKey,
  connectionStage = 'idle',
  backupModels = [],
  onBackupModelsChange,
  onSaveBackupModels
}: Props): JSX.Element {
  const [deleteConfirmation, setDeleteConfirmation] = useState(false)
  const active = secretStatus.activeCredential
  const savedOpenRouterActive = active?.provider === 'openrouter'
  // 清單尚未讀取時無從比對，不能把「還沒讀」說成「已不在清單」。
  const selectedModelUnavailable =
    openRouterModels.length > 0 &&
    selectedOpenRouterModel !== '' &&
    !openRouterModels.some((model) => model.id === selectedOpenRouterModel)

  return (
    <div className="settings-section-grid">
      <section className="card settings-feature-card">
        <div className="section-heading">
          <div>
            <span className="eyebrow">SECURE AI CONNECTION</span>
            <h3>AI API 金鑰</h3>
          </div>
          <span className={`badge ${secretStatus.configured ? 'on' : 'off'}`}>
            {secretStatus.configured ? '已連線' : '未設定'}
          </span>
        </div>

        <p className="muted">
          直接貼上 OpenAI、Anthropic Claude、Google Gemini 或 OpenRouter 的官方 API Key。
          程式會自動辨識服務、讀取這把金鑰實際可用的模型，並以真實生成驗證；成功後才加密儲存。
        </p>

        <AiConnectionStatus
          stage={connectionStage}
          configured={secretStatus.configured}
        />

        {encryptionAvailable === false && (
          <div className="error-text">
            此系統不支援安全加密儲存，程式會拒絕以明文保存金鑰。
          </div>
        )}

        <div className="settings-key-input">
          <input
            aria-label="AI API Key"
            className="text-input"
            type="password"
            autoComplete="off"
            spellCheck={false}
            placeholder="貼上 API Key"
            value={apiKey}
            disabled={secretBusy || encryptionAvailable === false}
            onChange={(event) => onApiKeyChange(event.target.value)}
            onKeyDown={(event) => {
              if (
                event.key === 'Enter' &&
                apiKey.trim() &&
                !secretBusy &&
                !selectedModelUnavailable
              ) {
                onConnectKey()
              }
            }}
          />
          <button
            className="btn"
            onClick={onConnectKey}
            disabled={
              !apiKey.trim() ||
              secretBusy ||
              encryptionAvailable === false ||
              selectedModelUnavailable
            }
          >
            {secretBusy
              ? '辨識、驗證與連線中…'
              : openRouterModels.length > 0
                ? '驗證並使用此模型'
                : '自動連線'}
          </button>
        </div>

        {(savedOpenRouterActive || openRouterModels.length > 0) && (
          <div className="field">
            <label className="field-label" htmlFor="openrouter-free-model">
              OpenRouter 免費模型
            </label>
            {openRouterModels.length > 0 ? (
              <select
                id="openrouter-free-model"
                aria-label="OpenRouter 免費模型"
                className="select"
                value={selectedOpenRouterModel}
                disabled={secretBusy}
                onChange={(event) => onOpenRouterModelChange(event.target.value)}
              >
                {selectedModelUnavailable && (
                  <option value={selectedOpenRouterModel} disabled>
                    {selectedOpenRouterModel} · 已不可用，請重新選擇
                  </option>
                )}
                {openRouterModels.map((model) => (
                  <option key={model.id} value={model.id}>
                    {model.label} · {model.id}
                  </option>
                ))}
              </select>
            ) : (
              <p className="muted small" role="status">
                {savedModelsError
                  ? `模型清單讀取失敗：${savedModelsError}`
                  : savedModelsLoaded
                    ? '目前沒有可用的具名免費文字模型。'
                    : '尚未讀取候選模型；已存金鑰不需要重新輸入。'}
              </p>
            )}
            <p className="muted small">
              清單來自 OpenRouter 官方即時目錄；列出具名的 :free 模型，另加經過實戰驗收的付費模型（標示「付費」，費用記在你的 OpenRouter 帳戶）；不使用會隨機換模型的自動路由。
            </p>
            {selectedModelUnavailable && (
              <p className="error-text">
                目前選擇的模型已不在最新清單，請重新選擇模型。
              </p>
            )}
            {savedOpenRouterActive && !apiKey.trim() && onSwitchSavedOpenRouterModel && (
              <button
                className="btn small"
                aria-label="使用已存金鑰切換模型"
                disabled={secretBusy || openRouterModels.length === 0 || selectedModelUnavailable}
                onClick={onSwitchSavedOpenRouterModel}
              >
                使用此模型
              </button>
            )}
            {savedOpenRouterActive &&
              !apiKey.trim() &&
              openRouterModels.length > 0 &&
              onBackupModelsChange &&
              onSaveBackupModels && (
                <div className="field openrouter-backup-models">
                  <span className="field-label">備援模型（最多 2 個）</span>
                  <p className="muted small">
                    主模型暫時故障或限流時，會改用這裡選的免費模型，並在回答旁標示「本次由哪個模型回答」。
                    每日免費額度用完時不會改用備援。
                  </p>
                  {[0, 1].map((index) => (
                    <select
                      key={index}
                      aria-label={`備援模型 ${index + 1}`}
                      className="select"
                      value={backupModels[index] ?? ''}
                      disabled={secretBusy || (index === 1 && !backupModels[0])}
                      onChange={(event) => {
                        const next = [...backupModels]
                        next[index] = event.target.value
                        onBackupModelsChange(
                          next.filter((model, position) =>
                            Boolean(model) && next.indexOf(model) === position
                          )
                        )
                      }}
                    >
                      <option value="">不使用</option>
                      {openRouterModels
                        .filter((model) => model.id !== active?.model)
                        .map((model) => (
                          <option key={model.id} value={model.id}>
                            {model.label} · {model.id}
                          </option>
                        ))}
                    </select>
                  ))}
                  <button
                    className="btn ghost small"
                    disabled={secretBusy}
                    onClick={onSaveBackupModels}
                  >
                    儲存備援模型
                  </button>
                </div>
              )}
            {savedOpenRouterActive && !apiKey.trim() && onLoadSavedOpenRouterModels ? (
              <button
                className="btn ghost small"
                disabled={secretBusy}
                onClick={onLoadSavedOpenRouterModels}
              >
                {openRouterModels.length > 0 ? '重新讀取免費模型' : '讀取模型'}
              </button>
            ) : onRefreshOpenRouterModels && openRouterModels.length > 0 ? (
              <button
                className="btn ghost small"
                disabled={secretBusy}
                onClick={onRefreshOpenRouterModels}
              >
                重新讀取免費模型
              </button>
            ) : null}
          </div>
        )}

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
                {deleteConfirmation ? '再次按下確認刪除' : '刪除金鑰'}
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
            <h3>解說偏好</h3>
          </div>
        </div>

        <div className="field">
          <label className="field-label">你的棋力（影響解說深淺）</label>
          <select
            className="select"
            value={settings.userLevel}
            onChange={(event) =>
              update({ userLevel: event.target.value as AppSettings['userLevel'] })
            }
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
            onChange={(event) =>
              update({ language: event.target.value as AppSettings['language'] })
            }
          >
            <option value="zh-TW">繁體中文</option>
            <option value="zh-CN">簡體中文</option>
            <option value="en">English</option>
          </select>
        </div>
      </section>
    </div>
  )
}
