import { useEffect, useRef, type ReactNode } from 'react'
import { Icon, type IconName } from './Icon'

export interface ToolbarMenuItem {
  id: string
  label: string
  description: string
  icon: IconName
  active?: boolean
  danger?: boolean
  disabled?: boolean
  onSelect: () => void
}

interface Props {
  icon: IconName
  label: string
  active?: boolean
  children?: ReactNode
  items: ToolbarMenuItem[]
}

export function ToolbarMenu({ icon, label, active, children, items }: Props): JSX.Element {
  const detailsRef = useRef<HTMLDetailsElement>(null)

  useEffect(() => {
    if (typeof document === 'undefined') return

    const closeOnOutsideClick = (event: PointerEvent): void => {
      const details = detailsRef.current
      if (!details?.open || !(event.target instanceof Node)) return
      if (!details.contains(event.target)) details.open = false
    }
    const closeOnEscape = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape' || !detailsRef.current?.open) return
      detailsRef.current.open = false
      detailsRef.current.querySelector<HTMLElement>('summary')?.focus()
    }
    document.addEventListener('pointerdown', closeOnOutsideClick)
    document.addEventListener('keydown', closeOnEscape)
    return () => {
      document.removeEventListener('pointerdown', closeOnOutsideClick)
      document.removeEventListener('keydown', closeOnEscape)
    }
  }, [])

  return (
    <details className="toolbar-menu" ref={detailsRef}>
      {/*
        窄視窗會用 CSS 把 .toolbar-label 收起來只留 icon，而 icon 都是
        aria-hidden；沒有這裡的 aria-label／title，收合後的選單按鈕就完全
        沒有可辨識名稱（架構測試只掃 <button>，掃不到 <summary>）。
      */}
      <summary
        className={`toolbar-btn${active ? ' active' : ''}`}
        aria-label={label}
        title={label}
      >
        <Icon name={icon} className="toolbar-icon" />
        <span className="toolbar-label">{label}</span>
        <Icon name="chevronDown" size={14} className="toolbar-menu-chevron" />
      </summary>
      <div className="toolbar-popover" role="menu">
        {children}
        {items.map((item) => (
          <button
            key={item.id}
            type="button"
            role="menuitem"
            className={`toolbar-menu-item${item.active ? ' active' : ''}${item.danger ? ' danger' : ''}`}
            disabled={item.disabled}
            onClick={() => {
              item.onSelect()
              if (detailsRef.current) detailsRef.current.open = false
            }}
          >
            <Icon name={item.icon} size={18} />
            <span>
              <b>{item.label}</b>
              <small>{item.description}</small>
            </span>
          </button>
        ))}
      </div>
    </details>
  )
}
