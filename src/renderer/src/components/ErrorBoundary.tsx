import React from 'react'

interface State {
  error: Error | null
}

export class ErrorBoundary extends React.Component<React.PropsWithChildren, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: React.ErrorInfo): void {
    if (import.meta.env.DEV) {
      console.error('Renderer UI error', error, info.componentStack)
    } else {
      console.error('Renderer UI error')
    }
  }

  render(): React.ReactNode {
    if (!this.state.error) return this.props.children
    return (
      <div className="fatal-error">
        <h2>介面發生錯誤</h2>
        <p>目前畫面無法繼續顯示。重新載入不會刪除已儲存資料。</p>
        {import.meta.env.DEV ? <pre>{this.state.error.message}</pre> : null}
        <button className="btn" onClick={() => window.location.reload()}>
          重新載入
        </button>
      </div>
    )
  }
}
