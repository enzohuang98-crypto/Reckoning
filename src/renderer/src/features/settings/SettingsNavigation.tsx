import { Icon, type IconName } from '../../components/ui/Icon'
import type { SettingsCategory } from './types'

const categories: Array<{
  id: SettingsCategory
  label: string
  description: string
  icon: IconName
}> = [
  { id: 'ai', label: 'AI 與金鑰', description: 'Provider、模型與解說語言', icon: 'brain' },
  { id: 'engines', label: '本機引擎', description: '引擎安裝、複核與分析時間', icon: 'board' },
  { id: 'harness', label: '解說品質', description: '研究模式、預算與診斷', icon: 'sparkles' },
  { id: 'system', label: '資料與系統', description: '備份、更新與授權', icon: 'settings' }
]

interface Props {
  active: SettingsCategory
  onChange: (category: SettingsCategory) => void
}

export function SettingsNavigation({ active, onChange }: Props): JSX.Element {
  return (
    <nav className="settings-navigation" aria-label="設定分類">
      {categories.map((category) => (
        <button
          key={category.id}
          type="button"
          className={`settings-nav-item${active === category.id ? ' active' : ''}`}
          aria-current={active === category.id ? 'page' : undefined}
          onClick={() => onChange(category.id)}
        >
          <Icon name={category.icon} size={19} />
          <span>
            <b>{category.label}</b>
            <small>{category.description}</small>
          </span>
        </button>
      ))}
    </nav>
  )
}
