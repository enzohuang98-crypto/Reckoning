/**
 * OpenAI / Gemini Provider 測試（以本機 HTTP server 模擬 API）。
 *
 * 執行：npx tsx --tsconfig tsconfig.node.json tests/providers.test.ts
 *
 * 涵蓋：請求 URL / 認證 header / body 形狀（model、system+user 訊息、generationConfig）、
 * 回應文字與 token 用量解析、成本估算、API 錯誤訊息萃取。
 */

import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { OpenAIProvider } from '../src/main/ai/providers/OpenAIProvider'
import { GeminiProvider } from '../src/main/ai/providers/GeminiProvider'
import type { AIExplanationRequest } from '../src/shared/types/AIExplanationTypes'
import type { EngineAnalysis, EngineLine } from '../src/shared/types/EngineAnalysis'
import { START_FEN } from '../src/shared/types/BoardState'

let passed = 0
let failed = 0

function check(name: string, cond: boolean, detail?: unknown): void {
  if (cond) {
    passed++
    console.log(`  ✓ ${name}`)
  } else {
    failed++
    console.error(`  ✗ ${name}${detail !== undefined ? ` — ${JSON.stringify(detail)}` : ''}`)
  }
}

function section(title: string): void {
  console.log(`\n## ${title}`)
}

/** 收到的請求記錄 */
interface RecordedRequest {
  url: string
  headers: IncomingMessage['headers']
  body: unknown
}

/** 啟動一次性模擬 API server；handler 回傳 [status, responseBody] */
function startMockServer(
  handler: (req: RecordedRequest) => [number, unknown]
): Promise<{ server: Server; port: number; requests: RecordedRequest[] }> {
  const requests: RecordedRequest[] = []
  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    let raw = ''
    req.on('data', (chunk: string | Buffer) => {
      raw += String(chunk)
    })
    req.on('end', () => {
      const recorded: RecordedRequest = {
        url: req.url ?? '',
        headers: req.headers,
        body: raw ? JSON.parse(raw) : null
      }
      requests.push(recorded)
      const [status, body] = handler(recorded)
      res.writeHead(status, { 'content-type': 'application/json' })
      res.end(JSON.stringify(body))
    })
  })
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      const port = typeof address === 'object' && address ? address.port : 0
      resolve({ server, port, requests })
    })
  })
}

const dummyLine: EngineLine = {
  multipv: 1,
  depth: 15,
  score: { kind: 'cp', value: 42 },
  pv: ['h2e2', 'h9g7'],
  bestMoveUci: 'h2e2'
}

const dummyAnalysis: EngineAnalysis = {
  fen: START_FEN,
  sideToMove: 'red',
  depth: 15,
  bestMoveUci: 'h2e2',
  bestLine: dummyLine,
  lines: [dummyLine],
  score: { kind: 'cp', value: 42 },
  engineName: 'FakeEngine',
  computedAt: 0
}

function explanationRequest(provider: 'openai' | 'gemini', model: string): AIExplanationRequest {
  return {
    fen: START_FEN,
    sideToMove: 'red',
    engineAnalysis: dummyAnalysis,
    language: 'zh-TW',
    provider,
    model
  }
}

interface OpenAIRequestBody {
  model?: string
  max_tokens?: number
  temperature?: number
  messages?: Array<{ role?: string; content?: string }>
}

interface GeminiRequestBody {
  system_instruction?: { parts?: Array<{ text?: string }> }
  contents?: Array<{ role?: string; parts?: Array<{ text?: string }> }>
  generationConfig?: { maxOutputTokens?: number; temperature?: number }
}

