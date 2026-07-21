import type { ReactNode } from 'react'

/**
 * 把 Harness renderAnswer 產生的段落文字（## 標題、### 區塊、AI 答：、[E1] 證據標記、- 條列）
 * 渲染成結構化區塊。沒有這種結構的純文字（追問澄清、使用者訊息等）維持原樣輸出。
 */

type SectionKind = 'qa' | 'general' | 'notice' | 'raw'

interface ParsedSection {
  heading: string
  kind: SectionKind
  lines: string[]
}

function classifyHeading(heading: string): SectionKind {
  if (heading.includes('一般棋理')) return 'general'
  if (heading.includes('引擎原始主線')) return 'raw'
  if (heading.includes('注意')) return 'notice'
  return 'qa'
}

function renderInline(text: string): ReactNode {
  return text.replace(/\s*\[E\d+\]/g, '')
}

function renderBody(lines: string[]): ReactNode[] {
  const nodes: ReactNode[] = []
  let bullets: string[] = []
  const flushBullets = (): void => {
    if (bullets.length === 0) return
    nodes.push(
      <ul key={`list-${nodes.length}`}>
        {bullets.map((item, index) => (
          <li key={index}>{renderInline(item)}</li>
        ))}
      </ul>
    )
    bullets = []
  }
  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed) continue
    if (trimmed.startsWith('- ')) {
      bullets.push(trimmed.slice(2))
      continue
    }
    flushBullets()
    if (trimmed.startsWith('AI 答：')) {
      nodes.push(
        <p className="explanation-claim" key={`claim-${nodes.length}`}>
          <span className="claim-label">答</span>
          <span className="claim-text">
            {renderInline(trimmed.slice('AI 答：'.length))}
          </span>
        </p>
      )
    } else {
      nodes.push(
        <p className="explanation-claim plain" key={`claim-${nodes.length}`}>
          {renderInline(trimmed)}
        </p>
      )
    }
  }
  flushBullets()
  return nodes
}

export function ExplanationView({ text }: { text: string }): JSX.Element {
  if (!text.includes('## ')) {
    return <p className="explanation-text">{text}</p>
  }
  const lines = text.split('\n')
  let title = ''
  const preamble: string[] = []
  const sections: ParsedSection[] = []
  let current: ParsedSection | null = null
  for (const line of lines) {
    if (line.startsWith('### ')) {
      const heading = line.slice(4).trim()
      current = { heading, kind: classifyHeading(heading), lines: [] }
      sections.push(current)
      continue
    }
    if (line.startsWith('## ')) {
      title = line.slice(3).trim()
      continue
    }
    if (current) current.lines.push(line)
    else preamble.push(line)
  }
  return (
    <div className="explanation-view">
      {title && <div className="explanation-title">{title}</div>}
      {renderBody(preamble)}
      {sections.map((section, index) => (
        <section className={`explanation-section ${section.kind}`} key={index}>
          <h5 className="explanation-heading">
            {section.kind === 'general'
              ? section.heading.replace(/（教練常識，未經引擎驗證）/, '')
              : section.heading}
            {section.kind === 'general' && (
              <span className="general-tag">教練常識・未經引擎驗證</span>
            )}
          </h5>
          {renderBody(section.lines)}
        </section>
      ))}
    </div>
  )
}
