import { useEffect, useState } from 'react'

interface Props {
  phase: 'license' | 'setup' | 'data'
}

const phaseText: Record<Props['phase'], string> = {
  license: '正在確認應用程式狀態',
  setup: '正在載入引擎與安全設定',
  data: '正在讀取你的棋局資料'
}

export function StartupScreen({ phase }: Props): JSX.Element {
  const [takingLonger, setTakingLonger] = useState(false)

  useEffect(() => {
    const timer = window.setTimeout(() => setTakingLonger(true), 5000)
    return () => window.clearTimeout(timer)
  }, [])

  return (
    <div className="startup-screen" role="status" aria-live="polite">
      <div className="startup-card">
        <span className="brand-seal large" aria-hidden="true">象</span>
        <div>
          <span className="eyebrow">XIANGQI STUDY DESK</span>
          <h1>象理正在啟動</h1>
          <p>{phaseText[phase]}</p>
        </div>
        <div className="startup-progress" aria-hidden="true"><span /></div>
        {takingLonger && (
          <p className="muted small">
            首次啟動或系統剛更新時可能需要較久；程式仍在檢查本機資料。
          </p>
        )}
      </div>
    </div>
  )
}
