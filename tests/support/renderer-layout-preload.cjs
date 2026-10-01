// This bridge contains only synthetic state. It never opens the app's main process,
// SecretStore, engine, updater, profile or an external provider.
const { contextBridge } = require('electron')
const off = () => () => undefined
const registry = { installations: [], activeEngineId: null, verificationEngineId: null }
let updateStatus = {
  phase: 'not-available', currentVersion: '0.4.14', automaticChecksEnabled: true,
  preferences: { backgroundPreparationEnabled: true, skippedVersion: null, snoozedVersion: null, snoozeUntil: null },
  promptSuppressed: false, message: '合成測試：目前已是最新版本。'
}
contextBridge.exposeInMainWorld('api', {
  engine: {
    listInstallations: async () => registry,
    status: async () => ({ available: false, engineName: '合成測試', message: '版面測試未啟動引擎' }),
    onAnalysisProgress: off, onAnalysisResult: off, onAnalysisError: off,
    cancelAnalysis: () => undefined
  },
  ai: {
    onExplanationChunk: off, onHarnessProgress: off, onExplanationDone: off,
    onExplanationError: off, cancelExplanation: () => undefined
  },
  teacherTest: { status: async () => null },
  secret: {
    isAvailable: async () => true,
    status: async () => ({ configured: false, needsReentry: false, activeCredential: null, credentials: [] })
  },
  update: {
    status: async () => updateStatus, onChanged: off,
    check: async () => updateStatus,
    setBackgroundPreparation: async (enabled) => {
      updateStatus = { ...updateStatus, preferences: { ...updateStatus.preferences, backgroundPreparationEnabled: enabled } }
      return updateStatus
    }
  }
})
