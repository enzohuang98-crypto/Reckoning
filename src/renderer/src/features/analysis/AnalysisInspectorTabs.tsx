import { Icon, type IconName } from '../../components/ui/Icon'
import type { AnalysisView } from './types'

interface TabItem {
  id: AnalysisView
  label: string
  icon: IconName
}

const tabs: TabItem[] = [
  { id: 'live', label: '即時分析', icon: 'live' },
  { id: 'coach', label: 'AI 教練', icon: 'brain' },
  { id: 'guess', label: '猜著', icon: 'target' },
  { id: 'details', label: '資料', icon: 'details' }
]

interface Props {
  activeView: AnalysisView
  onChange: (view: AnalysisView) => void
  analysisBusy: boolean
  aiBusy: boolean
  hasExplanation: boolean
}

export function AnalysisInspectorTabs({
  activeView,
  onChange,
  analysisBusy,
  aiBusy,
  hasExplanation
}: Props): JSX.Element {
  return (
    <div className="inspector-tabs" role="tablist" aria-label="研究檢視">
      {tabs.map((tab) => (
        <button
          key={tab.id}
          type="button"
          role="tab"
          aria-selected={activeView === tab.id}
          className={`inspector-tab${activeView === tab.id ? ' active' : ''}`}
          onClick={() => onChange(tab.id)}
        >
          <Icon name={tab.icon} size={17} />
          <span>{tab.label}</span>
          {tab.id === 'live' && analysisBusy && <span className="tab-activity" />}
          {tab.id === 'coach' && aiBusy && <span className="tab-activity" />}
          {tab.id === 'coach' && !aiBusy && hasExplanation && (
            <span className="tab-check">✓</span>
          )}
        </button>
      ))}
    </div>
  )
}