async function main(): Promise<void> {
  section('OpenAIProvider：成功路徑')
  {
    const { server, port, requests } = await startMockServer(() => [
      200,
      {
        choices: [{ message: { role: 'assistant', content: '  紅方優勢，建議炮二平五。  ' } }],
        usage: { prompt_tokens: 100, completion_tokens: 50 }
      }
    ])
    const provider = new OpenAIProvider({
      providerId: 'openai',
      apiKey: 'sk-test-123',
      model: 'gpt-4o',
      baseUrl: `http://127.0.0.1:${port}/v1`
    })
    const res = await provider.generateExplanation(explanationRequest('openai', 'gpt-4o'))
    server.close()

    check('呼叫 /v1/chat/completions', requests[0].url === '/v1/chat/completions', requests[0].url)
    check('Bearer 認證 header', requests[0].headers.authorization === 'Bearer sk-test-123')
    const body = requests[0].body as OpenAIRequestBody
    check('body.model 正確', body.model === 'gpt-4o')
    check(
      'system + user 兩則訊息',
      body.messages?.length === 2 &&
        body.messages[0].role === 'system' &&
        body.messages[1].role === 'user',
      body.messages?.map((m) => m.role)
    )
    check('user prompt 含引擎最佳著法', body.messages?.[1].content?.includes('h2e2') === true)
    check('回應文字已修剪', res.text === '紅方優勢，建議炮二平五。')
    check('token 用量解析', res.usage?.inputTokens === 100 && res.usage.outputTokens === 50)
    check('成本估算（gpt-4o 有定價）', res.costUsd !== undefined && res.costUsd > 0, res.costUsd)
    check('groundedOnEngineData 旗標', res.groundedOnEngineData === true)
  }

  section('OpenAIProvider：API 錯誤')
  {
    const { server, port } = await startMockServer(() => [
      401,
      { error: { message: 'Incorrect API key provided' } }
    ])
    const provider = new OpenAIProvider({
      providerId: 'openai',
      apiKey: 'sk-bad',
      model: 'gpt-4o',
      baseUrl: `http://127.0.0.1:${port}/v1`
    })
    let message = ''
    try {
      await provider.generateExplanation(explanationRequest('openai', 'gpt-4o'))
    } catch (err) {
      message = err instanceof Error ? err.message : String(err)
    }
    server.close()
    check(
      '錯誤含狀態碼與 API 訊息',
      message.includes('401') && message.includes('Incorrect API key'),
      message
    )
  }

  section('GeminiProvider：成功路徑')
  {
    const { server, port, requests } = await startMockServer(() => [
      200,
      {
        candidates: [{ content: { role: 'model', parts: [{ text: '黑方應跳馬防守。' }] } }],
        usageMetadata: { promptTokenCount: 80, candidatesTokenCount: 30, totalTokenCount: 110 }
      }
    ])
    const provider = new GeminiProvider({
      providerId: 'gemini',
      apiKey: 'AIza-test',
      model: 'gemini-2.5-flash',
      baseUrl: `http://127.0.0.1:${port}`
    })
    const res = await provider.generateExplanation(
      explanationRequest('gemini', 'gemini-2.5-flash')
    )
    server.close()

    check(
      '呼叫 models/<model>:generateContent',
      requests[0].url === '/models/gemini-2.5-flash:generateContent',
      requests[0].url
    )
    check('x-goog-api-key header', requests[0].headers['x-goog-api-key'] === 'AIza-test')
    check('金鑰不在 URL query', !requests[0].url.includes('AIza-test'))
    const body = requests[0].body as GeminiRequestBody
    check(
      'system_instruction 存在',
      (body.system_instruction?.parts?.[0]?.text?.length ?? 0) > 0
    )
    check(
      'contents 為 user 訊息且含最佳著法',
      body.contents?.[0]?.role === 'user' &&
        body.contents[0].parts?.[0]?.text?.includes('h2e2') === true
    )
    check(
      'generationConfig 帶 maxOutputTokens 與 temperature',
      body.generationConfig?.maxOutputTokens === 1024 &&
        body.generationConfig.temperature === 0.3,
      body.generationConfig
    )
    check('回應文字解析', res.text === '黑方應跳馬防守。')
    check('token 用量解析', res.usage?.inputTokens === 80 && res.usage.outputTokens === 30)
    check('成本估算（gemini-2.5-flash 有定價）', res.costUsd !== undefined && res.costUsd > 0)
  }

  section('GeminiProvider：空回應防護')
  {
    const { server, port } = await startMockServer(() => [200, { candidates: [] }])
    const provider = new GeminiProvider({
      providerId: 'gemini',
      apiKey: 'AIza-test',
      model: 'gemini-2.5-flash',
      baseUrl: `http://127.0.0.1:${port}`
    })
    let message = ''
    try {
      await provider.generateExplanation(explanationRequest('gemini', 'gemini-2.5-flash'))
    } catch (err) {
      message = err instanceof Error ? err.message : String(err)
    }
    server.close()
    check('空 candidates 拋出明確錯誤', message.includes('沒有文字內容'), message)
  }

  console.log(`\n結果：${passed} 通過，${failed} 失敗`)
  if (failed > 0) process.exit(1)
}

main().catch((err) => {
  console.error('測試執行失敗：', err)
  process.exit(1)
})
