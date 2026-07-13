import {
  InMemoryAnalysisSessionStore,
  MAX_ANALYSIS_SESSIONS
} from '../../../src/main/storage/AnalysisSessionStore'
import type { AnalysisSession } from '../../../src/main/storage/AnalysisSessionStore'

let passed = 0
let failed = 0

function check(name: string, condition: boolean): void {
  if (condition) {
    passed++
    console.log(`  ✓ ${name}`)
  } else {
    failed++
    console.error(`  ✗ ${name}`)
  }
}

function makeSession(index: number, expiresAt: string): AnalysisSession {
  return {
    analysisId: `analysis-${index}`,
    requestId: `request-${index}`,
    createdAt: new Date(Date.UTC(2026, 0, 1, 0, 0, index)).toISOString(),
    expiresAt,
    positionFen: '9/9/9/9/9/9/9/9/9/9 w - - 0 1',
    engineAnalysis: {} as AnalysisSession['engineAnalysis'],
    moveComparison: {} as AnalysisSession['moveComparison']
  }
}

async function main(): Promise<void> {
  console.log('\n## 分析 session 暫存上限')
  const store = new InMemoryAnalysisSessionStore()
  const future = new Date(Date.now() + 60_000).toISOString()
  for (let i = 0; i < MAX_ANALYSIS_SESSIONS + 5; i++) {
    await store.save(makeSession(i, future))
  }

  check('超過上限時會淘汰最舊 session', (await store.get('analysis-0')) === null)
  check(
    '超過上限時保留最新 session',
    (await store.get(`analysis-${MAX_ANALYSIS_SESSIONS + 4}`)) !== null
  )

  const expired = makeSession(999, new Date(Date.now() - 1_000).toISOString())
  await store.save(expired)
  check('過期 session 讀取時會被清除', (await store.get(expired.analysisId)) === null)

  console.log(`結果：${passed} 通過，${failed} 失敗`)
  if (failed > 0) process.exit(1)
}

void main()
