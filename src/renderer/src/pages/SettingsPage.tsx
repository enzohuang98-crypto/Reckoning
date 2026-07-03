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
  PROVIDER_LABEL
} from '@shared/types/AIProviderTypes'
import type { AppSettings } from '@shared/types/Settings'
import type {
  EngineTestResult,
  SecretStatus
} from '@shared/types/ipc'
import type { LicenseStatus } from '@shared/types/License'
import {
  ENGINE_PROFILES,
  type EngineProfileId,
  type EngineRegistrySnapshot
} from '@shared/types/EngineRegistry'
import { saveSettings } from '../storage/localSettings'
import type { AppDataSnapshot } from '@shared/types/AppData'
import type { AppUpdateStatus } from '@shared/types/AppUpdate'

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
  const [apiKey, setApiKey] = useState('')
  const [secretStatus, setSecretStatus] = useState<SecretStatus>({
    configured: false,
    provider: null,
    needsReentry: false
  })
  const [encAvailable, setEncAvailable] = useState<boolean | null>(null)
  const [savedMsg, setSavedMsg] = useState<string | null>(null)
  const [operationError, setOperationError] = useState<string | null>(null)

  // 引擎路徑（存於 main 的 StorageService，非 localStorage）
  const [engineTest, setEngineTest] = useState<EngineTestResult | null>(null)
  const [engineMsg, setEngineMsg] = useState<string | null>(null)
  const [engineRegistry, setEngineRegistry] = useState<EngineRegistrySnapshot>({
    installations: [],
    activeEngineId: null,
    verificationEngineId: null
  })
  const [newEngineProfile, setNewEngineProfile] =
    useState<EngineProfileId>('pikafish')
  const [newEngineName, setNewEngineName] = useState('')
  const [newEnginePath, setNewEnginePath] = useState('')
  const [testingEngineId, setTestingEngineId] = useState<string | null>(null)
  const [traceCount, setTraceCount] = useState(0)
  const [updateStatus, setUpdateStatus] = useState<AppUpdateStatus | null>(null)
  const [updateBusy, setUpdateBusy] = useState(false)

  const refreshEngine = async (): Promise<void> => {
    const registry = await window.api.engine.listInstallations()
    setEngineRegistry(registry)
  }

  const browseNewEngine = async (): Promise<void> => {
    const picked = await window.api.engine.browsePath()
    if (picked) setNewEnginePath(picked)
  }

  const addEngine = async (): Promise<void> => {
    if (!newEnginePath.trim()) {
      setEngineMsg('請先選擇本機引擎 EXE。')
      return
    }
    try {
      const installation = await window.api.engine.addInstallation({
        profileId: newEngineProfile,
        displayName: newEngineName.trim() || undefined,
        executablePath: newEnginePath.trim()
      })
      setNewEngineName('')
      setNewEnginePath('')
      setEngineMsg(`已加入 ${installation.displayName}，實際通過搜尋測試後才會標示已驗證。`)
      await refreshEngine()
    } catch {
      setEngineMsg('無法加入引擎，請確認是本機磁碟上的 EXE 絕對路徑。')
    }
  }

  const refreshKeyStatus = async (): Promise<void> => {
    setSecretStatus(await window.api.secret.status())
  }

  // 買斷授權狀態（SDS Q5）
  const [license, setLicense] = useState<LicenseStatus | null>(null)

  useEffect(() => {
    const unsubscribeUpdate = window.api.update.onChanged(setUpdateStatus)
    window.api.secret.isAvailable().then(setEncAvailable).catch(() => setEncAvailable(false))
    void refreshKeyStatus().catch(() => setOperationError('無法查詢 API Key 狀態。'))
    void refreshEngine().catch(() => setOperationError('無法查詢引擎狀態。'))
    window.api.license.status().then(setLicense).catch(() => setLicense(null))
    window.api.update.status().then(setUpdateStatus).catch(() => setUpdateStatus(null))
    window.api.ai
      .listHarnessTraces()
      .then((traces) => setTraceCount(traces.length))
      .catch(() => setTraceCount(0))
    return unsubscribeUpdate
  }, [])

  const deactivateLicense = async (): Promise<void> => {
    const status = await window.api.license.deactivate()
    setLicense(status)
    // 解除後主介面會在下次啟動時要求重新輸入 License Key
  }

  const runUpdateAction = async (
    action: () => Promise<AppUpdateStatus>
  ): Promise<void> => {
    setUpdateBusy(true)
    try {
      setUpdateStatus(await action())
    } catch {
      setOperationError('更新操作失敗，請稍後再試。')
    } finally {
      setUpdateBusy(false)
    }
  }

  const update = (patch: Partial<AppSettings>): void => {
    const next = { ...settings, ...patch }
    onSettingsChange(next)
    const saved = saveSettings(next)
    if (!saved.ok) setOperationError(saved.message ?? '設定儲存失敗。')
    else setOperationError(null)
  }

  const saveKey = async (): Promise<void> => {
    const key = apiKey.trim()
    if (!key) return
    try {
      const result = await window.api.secret.set(key)
      const defaultModel =
        PROVIDER_DEFAULT_MODELS[result.provider].find((model) => model.isDefault) ??
        PROVIDER_DEFAULT_MODELS[result.provider][0]
      update({ aiProvider: result.provider, aiModel: defaultModel.id })
      setApiKey('')
      setSecretStatus({ configured: true, provider: result.provider, needsReentry: false })
      setSavedMsg(`${PROVIDER_LABEL[result.provider]} 金鑰已安全儲存並設為使用中。`)
      setOperationError(null)
    } catch {
      setOperationError(
        '無法辨識或安全儲存 API Key。支援 Claude（sk-ant-）、Gemini（AIza）與 OpenAI（sk-）。'
      )
    }
  }

  const deleteKey = async (): Promise<void> => {
    try {
      await window.api.secret.delete()
      setSecretStatus({ configured: false, provider: null, needsReentry: false })
      setSavedMsg('API Key 已刪除。')
      setOperationError(null)
    } catch {
      setOperationError('API Key 刪除失敗，請稍後重試。')
    }
  }

  const testEngine = async (id?: string): Promise<void> => {
    setTestingEngineId(id ?? null)
    setEngineTest(null)
    try {
      const result = id
        ? await window.api.engine.testInstallation(id)
        : await window.api.engine.test()
      setEngineTest(result)
      if (result.ok) {
        await refreshEngine()
      }
    } catch {
      setEngineTest({ ok: false, message: '引擎測試失敗，請確認路徑與執行權限。' })
    } finally {
      setTestingEngineId(null)
    }
  }

  const selectEngines = async (
    activeEngineId: string,
    verificationEngineId: string | null = engineRegistry.verificationEngineId
  ): Promise<void> => {
    try {
      const next = await window.api.engine.selectInstallation(
        activeEngineId,
        verificationEngineId === activeEngineId ? null : verificationEngineId
      )
      setEngineRegistry(next)
    } catch {
      setEngineMsg('主引擎與複核引擎必須是不同的已加入引擎。')
    }
  }

  const clearHarnessTraces = async (): Promise<void> => {
    await window.api.ai.clearHarnessTraces()
    setTraceCount(0)
    setSavedMsg('Harness 診斷紀錄已清除。')
  }

  const exportHarnessTraces = async (): Promise<void> => {
    const result = await window.api.ai.exportHarnessTraces()
    if (result.ok) setSavedMsg(`Harness 診斷紀錄已匯出：${result.filePath}`)
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
        <h3>AI API Key</h3>
        {encAvailable === false && (
          <div className="error-text">
            ⚠ 此系統不支援安全加密儲存，將拒絕保存金鑰以保護安全。
          </div>
        )}
        <p className="muted">
          同一欄位支援 Claude、Gemini 與 OpenAI；系統會依金鑰前綴自動辨識並切換
          Provider。金鑰以作業系統加密 (safeStorage) 儲存於本機。
        </p>
        <div className="key-row">
          <div className="key-head">
            <b>
              {secretStatus.provider
                ? `目前：${PROVIDER_LABEL[secretStatus.provider]}`
                : '尚未設定'}
            </b>
            <span
              className={`badge ${
                secretStatus.configured ? 'on' : secretStatus.needsReentry ? 'warn' : 'off'
              }`}
            >
              {secretStatus.configured
                ? '已設定'
                : secretStatus.needsReentry
                  ? '需重新輸入'
                  : '未設定'}
            </span>
          </div>
          {secretStatus.needsReentry && (
            <div className="error-text">
              ⚠ 偵測到先前保存的 API 金鑰已無法解密（通常是系統或設定檔變動造成）。
              金鑰本身沒有外洩，但需要重新貼上一次才能繼續使用 AI 解說。
            </div>
          )}
          <div className="row gap">
            <input
              className="text-input"
              type="password"
              placeholder="貼上 Claude、Gemini 或 OpenAI API Key"
              value={apiKey}
              onChange={(event) => setApiKey(event.target.value)}
            />
            <button className="btn" onClick={() => void saveKey()}>
              儲存
            </button>
            {(secretStatus.configured || secretStatus.needsReentry) && (
              <button className="btn danger" onClick={() => void deleteKey()}>
                刪除
              </button>
            )}
          </div>
        </div>
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
          <div className="engine-status ok">
            {PROVIDER_LABEL[settings.aiProvider]}（由 API Key 自動選擇）
          </div>
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
        <h3>本機象棋引擎</h3>
        <p className="muted">
          軟體不附帶第三方引擎。請加入你合法取得的 UCI／UCCI
          引擎；只有實際完成握手與短搜尋的項目才標示「已驗證」。
        </p>
        <div className="engine-install-list">
          {engineRegistry.installations.length === 0 && (
            <div className="engine-status warn">尚未加入任何引擎。</div>
          )}
          {engineRegistry.installations.map((engine) => (
            <div className="engine-install-item" key={engine.id}>
              <div>
                <b>{engine.detectedName ?? engine.displayName}</b>
                <span className={`badge ${engine.verified ? 'on' : 'off'}`}>
                  {engine.verified ? '已驗證' : '未驗證'}
                </span>
                <div className="muted small">
                  {engine.protocol?.toUpperCase() ?? '自動偵測'} ·{' '}
                  {ENGINE_PROFILES.find((profile) => profile.id === engine.profileId)
                    ?.label ?? '自訂引擎'}
                </div>
                <div className="mono muted small">{engine.executablePath}</div>
                {engine.lastError && (
                  <div className="error-text small">{engine.lastError}</div>
                )}
              </div>
              <div className="row gap">
                <button
                  className="btn ghost"
                  disabled={testingEngineId === engine.id}
                  onClick={() => void testEngine(engine.id)}
                >
                  {testingEngineId === engine.id ? '測試中…' : '連線與搜尋測試'}
                </button>
                <button
                  className="btn danger"
                  onClick={async () => {
                    setEngineRegistry(
                      await window.api.engine.removeInstallation(engine.id)
                    )
                  }}
                >
                  移除
                </button>
              </div>
            </div>
          ))}
        </div>

        {engineRegistry.installations.length > 0 && (
          <div className="engine-selection-grid">
            <div className="field">
              <label className="field-label">預設主引擎</label>
              <select
                className="select"
                value={engineRegistry.activeEngineId ?? ''}
                onChange={(event) => void selectEngines(event.target.value)}
              >
                {engineRegistry.installations.map((engine) => (
                  <option value={engine.id} key={engine.id}>
                    {engine.displayName}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label className="field-label">預設複核引擎（可不選）</label>
              <select
                className="select"
                value={engineRegistry.verificationEngineId ?? ''}
                onChange={(event) =>
                  void selectEngines(
                    engineRegistry.activeEngineId ?? '',
                    event.target.value || null
                  )
                }
              >
                <option value="">不使用複核引擎</option>
                {engineRegistry.installations
                  .filter((engine) => engine.id !== engineRegistry.activeEngineId)
                  .map((engine) => (
                    <option value={engine.id} key={engine.id}>
                      {engine.displayName}
                    </option>
                  ))}
              </select>
            </div>
          </div>
        )}

        <div className="engine-add-box">
          <div className="field">
            <label className="field-label">新增引擎類型</label>
            <select
              className="select"
              value={newEngineProfile}
              onChange={(event) =>
                setNewEngineProfile(event.target.value as EngineProfileId)
              }
            >
              {ENGINE_PROFILES.map((profile) => (
                <option key={profile.id} value={profile.id}>
                  {profile.label}
                </option>
              ))}
            </select>
            <div className="muted small">
              {
                ENGINE_PROFILES.find((profile) => profile.id === newEngineProfile)
                  ?.description
              }
            </div>
          </div>
          <div className="field">
            <label className="field-label">顯示名稱（可留空）</label>
            <input
              className="text-input"
              value={newEngineName}
              onChange={(event) => setNewEngineName(event.target.value)}
              placeholder="例如：我的旋風引擎"
            />
          </div>
        </div>
        <div className="field">
          <label className="field-label">引擎 EXE</label>
          <div className="row gap">
            <input
              className="text-input"
              type="text"
              placeholder="例如 C:\\Engines\\engine.exe"
              value={newEnginePath}
              onChange={(event) => setNewEnginePath(event.target.value)}
            />
            <button className="btn ghost" onClick={() => void browseNewEngine()}>
              瀏覽…
            </button>
          </div>
        </div>
        <div className="row gap">
          <button className="btn" onClick={() => void addEngine()}>加入引擎</button>
          <button className="btn ghost" onClick={() => void refreshEngine()}>
            重新整理
          </button>
        </div>
        {engineMsg && (
          <div className="muted" style={{ marginTop: 8 }}>{engineMsg}</div>
        )}
        {engineTest && (
          <div className={engineTest.ok ? 'success-text' : 'error-text'}>
            {engineTest.ok
              ? `✓ 搜尋成功：${engineTest.engineName ?? '象棋引擎'}${
                  engineTest.protocol ? `（${engineTest.protocol.toUpperCase()}）` : ''
                }`
              : `⚠ ${engineTest.message ?? '引擎測試失敗。'}`}
          </div>
        )}
        {engineTest?.diagnostics && engineTest.diagnostics.length > 0 && (
          <details className="raw-engine-analysis">
            <summary>查看測試原始輸出</summary>
            <pre>{engineTest.diagnostics.join('\n')}</pre>
          </details>
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
        <h3>AI 解說 Harness</h3>
        <p className="muted">
          Harness 會持續加深最佳著法與你的著法，直到驗證至少兩項具體後果。
          超過 20 秒後每 5 秒更新進度；連續 60 秒沒有新深度或變例時，會讓你選擇繼續或取消。
        </p>
        <div className="field">
          <label className="field-label">預設回答模式</label>
          <select
            className="select"
            value={settings.harnessAnswerMode}
            onChange={(event) =>
              update({
                harnessAnswerMode: event.target
                  .value as AppSettings['harnessAnswerMode']
              })
            }
          >
            <option value="research">完整研究</option>
            <option value="focused">聚焦回答</option>
          </select>
        </div>
        <label className="check-row">
          <input
            type="checkbox"
            checked={settings.harnessAutoRun}
            onChange={(event) => update({ harnessAutoRun: event.target.checked })}
          />
          引擎分析完成後自動執行 AI Harness
        </label>
        <label className="check-row">
          <input
            type="checkbox"
            checked={settings.harnessReuseEvidence}
            onChange={(event) =>
              update({ harnessReuseEvidence: event.target.checked })
            }
          />
          追問優先沿用既有證據（預設關閉；關閉時會重新驗證）
        </label>
        <label className="check-row">
          <input
            type="checkbox"
            checked={settings.crossEngineEnabled}
            onChange={(event) =>
              update({ crossEngineEnabled: event.target.checked })
            }
          />
          啟用複核引擎（需先在上方選擇另一個引擎）
        </label>
        <div className="settings-number-grid">
          <div className="field">
            <label className="field-label">每輪起始研究秒數（20–60）</label>
            <input
              className="text-input"
              type="number"
              min={20}
              max={60}
              value={settings.harnessEngineTimeMs / 1000}
              onChange={(event) =>
                update({
                  harnessEngineTimeMs:
                    Math.max(20, Math.min(60, Number(event.target.value))) * 1000
                })
              }
            />
          </div>
          <div className="field">
            <label className="field-label">每批完整研究模型呼叫（3–10）</label>
            <input
              className="text-input"
              type="number"
              min={3}
              max={10}
              value={settings.harnessResearchMaxModelCalls}
              onChange={(event) =>
                update({
                  harnessResearchMaxModelCalls: Math.max(
                    3,
                    Math.min(10, Number(event.target.value))
                  )
                })
              }
            />
          </div>
          <div className="field">
            <label className="field-label">完整研究輸出 token（500–20000）</label>
            <input
              className="text-input"
              type="number"
              min={500}
              max={20000}
              step={500}
              value={settings.harnessResearchMaxOutputTokens}
              onChange={(event) =>
                update({
                  harnessResearchMaxOutputTokens: Math.max(
                    500,
                    Math.min(20000, Number(event.target.value))
                  )
                })
              }
            />
          </div>
          <div className="field">
            <label className="field-label">每批聚焦回答模型呼叫（3–10）</label>
            <input
              className="text-input"
              type="number"
              min={3}
              max={10}
              value={settings.harnessFocusedMaxModelCalls}
              onChange={(event) =>
                update({
                  harnessFocusedMaxModelCalls: Math.max(
                    3,
                    Math.min(10, Number(event.target.value))
                  )
                })
              }
            />
          </div>
          <div className="field">
            <label className="field-label">聚焦回答輸出 token（500–20000）</label>
            <input
              className="text-input"
              type="number"
              min={500}
              max={20000}
              step={500}
              value={settings.harnessFocusedMaxOutputTokens}
              onChange={(event) =>
                update({
                  harnessFocusedMaxOutputTokens: Math.max(
                    500,
                    Math.min(20000, Number(event.target.value))
                  )
                })
              }
            />
          </div>
        </div>
        <div className="row gap">
          <span className="muted">本機診斷紀錄：{traceCount} 筆</span>
          <button className="btn ghost" onClick={() => void exportHarnessTraces()}>
            匯出診斷
          </button>
          <button className="btn danger" onClick={() => void clearHarnessTraces()}>
            清除紀錄
          </button>
        </div>
      </section>

      <section className="card">
        <h3>版本與自動更新</h3>
        {updateStatus === null ? (
          <p className="muted">正在讀取版本資訊…</p>
        ) : (
          <>
            <p className="muted">
              目前版本：<span className="mono">{updateStatus.currentVersion}</span>
              {updateStatus.availableVersion &&
                `　可用版本：${updateStatus.availableVersion}`}
            </p>
            <div
              className={`engine-status ${
                updateStatus.phase === 'error' ||
                updateStatus.phase === 'unconfigured'
                  ? 'warn'
                  : 'ok'
              }`}
            >
              {updateStatus.message}
            </div>
            {updateStatus.phase === 'downloading' && (
              <progress
                className="update-progress"
                max={100}
                value={updateStatus.downloadPercent ?? 0}
              />
            )}
            <div className="row gap">
              <button
                className="btn ghost"
                disabled={
                  updateBusy ||
                  !updateStatus.automaticChecksEnabled ||
                  updateStatus.phase === 'checking' ||
                  updateStatus.phase === 'downloading'
                }
                onClick={() => void runUpdateAction(() => window.api.update.check())}
              >
                {updateStatus.phase === 'checking' ? '檢查中…' : '立即檢查'}
              </button>
              {updateStatus.phase === 'available' && (
                <button
                  className="btn"
                  disabled={updateBusy}
                  onClick={() =>
                    void runUpdateAction(() => window.api.update.download())
                  }
                >
                  下載更新
                </button>
              )}
              {updateStatus.phase === 'downloaded' && (
                <button
                  className="btn"
                  disabled={updateBusy}
                  onClick={() =>
                    void runUpdateAction(() => window.api.update.install())
                  }
                >
                  重新啟動並安裝
                </button>
              )}
            </div>
          </>
        )}
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
