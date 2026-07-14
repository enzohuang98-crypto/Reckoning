import {
  AI_COMPATIBLE_PRESETS,
  ALL_PROVIDER_IDS,
  PROVIDER_DEFAULT_MODELS,
  PROVIDER_LABEL,
  type AIProviderId
} from '@shared/types/AIProviderTypes'
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
  onSaveKey: () => void
  onDeleteKey: () => void
}

export function AiSettingsSection({
  settings,
  update,
  apiKey,
  onApiKeyChange,
  secretStatus,
  encryptionAvailable,
  onSaveKey,
  onDeleteKey
}: Props): JSX.Element {
  const localCompatibleWithoutKey =
    settings.aiProvider === 'openai-compatible' &&
    /^http:\/\/(?:localhost|127\.0\.0\.1|\[::1\])(?::\d+)?(?:\/|$)/i.test(
      settings.aiBaseUrl
    )
  const compatiblePreset =
    AI_COMPATIBLE_PRESETS.find(
      (preset) => preset.baseUrl && preset.baseUrl === settings.aiBaseUrl
    )?.id ?? 'custom'
  const changeProvider = (provider: AIProviderId): void => {
    const defaultModel =
      PROVIDER_DEFAULT_MODELS[provider].find((model) => model.isDefault) ??
      PROVIDER_DEFAULT_MODELS[provider][0]
    update({
      aiProvider: provider,
      aiModel: defaultModel.id,
      aiBaseUrl:
        provider === 'openai-compatible'
          ? AI_COMPATIBLE_PRESETS.find((preset) => preset.id === 'ollama')
              ?.baseUrl ?? ''
          : ''
    })
  }

  const changeCompatiblePreset = (id: string): void => {
    const preset = AI_COMPATIBLE_PRESETS.find((item) => item.id === id)
    if (!preset) return
    update({ aiBaseUrl: preset.baseUrl, aiModel: preset.suggestedModel })
  }

  const deleteApiKey = (): void => {
    if (!window.confirm('確定要刪除本機保存的 AI API Key 嗎？刪除後需要重新輸入才能使用對應服務。')) return
    onDeleteKey()
  }

  return (
    <div className="settings-section-grid">
      <section className="card settings-feature-card">
        <div className="section-heading">
          <div>
            <span className="eyebrow">SECURE ACCESS</span>
            <h3>AI API Key</h3>
          </div>
          <span
            className={`badge ${
              secretStatus.configured || localCompatibleWithoutKey
                ? 'on'
                : secretStatus.needsReentry
                  ? 'warn'
                  : 'off'
            }`}
          >
            {localCompatibleWithoutKey && !secretStatus.configured
              ? '本機免金鑰'
              : secretStatus.configured
              ? '已設定'
              : secretStatus.needsReentry
                ? '需重新輸入'
                : '未設定'}
          </span>
        </div>

        {encryptionAvailable === false && (
          <div className="error-text">
            此系統不支援安全加密儲存，程式會拒絕以明文保存金鑰。
          </div>
        )}

        <p className="muted">
          同一欄位支援 Claude、Gemini、OpenAI 與 OpenAI 相容服務。先選服務後貼上金鑰；
          金鑰只透過作業系統 safeStorage 加密保存在本機。AI 用量由所選服務商另外計費，
          本軟體不包含 API 額度。
        </p>

        <div className="key-row">
          <div className="key-head">
            <b>
              {secretStatus.provider
                ? `目前使用 ${PROVIDER_LABEL[secretStatus.provider]}`
                : '尚未設定 AI Provider'}
            </b>
          </div>

          {secretStatus.needsReentry && (
            <div className="error-text">
              先前保存的金鑰已無法解密。金鑰沒有被顯示或外洩，但需要重新貼上一次。
            </div>
          )}

          {localCompatibleWithoutKey && !secretStatus.configured && (
            <div className="engine-status ok">
              本機 loopback 端點可直接使用；若你的本機服務有啟用 Token，再於同一欄位輸入。
            </div>
          )}

          <div className="settings-key-input">
            <input
              className="text-input"
              type="password"
              placeholder={
                settings.aiProvider === 'openai-compatible'
                  ? '貼上服務金鑰；本機 Ollama / LM Studio 可留空'
                  : '貼上目前服務的 API Key'
              }
              value={apiKey}
              onChange={(event) => onApiKeyChange(event.target.value)}
            />
            <button className="btn" onClick={onSaveKey} disabled={!apiKey.trim()}>
              儲存金鑰
            </button>
            {(secretStatus.configured || secretStatus.needsReentry) && (
              <button className="btn danger" onClick={deleteApiKey}>刪除</button>
            )}
          </div>
        </div>
      </section>

      <section className="card">
        <div className="section-heading">
          <div>
            <span className="eyebrow">COACH PROFILE</span>
            <h3>模型與解說</h3>
          </div>
        </div>

        <div className="field">
          <label className="field-label">使用中的 Provider</label>
          <select
            className="select"
            value={settings.aiProvider}
            onChange={(event) =>
              changeProvider(event.target.value as AIProviderId)
            }
          >
            {ALL_PROVIDER_IDS.map((provider) => (
              <option value={provider} key={provider}>
                {PROVIDER_LABEL[provider]}
              </option>
            ))}
          </select>
        </div>

        {settings.aiProvider === 'openai-compatible' ? (
          <>
            <div className="field">
              <label className="field-label">相容服務</label>
              <select
                className="select"
                value={compatiblePreset}
                onChange={(event) => changeCompatiblePreset(event.target.value)}
              >
                {AI_COMPATIBLE_PRESETS.map((preset) => (
                  <option value={preset.id} key={preset.id}>
                    {preset.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label className="field-label">Base URL</label>
              <input
                className="text-input"
                value={settings.aiBaseUrl}
                placeholder="https://服務網址/v1 或 http://127.0.0.1:連接埠/v1"
                onChange={(event) => update({ aiBaseUrl: event.target.value })}
              />
              <small className="muted">
                遠端只允許 HTTPS；HTTP 僅允許 localhost，避免把資料送到不安全端點。
                使用自訂遠端端點時，API Key、棋局證據與提示內容會傳送至該服務，請只填入你信任的網址。
              </small>
            </div>
            <div className="field">
              <label className="field-label">模型 ID</label>
              <input
                className="text-input"
                value={settings.aiModel}
                placeholder="例如 deepseek-v4-flash、grok-4.5 或本機模型名稱"
                onChange={(event) => update({ aiModel: event.target.value })}
              />
            </div>
          </>
        ) : (
          <div className="field">
            <label className="field-label">模型</label>
            <select
              className="select"
              value={settings.aiModel}
              onChange={(event) => update({ aiModel: event.target.value })}
            >
              {PROVIDER_DEFAULT_MODELS[settings.aiProvider].map((model) => (
                <option key={model.id} value={model.id}>
                  {model.label}{model.isDefault ? '（預設）' : ''}
                </option>
              ))}
            </select>
          </div>
        )}

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
            <option value="zh-CN">简体中文</option>
            <option value="en">English</option>
          </select>
        </div>
      </section>
    </div>
  )
}
