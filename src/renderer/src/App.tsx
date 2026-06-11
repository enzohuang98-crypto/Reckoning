/**
 * 應用程式根元件 (App)
 *
 * 三個分頁：分析 / 設定 / 錯題本。
 * 共享 board 與 settings 狀態。
 */

import { useEffect, useMemo, useState } from 'react'
import { BoardEditor } from './components/BoardEditor'
import { FenInput } from './components/FenInput'
import { GameImportPanel } from './components/GameImportPanel'
import { AnalysisPanel } from './components/AnalysisPanel'
import { GuessModePanel } from './components/GuessModePanel'
import { SettingsPage } from './pages/SettingsPage'
import { SetupWizard } from './pages/SetupWizard'
import { LicensePage } from './pages/LicensePage'
import { MistakeBookPage } from './pages/MistakeBookPage'
import { parseFen } from '@shared/logic/fen'
import { START_FEN, type BoardState } from '@shared/types/BoardState'
import type { EngineAnalysisResultPayload } from '@shared/types/ipc'
import type { AIExplanationResponse } from '@shared/types/AIExplanationTypes'
import { isSetupCompleted, loadSettings, markSetupCompleted } from './storage/localSettings'
import type { AppSettings } from '@shared/types/Settings'
import { ALL_PROVIDER_IDS } from '@shared/types/AIProviderTypes'

type Tab = 'analyze' | 'settings' | 'mistakes'

/** 初始設定嚮導顯示狀態：checking = 正在查詢既有設定 */
type SetupState = 'checking' | 'wizard' | 'done'

/** 買斷授權狀態（SDS Q5）：未啟用時鎖住主介面 */
type LicenseState = 'checking' | 'locked' | 'ok'

/** 暫時繞過授權鎖定畫面（beta 測試用）；LicenseService 邏輯不變，僅 UI 不強制顯示 LicensePage */
const LICENSE_GATE_DISABLED = true

function initialBoard(): BoardState {
  const parsed = parseFen(START_FEN)
  if (parsed.valid) return parsed.board
  throw new Error('內建開局 FEN 無效')
}

export function App(): JSX.Element {
  const [tab, setTab] = useState<Tab>('analyze')
  const [board, setBoard] = useState<BoardState>(initialBoard)
  const [settings, setSettings] = useState<AppSettings>(() => loadSettings())
  /** 使用者猜的著法（看答案前輸入；分析時帶給 main） */
  const [userMove, setUserMove] = useState('')
  /** 最近一次分析結果（含 analysisId 與比較） */
  const [result, setResult] = useState<EngineAnalysisResultPayload | null>(null)
  /** 最近一次 AI 解說（加入錯題本時保存） */
  const [explanation, setExplanation] = useState<AIExplanationResponse | null>(null)
  const [setupState, setSetupState] = useState<SetupState>(() =>
    isSetupCompleted() ? 'done' : 'checking'
  )
  const [licenseState, setLicenseState] = useState<LicenseState>('checking')

  // 啟動時查授權狀態（main process 離線驗證儲存的 key）
  useEffect(() => {
    let cancelled = false
    window.api.license
      .status()
      .then((status) => {
        if (!cancelled) setLicenseState(status.activated ? 'ok' : 'locked')
      })
      .catch(() => {
        if (!cancelled) setLicenseState('locked')
      })
    return () => {
      cancelled = true
    }
  }, [])

  // 局面變更（擺棋 / 套用 FEN / 棋譜跳轉）即清除舊結果與猜測，避免比對到錯的局面
  useEffect(() => {
    setResult(null)
    setExplanation(null)
    setUserMove('')
  }, [board.fen])

  // 嚮導觸發條件：未完成過嚮導，且引擎路徑與所有 API 金鑰皆未設定。
  // 任一已設定（例如舊版升級）視同已完成初始設定，直接標記跳過。
  useEffect(() => {
    if (setupState !== 'checking') return
    let cancelled = false
    void (async () => {
      const [path, ...hasKeys] = await Promise.all([
        window.api.engine.getPath(),
        ...ALL_PROVIDER_IDS.map((p) => window.api.secret.has(p))
      ])
      if (cancelled) return
      if (path || hasKeys.some(Boolean)) {
        markSetupCompleted()
        setSetupState('done')
      } else {
        setSetupState('wizard')
      }
    })()
    return () => {
      cancelled = true
    }
  }, [setupState])

  const tabs = useMemo(
    () =>
      [
        { id: 'analyze' as const, label: '分析' },
        { id: 'settings' as const, label: '設定' },
        { id: 'mistakes' as const, label: '錯題本' }
      ],
    []
  )

  if (licenseState === 'checking' || setupState === 'checking') {
    // 等待查詢授權與既有設定（毫秒級），避免畫面閃爍切換
    return <div className="app" />
  }

  // 授權優先於初始設定嚮導：未啟用一律先顯示啟用頁（SDS Q5）
  if (licenseState === 'locked' && !LICENSE_GATE_DISABLED) {
    return <LicensePage onActivated={() => setLicenseState('ok')} />
  }

  if (setupState === 'wizard') {
    return (
      <SetupWizard
        settings={settings}
        onSettingsChange={setSettings}
        onComplete={() => setSetupState('done')}
      />
    )
  }

  return (
    <div className="app">
      <header className="app-header">
        <div className="app-title">象棋 AI 分析講解</div>
        <nav className="app-nav">
          {tabs.map((t) => (
            <button
              key={t.id}
              className={`nav-btn ${tab === t.id ? 'active' : ''}`}
              onClick={() => setTab(t.id)}
            >
              {t.label}
            </button>
          ))}
        </nav>
      </header>

      <main className="app-main">
        {tab === 'analyze' && (
          <div className="analyze-layout">
            <div className="left-col">
              <BoardEditor board={board} onChange={setBoard} />
              <FenInput initialFen={board.fen} onValidBoard={setBoard} />
              <GameImportPanel board={board} onBoardChange={setBoard} />
            </div>
            <div className="right-col">
              <AnalysisPanel
                board={board}
                settings={settings}
                userMove={userMove}
                onResult={setResult}
                onExplanation={setExplanation}
              />
              <GuessModePanel
                userMove={userMove}
                onUserMoveChange={setUserMove}
                result={result}
                explanation={explanation}
              />
            </div>
          </div>
        )}
        {tab === 'settings' && (
          <SettingsPage settings={settings} onSettingsChange={setSettings} />
        )}
        {tab === 'mistakes' && <MistakeBookPage />}
      </main>
    </div>
  )
}
