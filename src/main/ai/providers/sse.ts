/**
 * 最小的 Server-Sent Events 解析器（純邏輯，無 I/O）。
 *
 * - 以空行分隔事件；同一事件的多行 data 以換行接起。
 * - `:` 開頭的行是註解（OpenRouter 用它當「處理中」訊號），直接略過。
 * - 接受 LF 與 CRLF；資料可以在任何位置被切成多段送入。
 */
export interface SseEvent {
  data: string
}

export class SseParser {
  private buffer = ''
  private dataLines: string[] = []

  /** 送入一段文字，回傳這段文字完成的事件。 */
  push(text: string): SseEvent[] {
    this.buffer += text
    const events: SseEvent[] = []
    let newline = this.buffer.indexOf('\n')
    while (newline >= 0) {
      const line = this.buffer.slice(0, newline).replace(/\r$/, '')
      this.buffer = this.buffer.slice(newline + 1)
      this.consumeLine(line, events)
      newline = this.buffer.indexOf('\n')
    }
    return events
  }

  /** 串流結束時處理最後一行與尚未以空行收尾的事件。 */
  flush(): SseEvent[] {
    const events: SseEvent[] = []
    if (this.buffer) {
      this.consumeLine(this.buffer.replace(/\r$/, ''), events)
      this.buffer = ''
    }
    this.dispatch(events)
    return events
  }

  private consumeLine(line: string, events: SseEvent[]): void {
    if (line === '') {
      this.dispatch(events)
      return
    }
    if (line.startsWith(':')) return
    const colon = line.indexOf(':')
    const field = colon >= 0 ? line.slice(0, colon) : line
    if (field !== 'data') return
    let value = colon >= 0 ? line.slice(colon + 1) : ''
    if (value.startsWith(' ')) value = value.slice(1)
    this.dataLines.push(value)
  }

  private dispatch(events: SseEvent[]): void {
    if (this.dataLines.length === 0) return
    events.push({ data: this.dataLines.join('\n') })
    this.dataLines = []
  }
}
