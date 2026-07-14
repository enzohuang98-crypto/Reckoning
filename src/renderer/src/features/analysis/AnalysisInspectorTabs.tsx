import { useRef } from 'react'
import { Icon, type IconName } from '../../components/ui/Icon'
import type { AnalysisView } from './types'

interface TabItem {
  id: AnalysisView
  label: string
  icon: IconName
}

const tabs: TabItem[] = [
  { id: 'coach', label: 'AI 教練', icon: 'brain' },
  { id: 'guess', label: '猜著', icon: 'target' }
]

interface Props {
  activeView: AnalysisView
  onChange: (view: AnalysisView) => void
  aiBusy: boolean
  hasExplanation: boolean
}

export function AnalysisInspectorTabs({
  activeView,
  onChange,
  aiBusy,
  hasExplanation
}: Props): JSX.Element {
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([])

  return (
    <div className="inspector-tabs" role="tablist" aria-label="研究檢視">
      {tabs.map((tab, index) => (
        <button
          key={tab.id}
          ref={(element) => {
            tabRefs.current[index] = element
          }}
          type="button"
          role="tab"
          id={`analysis-tab-${tab.id}`}
          aria-controls={`analysis-panel-${tab.id}`}
          aria-selected={activeView === tab.id}
          tabIndex={activeView === tab.id ? 0 : -1}
          className={`inspector-tab${activeView === tab.id ? ' active' : ''}`}
          onClick={() => onChange(tab.id)}
          onKeyDown={(event) => {
            if (
              event.key !== 'ArrowLeft' &&
              event.key !== 'ArrowRight' &&
              event.key !== 'Home' &&
              event.key !== 'End'
            ) {
              return
            }
            event.preventDefault()
            const nextIndex =
              event.key === 'Home'
                ? 0
                : event.key === 'End'
                  ? tabs.length - 1
                  : (index + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) %
                    tabs.length
            const next = tabs[nextIndex]
            onChange(next.id)
            tabRefs.current[nextIndex]?.focus()
          }}
        >
          <Icon name={tab.icon} size={17} />
          <span>{tab.label}</span>
          {tab.id === 'coach' && aiBusy && <span className="tab-activity" />}
          {tab.id === 'coach' && !aiBusy && hasExplanation && (
            <span className="tab-check">✓</span>
          )}
        </button>
      ))}
    </div>
  )
}
