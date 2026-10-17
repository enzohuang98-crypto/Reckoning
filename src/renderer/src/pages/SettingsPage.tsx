/**
 * 設定頁控制器。
 *
 * UI 依領域拆到 features/settings；各分類的狀態與 IPC 放在對應 hook
 * （useAiCredentialSettings、useEngineSettings、useSystemSettings），
 * 此檔只組合它們、共用的提示訊息與一般設定持久化。
 * API Key 永遠走 SecretStore，絕不寫入 renderer 的 localStorage。
 */

import { useEffect, useState } from 'react'
import type { AppDataSnapshot } from '@shared/types/AppData'
import type { AppUpdateStatus } from '@shared/types/AppUpdate'
import type { AppSettings } from '@shared/types/Settings'
import { AiSettingsSection } from '../features/settings/AiSettingsSection'
import { EngineSettingsSection } from '../features/settings/EngineSettingsSection'
import { SettingsNavigation } from '../features/settings/SettingsNavigation'
import { SystemSettingsSection } from '../features/settings/SystemSettingsSection'
import type { SettingsCategory } from '../features/settings/types'
import { useAiCredentialSettings } from '../features/settings/useAiCredentialSettings'
import { useEngineSettings } from '../features/settings/useEngineSettings'
import { useSystemSettings } from '../features/settings/useSystemSettings'
import { saveSettings } from '../storage/localSettings'

interface Props {
  settings: AppSettings
  onSettingsChange: (settings: AppSettings) => void
  onDataImported: (snapshot: AppDataSnapshot) => void
  getCurrentDataSnapshot: () => AppDataSnapshot
  dataRecoveryRequired: boolean
  onInstallUpdate?: () => Promise<AppUpdateStatus>
}

export function SettingsPage({
  settings,
  onSettingsChange,
  onDataImported,
  getCurrentDataSnapshot,
  dataRecoveryRequired,
  onInstallUpdate = () => window.api.update.install()
}: Props): JSX.Element {
  const [activeCategory, setActiveCategory] = useState<SettingsCategory>('ai')
  const [savedMessage, setSavedMessage] = useState<string | null>(null)
  const [operationError, setOperationError] = useState<string | null>(null)

  const update = (patch: Partial<AppSettings>): boolean => {
    const next = { ...settings, ...patch }
    onSettingsChange(next)
    const saved = saveSettings(next)
    if (!saved.ok) {
      setOperationError(saved.message ?? '設定儲存失敗。')
      return false
    }
    setOperationError(null)
    return true
  }

  const ai = useAiCredentialSettings({
    settings,
    onSettingsChange,
    update,
    setOperationError,
    setSavedMessage
  })
  const engine = useEngineSettings({ setOperationError })
  const system = useSystemSettings({
    onDataImported,
    getCurrentDataSnapshot,
    dataRecoveryRequired,
    onInstallUpdate,
    setOperationError,
    setSavedMessage
  })

  // 開啟設定頁時的初始查詢；維持原本的 IPC 呼叫順序。
  useEffect(() => {
    const unsubscribeUpdate = system.subscribeUpdateStatus()
    ai.loadSecretStatus()
    void engine.refreshEngine()
    system.loadTraceCount()
    ai.loadBackupModels()
    system.loadUpdateStatus()
    return unsubscribeUpdate
  }, [])

  useEffect(() => {
    if (!operationError) return
    setSavedMessage(null)
  }, [operationError])

  useEffect(() => {
    if (!savedMessage) return
    const timer = window.setTimeout(() => setSavedMessage(null), 10_000)
    return () => window.clearTimeout(timer)
  }, [savedMessage])

  return (
    <div className="settings-page">
      <div className="page-heading">
        <div>
          <span className="eyebrow">SYSTEM PREFERENCES</span>
          <h1>設定</h1>
          <p>設定依用途分類；一般選項與資料保存在本機，API Key 另行加密。</p>
        </div>
        <div className="heading-status">
          <span className="status-dot" />
          資料保存在本機
        </div>
      </div>

      {operationError && <div className="settings-global-message error-text">{operationError}</div>}
      {savedMessage && <div className="settings-global-message success-text">{savedMessage}</div>}

      <div className="settings-layout">
        <SettingsNavigation active={activeCategory} onChange={setActiveCategory} />
        <div className="settings-content">
          {activeCategory === 'ai' && (
            <AiSettingsSection
              apiKey={ai.apiKey}
              onApiKeyChange={ai.changeApiKey}
              secretStatus={ai.secretStatus}
              encryptionAvailable={ai.encryptionAvailable}
              secretBusy={ai.secretBusy}
              openRouterModels={ai.openRouterModels}
              selectedOpenRouterModel={ai.selectedOpenRouterModel}
              onOpenRouterModelChange={ai.changeOpenRouterModel}
              onConnectKey={() => void ai.connectKey()}
              onRefreshOpenRouterModels={() => void ai.connectKey(true)}
              onLoadSavedOpenRouterModels={() => void ai.loadSavedModels()}
              onSwitchSavedOpenRouterModel={() => void ai.switchSavedModel()}
              savedModelsLoaded={ai.savedModelsLoaded}
              savedModelsError={ai.savedModelsError}
              backupModels={ai.backupModels}
              onBackupModelsChange={ai.setBackupModels}
              onSaveBackupModels={() => void ai.saveBackupModels()}
              onDeleteKey={() => void ai.deleteKey()}
              connectionStage={ai.connectionStage}
            />
          )}

          {activeCategory === 'engines' && (
            <EngineSettingsSection
              settings={settings}
              update={update}
              registry={engine.engineRegistry}
              testingEngineId={engine.testingEngineId}
              message={engine.engineMessage}
              testResult={engine.engineTest}
              onRefresh={() => void engine.refreshEngine()}
              onTest={(id) => void engine.testEngine(id)}
              onRemove={(id) => void engine.removeEngine(id)}
              onSelect={(activeId) => void engine.selectEngine(activeId)}
            />
          )}

          {activeCategory === 'system' && (
            <SystemSettingsSection
              updateStatus={system.updateStatus}
              updateBusy={system.updateBusy}
              onExportBackup={() => void system.exportBackup()}
              traceCount={system.traceCount}
              onExportTraces={() => void system.exportTraces()}
              onClearTraces={() => void system.clearTraces()}
              canExportBackup={!dataRecoveryRequired}
              onImportBackup={() => void system.importBackup()}
              onCheckUpdate={() => void system.checkUpdate()}
              onDownloadUpdate={() => void system.downloadUpdate()}
              onInstallUpdate={() => void system.installUpdate()}
              onSetBackgroundPreparation={(enabled) =>
                void system.setBackgroundPreparation(enabled)
              }
            />
          )}
        </div>
      </div>
    </div>
  )
}
