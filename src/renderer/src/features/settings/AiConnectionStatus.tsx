export type AiConnectionStage =
  | 'idle'
  | 'catalog'
  | 'awaiting-model'
  | 'generation'
  | 'storage'
  | 'enabled'

interface Props {
  stage: AiConnectionStage
  configured?: boolean
}

const LABELS: Record<AiConnectionStage, string> = {
  idle: '尚未連線',
  catalog: '驗證金鑰／讀取免費模型',
  'awaiting-model': '等待選擇模型（尚未儲存）',
  generation: '測試實際生成',
  storage: '安全儲存中',
  enabled: '已啟用'
}

export function AiConnectionStatus({ stage, configured = false }: Props): JSX.Element {
  const effectiveStage = configured ? 'enabled' : stage
  return (
    <div className="muted small" role="status" aria-live="polite">
      AI 連線狀態：{LABELS[effectiveStage]}
    </div>
  )
}
