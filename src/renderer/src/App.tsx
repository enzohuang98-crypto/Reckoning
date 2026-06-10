/**
 * 應用程式根元件 (App)
 *
 * 三個分頁：分析 / 設定 / 錯題本。
 * 共享 board 與 settings 狀態。
 */

import { useMemo, useState } from 'react'
import { BoardEditor } from './components/BoardEditor'
import { FenInput } from './components/FenInput'
import { AnalysisPanel } from './components/AnalysisPanel'
import { GuessModePanel } from './components/GuessModePanel'
import { SettingsPage } from './pages/SettingsPage'
import { MistakeBookPage } from './pages/MistakeBookPage'
import { parseFen } from '@shared/logic/fen'
import { START_FEN, type BoardState } from '@shared/types/BoardState'
import type { EngineAnalysis } from '@shared/types/EngineAnalysis'
import { loadSettings } from './storage/localSettings'
import type { AppSettings } from '@shared/types/Settings'

type Tab = 'analyze' | 'settings' | 'mistakes'

function initialBoard(): BoardState {
  const parsed = parseFen(START_FEN)
  if (parsed.valid) return parsed.board
  throw new Error('內建開局 FEN 無效')
}

export function App(): JSX.Element {
  const [tab, setTab] = useState<Tab>('analyze')
  const [board, setBoard] = useState<BoardState>(initialBoard)
  const [settings, setSettings] = useState<AppSettings>(() => loadSettings())
  const [analysis, setAnalysis] = useState<EngineAnalysis | null>(null)

  const tabs = useMemo(
    () =>
      [
        { id: 'analyze' as const, label: '分析' },
        { id: 'settings' as const, label: '設定' },
        { id: 'mistakes' as const, label: '錯題本' }
      ],
    []
  )

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
            </div>
            <div className="right-col">
              <AnalysisPanel board={board} settings={settings} onAnalysis={setAnalysis} />
              <GuessModePanel analysis={analysis} />
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
