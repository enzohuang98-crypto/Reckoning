import { Icon } from '../../components/ui/Icon'
import type { AnalysisView } from './types'

interface Props {
  activeView: AnalysisView
  onChange: (view: AnalysisView) => void
}

// 兩種模式並排且標出目前所在模式；只有一顆「猜著」切換鈕時，使用者看不出現在在哪個模式、該在哪一格輸入。
const VIEWS = [
  {
    id: 'coach',
    label: '問 AI 教練',
    icon: 'sparkles',
    hint: '針對目前棋盤提問。要檢討某一步：匯入棋譜後點那一步，再按「AI 解說」。'
  },
  {
    id: 'guess',
    label: '猜著練習',
    icon: 'target',
    hint: '先在棋盤選出你認為最好的一步並提交，引擎比較後由 AI 解說；提交後才能追問。'
  }
] as const

export function AnalysisInspectorTabs({
  activeView,
  onChange
}: Props): JSX.Element {
  const current = VIEWS.find((view) => view.id === activeView) ?? VIEWS[0]
  return (
    <>
      <div className="inspector-tabs" role="group" aria-label="分析模式">
        {VIEWS.map((view) => (
          <button
            key={view.id}
            type="button"
            id={`analysis-tab-${view.id}`}
            aria-pressed={activeView === view.id}
            aria-controls={`analysis-panel-${view.id}`}
            className={`inspector-tab${activeView === view.id ? ' active' : ''}`}
            onClick={() => onChange(view.id)}
          >
            <Icon name={view.icon} size={17} />
            <span>{view.label}</span>
          </button>
        ))}
      </div>
      <p className="inspector-mode-hint muted small">{current.hint}</p>
    </>
  )
}
