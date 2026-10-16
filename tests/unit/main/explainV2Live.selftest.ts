import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { OpenRouterProvider } from '../../../src/main/ai/providers/OpenRouterProvider'
import {
  formatLiveReport,
  loadLiveCases,
  runLiveCase,
  type LiveRow
} from '../../../tools/acceptance/explain-v2-live'

const FAKE_KEY = 'sk-or-v1-0123456789abcdef0123456789abcdef'

async function main(): Promise<void> {
  const cases = loadLiveCases()
  assert.equal(cases.length, 10, 'live 驗收沿用 P3-8 的 10 個局面')
  const opening = cases.find((item) => item.id === 'opening-inaccuracy')
  const rule = cases.find((item) => item.id === 'rule-question')
  assert.ok(opening && rule)
  const goodAnswer = (opening as unknown as { goodAnswer: string }).goodAnswer

  let chatCalls = 0
  const server = createServer((request, response) => {
    let raw = ''
    request.on('data', (chunk) => {
      raw += String(chunk)
    })
    request.on('end', () => {
      assert.equal(request.headers.authorization, `Bearer ${FAKE_KEY}`)
      if (request.url?.startsWith('/api/v1/models')) {
        response.writeHead(200, { 'content-type': 'application/json' })
        response.end(JSON.stringify({
          data: [
            { id: 'vendor/good:free', supported_parameters: ['max_tokens'] },
            { id: 'vendor/limited:free', supported_parameters: ['max_tokens'] }
          ]
        }))
        return
      }
      chatCalls += 1
      const body = JSON.parse(raw) as { model?: string; stream?: boolean }
      if (body.model === 'vendor/limited:free') {
        response.writeHead(429, { 'content-type': 'application/json' })
        response.end(JSON.stringify({ error: { message: 'Rate limit exceeded: free-models-per-day. secret detail' } }))
        return
      }
      assert.equal(body.stream, true, 'v2 管線走串流')
      response.writeHead(200, { 'content-type': 'text/event-stream' })
      response.write(': OPENROUTER PROCESSING\n\n')
      response.write(`data: ${JSON.stringify({ model: 'vendor/good', choices: [{ delta: { content: goodAnswer } }] })}\n\n`)
      response.write(`data: ${JSON.stringify({ model: 'vendor/good', choices: [{ delta: {}, finish_reason: 'stop' }], usage: { completion_tokens: 200 } })}\n\n`)
      response.end('data: [DONE]\n\n')
    })
  })
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done))
  try {
    const { port } = server.address() as AddressInfo
    const provider = new OpenRouterProvider({ baseUrl: `http://127.0.0.1:${port}/api/v1` })
    const deps = { provider, apiKey: FAKE_KEY }

    const ok = await runLiveCase(opening!, 'vendor/good:free', deps)
    assert.equal(ok.answerKind, 'ai')
    assert.equal(ok.error, null)
    assert.equal(ok.calls, 1)
    assert.equal(ok.repairUsed, false)
    assert.ok(ok.answer.includes('馬八進七'))
    assert.ok(ok.firstTokenMs !== null)

    const callsBeforeRule = chatCalls
    const ruleRow = await runLiveCase(rule!, 'vendor/good:free', deps)
    assert.equal(ruleRow.answerKind, 'board_rule', '棋規問題由規則引擎直接回答')
    assert.equal(chatCalls, callsBeforeRule, '棋規捷徑不呼叫模型')

    const limited = await runLiveCase(opening!, 'vendor/limited:free', deps)
    assert.equal(limited.answerKind, 'error', '每日額度用完不偽裝成摘要')
    assert.ok(limited.error && !limited.error.includes('secret detail'))

    const rows: LiveRow[] = [ok, ruleRow, limited]
    const report = formatLiveReport(rows)
    assert.ok(report.includes('| 局面 | 模型 | 交付 | 呼叫 | 秒 | 棋理正確 | 有回答到問題 | 好懂 | 沒有廢話 | 備註 |'))
    assert.ok(report.includes('交付率（AI 或摘要，110 秒內）：67%'))
    assert.ok(report.includes('AI 答案比例（不含棋規捷徑）：50%'))
    assert.ok(report.includes('外洩內部格式：0 則'))
    assert.ok(report.includes('### opening-inaccuracy · vendor/good:free'))
    assert.ok(!report.includes(FAKE_KEY) && !report.includes('sk-or-v1'), '報表不得含金鑰')
    assert.ok(!report.includes('secret detail'), '報表不得含服務回應原文')

    const leaky = formatLiveReport([{ ...ok, answer: '主線 h2e2 之後' }])
    assert.ok(leaky.includes('外洩內部格式：1 則'))

    console.log('explain-v2-live self-test passed')
  } finally {
    await new Promise<void>((done) => server.close(() => done()))
  }
}

main().catch((error: unknown) => {
  console.error(error)
  process.exitCode = 1
})
