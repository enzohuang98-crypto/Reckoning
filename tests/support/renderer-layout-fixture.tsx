import { useState } from 'react'
import { createRoot } from 'react-dom/client'
import { parseFen } from '../../src/shared/logic/board/fen'
import { DEFAULT_SETTINGS } from '../../src/shared/types/Settings'
import { EMPTY_APP_DATA } from '../../src/shared/types/AppData'
import { AppShell, type AppTab } from '../../src/renderer/src/app/AppShell'
import { AnalysisWorkspace } from '../../src/renderer/src/features/workspace/AnalysisWorkspace'
import { SettingsPage } from '../../src/renderer/src/pages/SettingsPage'
import '../../src/renderer/src/styles/index.css'

const board = parseFen('rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNR w - - 0 1').board
const noop = (): void => undefined
// A user question exercises long Chinese conversation layout without presenting
// a manufactured assistant explanation as a successful AI answer.
const text = `為什麼我這一步不行，Pikafish 的首選為什麼要這樣走？請根據這次局面與引擎後續走法說明目的，接著比較我的著法。對方會怎麼反制，這些回應會改變哪些棋子的位置、活動路線或安全性？若兩種選擇都會出現同一種損失，請說清楚共同的部分，以及真正不同的走子次序與應對機會。

我想理解的是盤面的原因。分數可以列為比較資料，但只告訴我首選四百分、我的著法兩百分，仍然沒有回答到問題。請沿著主線解釋：先手做了什麼，對手接著如何應對，之後哪個棋子有了新的用途，或哪條防守線變得不足。變例只表示一種可發生的走法，請分清楚它和對手必然照走的結果。

如果我的著法和首選相同，請直接說一致，不要為了做比較硬找失誤。如果引擎資料沒有足夠的後續走法，請指出缺少哪段分析、目前能確定什麼。也請區分可以從棋盤重播核對的吃子、將軍與輪走方，以及你根據這些變化提出的策略解釋。

最後請回答我原來的疑問：這一步想達到什麼目標，我漏看了對手哪個合理應對；換成首選之後，又如何改善這個問題？我需要的是準確而切題的理由，能用在下一次遇到類似局面時做判斷。`
const conversation = {
  id: 'layout-conversation', analysisId: 'layout-analysis', positionFen: board.fen,
  createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z',
  messages: [{ id: 'layout-message', role: 'user' as const, text, createdAt: '2026-01-01T00:00:00Z' }]
}

function LayoutFixture(): JSX.Element {
  const [activeTab, setActiveTab] = useState<AppTab>('analyze')
  const [commandMount, setCommandMount] = useState<HTMLDivElement | null>(null)
  const [currentBoard, setCurrentBoard] = useState(board)
  const [settings, setSettings] = useState(DEFAULT_SETTINGS)
  return (
    <AppShell activeTab={activeTab} onTabChange={setActiveTab} updateStatus={null}
      dataError={null} dataRecoveryRequired={false} dataRecoveryBusy={false}
      onRetryLoad={noop} onRetrySave={noop} onDownloadUpdate={noop}
      onAnalysisCommandMountChange={setCommandMount}>
      <AnalysisWorkspace hidden={activeTab !== 'analyze'} headerCommandMount={commandMount}
        board={currentBoard} settings={settings} canUndo={false} canRedo={false}
        onBoardChange={setCurrentBoard} onUndo={noop} onRedo={noop} onRestoreOriginal={noop}
        savedPositions={[]} onSavePosition={noop} onLoadSavedPosition={noop}
        onDeleteSavedPosition={noop} conversation={conversation} onConversationChange={noop}
        onRecordGuess={noop} onOpenAiSettings={() => setActiveTab('settings')}
        onUnsavedDraftChange={noop} />
      {activeTab === 'settings' && <SettingsPage settings={settings}
        onSettingsChange={setSettings} onDataImported={noop}
        getCurrentDataSnapshot={() => EMPTY_APP_DATA} dataRecoveryRequired={false} />}
    </AppShell>
  )
}

createRoot(document.getElementById('root')!).render(<LayoutFixture />)
