import { Icon } from '../../components/ui/Icon'
import type { AnalysisView } from './types'

interface Props {
  activeView: AnalysisView
  onChange: (view: AnalysisView) => void
}

export function AnalysisInspectorTabs({
  activeView,
  onChange
}: Props): JSX.Element {
  return (
    <div className="inspector-tabs" aria-label="研究檢視">
      <button
        type="button"
        id="analysis-tab-guess"
        aria-pressed={activeView === 'guess'}
        aria-controls="analysis-panel-guess"
        className={`inspector-tab${activeView === 'guess' ? ' active' : ''}`}
        onClick={() => onChange(activeView === 'guess' ? 'coach' : 'guess')}
      >
        <Icon name="target" size={17} />
        <span>猜著</span>
      </button>
    </div>
  )
}
