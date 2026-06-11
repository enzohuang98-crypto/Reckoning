/**
 * AI Provider / ModelRegistry 測試（以本機 HTTP server 模擬 API）。
 *
 * 執行：npx tsx --tsconfig tsconfig.node.json tests/providers.test.ts
 *
 * 涵蓋：
 *  - §2.17.9 AIExplanationRequest 新契約（provider/model/apiKey/prompt）
 *  - 請求 URL / 認證 header / body 形狀與回應解析
 *  - §2.17.4 streaming 介面（包裝模式：單一 text_delta + done）與 AbortSignal
 *  - §2.19 ModelRegistry：getModel / hasModel / getDefaultModel / UnsupportedModelError
 *  - 成本估算與 model_pricing.json 一致（§2.19.4）
 */

import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { OpenAIProvider } from '../src/main/ai/providers/OpenAIProvider'
import { GeminiProvider } from '../src/main/ai/providers/GeminiProvider'
import { modelRegistry, UnsupportedModelError } from '../src/main/ai/ModelRegistry'
import { estimateCost } from '../src/main/ai/cost'
import type { AIExplanationRequest } from '../src/shared/types/AIExplanationTypes'
import type { AIExplanationStreamChunk } from '../src/shared/types/AIProviderTypes'

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

const PROMPT = '【引擎分析數據】引擎最佳著法：h2e2　評估 +0.42（測試 prompt）'

/** §2.17.9 契約：prompt 已由 main process 組裝，request 只帶字串 */
function explanationRequest(
  provider: 'openai' | 'gemini',
  model: string,
  apiKey: string
): AIExplanationRequest {
  return {
    provider,
    model,
    apiKey,
    prompt: PROMPT,
    metadata: {
      requestId: 'req-test',
      analysisId: 'analysis-test',
      userLevel: 'intermediate',
      explanationStyle: 'long_analytical'
    }
  }
}

interface OpenAIRequestBody {
  model?: string
  max_tokens?: number
  temperature?: number
  messages?: Array<{ role?: string; content?: string }>
}

interface GeminiRequestBody {
  contents?: Array<{ role?: string; parts?: Array<{ text?: string }> }>
  generationConfig?: { maxOutputTokens?: number; temperature?: number }
}

async function collect(
  iterable: AsyncIterable<AIExplanationStreamChunk>
): Promise<AIExplanationStreamChunk[]> {
  const chunks: AIExplanationStreamChunk[] = []
  for await (const chunk of iterable) chunks.push(chunk)
  return chunks
}

async function main(): Promise<void> {
  section('ModelRegistry（§2.19）')
  {
    const sonnet = modelRegistry.getModel('anthropic', 'claude-sonnet-4-6')
    check('getModel 回傳完整設定', sonnet.pricing.inputPricePerMillionTokens === 3.0 && sonnet.pricing.outputPricePerMillionTokens === 15.0)
    check('lastUpdated 與 sourceNote 必備（§2.19.4）', sonnet.lastUpdated.length > 0 && sonnet.sourceNote.length > 0)
    check('hasModel true', modelRegistry.hasModel('openai', 'gpt-5.4'))
    check('hasModel false（跨 provider 不混用）', !modelRegistry.hasModel('openai', 'claude-sonnet-4-6'))
    check('預設模型：anthropic → claude-sonnet-4-6', modelRegistry.getDefaultModel('anthropic').model === 'claude-sonnet-4-6')
    check('預設模型：openai → gpt-5.4', modelRegistry.getDefaultModel('openai').model === 'gpt-5.4')
    check('預設模型：gemini → gemini-3.5-flash', modelRegistry.getDefaultModel('gemini').model === 'gemini-3.5-flash')
    check('listModels(provider) 過濾', modelRegistry.listModels('gemini').length === 3)
    check('SDS §2.19.2 共 11 個模型', modelRegistry.listModels().length === 11)
    check(
      'gemini-3.1-pro 帶分層定價 contextNote',
      (modelRegistry.getModel('gemini', 'gemini-3.1-pro').contextNote ?? '').includes('分層')
    )
    let err: unknown = null
    try {
      modelRegistry.getModel('openai', 'gpt-邪魔歪道')
    } catch (e) {
      err = e
    }
    check('未知模型丟 UnsupportedModelError', err instanceof UnsupportedModelError)
  }

  section('TokenCostEstimator（§2.19.4：與 registry 同一份定價）')
  {
    const usage = { inputTokens: 1_000_000, outputTokens: 1_000_000 }
    check('claude-sonnet-4-6 = $18/M+M', estimateCost('claude-sonnet-4-6', usage) === 18)
    check('gpt-5.4 = $17.5/M+M', estimateCost('gpt-5.4', usage) === 17.5)
    check('未知模型 → undefined（顯示無法估算）', estimateCost('no-such-model', usage) === undefined)
  }

  section('OpenAIProvider：成功路徑')
  {
    const { server, port, requests } = await startMockServer(() => [
      200,
      {
        choices: [{ message: { role: 'assistant', content: '  紅方優勢，建議炮二平五。  ' } }],
        usage: { prompt_tokens: 100, completion_tokens: 50 }
      }
    ])
    const provider = new OpenAIProvider({ baseUrl: `http://127.0.0.1:${port}/v1` })
    const res = await provider.generateExplanation(
      explanationRequest('openai', 'gpt-5.4', 'sk-test-123')
    )
    server.close()

    check('呼叫 /v1/chat/completions', requests[0].url === '/v1/chat/completions', requests[0].url)
    check('Bearer 認證 header', requests[0].headers.authorization === 'Bearer sk-test-123')
    const body = requests[0].body as OpenAIRequestBody
    check('body.model 正確', body.model === 'gpt-5.4')
    check(
      '單一 user 訊息帶完整 prompt（§2.17.9）',
      body.messages?.length === 1 && body.messages[0].role === 'user' && body.messages[0].content === PROMPT,
      body.messages?.map((m) => m.role)
    )
    check('回應文字已修剪', res.text === '紅方優勢，建議炮二平五。')
    check('token 用量解析', res.usage?.inputTokens === 100 && res.usage.outputTokens === 50)
    check('成本估算（gpt-5.4 有定價）', res.costUsd !== undefined && res.costUsd > 0, res.costUsd)
    check('groundedOnEngineData 旗標', res.groundedOnEngineData === true)
  }

  section('OpenAIProvider：streaming 包裝（§2.17.4、§2.17.1）')
  {
    const { server, port } = await startMockServer(() => [
      200,
      {
        choices: [{ message: { content: '分析文字' } }],
        usage: { prompt_tokens: 10, completion_tokens: 5 }
      }
    ])
    const provider = new OpenAIProvider({ baseUrl: `http://127.0.0.1:${port}/v1` })
    const chunks = await collect(
      provider.generateExplanationStream(
        explanationRequest('openai', 'gpt-5.4', 'sk-test'),
        new AbortController().signal
      )
    )
    server.close()
    check('包裝模式：text_delta + done 兩個 chunk', chunks.length === 2)
    check(
      'text_delta 帶完整文字',
      chunks[0].type === 'text_delta' && chunks[0].deltaText === '分析文字'
    )
    check(
      'done 帶 usage 與 estimatedCostUsd',
      chunks[1].type === 'done' &&
        chunks[1].usage?.inputTokens === 10 &&
        typeof chunks[1].estimatedCostUsd === 'number'
    )
  }

  section('OpenAIProvider：AbortSignal 取消')
  {
    const { server, port } = await startMockServer(() => [200, { choices: [] }])
    const provider = new OpenAIProvider({ baseUrl: `http://127.0.0.1:${port}/v1` })
    const controller = new AbortController()
    controller.abort()
    let err: unknown = null
    try {
      await collect(
        provider.generateExplanationStream(
          explanationRequest('openai', 'gpt-5.4', 'sk-test'),
          controller.signal
        )
      )
    } catch (e) {
      err = e
    }
    server.close()
    check(
      '已 abort 的 signal → AbortError',
      err instanceof Error && err.name === 'AbortError',
      err instanceof Error ? err.name : err
    )
  }

  section('OpenAIProvider：API 錯誤')
  {
    const { server, port } = await startMockServer(() => [
      401,
      { error: { message: 'Incorrect API key provided' } }
    ])
    const provider = new OpenAIProvider({ baseUrl: `http://127.0.0.1:${port}/v1` })
    let message = ''
    try {
      await provider.generateExplanation(explanationRequest('openai', 'gpt-5.4', 'sk-bad'))
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
    const provider = new GeminiProvider({ baseUrl: `http://127.0.0.1:${port}` })
    const res = await provider.generateExplanation(
      explanationRequest('gemini', 'gemini-3.5-flash', 'AIza-test')
    )
    server.close()

    check(
      '呼叫 models/<model>:generateContent',
      requests[0].url === '/models/gemini-3.5-flash:generateContent',
      requests[0].url
    )
    check('x-goog-api-key header', requests[0].headers['x-goog-api-key'] === 'AIza-test')
    check('金鑰不在 URL query（§2.11）', !requests[0].url.includes('AIza-test'))
    const body = requests[0].body as GeminiRequestBody
    check(
      'contents 為 user 訊息帶完整 prompt',
      body.contents?.[0]?.role === 'user' && body.contents[0].parts?.[0]?.text === PROMPT
    )
    check(
      'generationConfig 帶 maxOutputTokens 與 temperature',
      body.generationConfig?.maxOutputTokens === 4096 && body.generationConfig.temperature === 0.3,
      body.generationConfig
    )
    check('回應文字解析', res.text === '黑方應跳馬防守。')
    check('token 用量解析', res.usage?.inputTokens === 80 && res.usage.outputTokens === 30)
    check('成本估算（gemini-3.5-flash 有定價）', res.costUsd !== undefined && res.costUsd > 0)
  }

  section('GeminiProvider：streaming 包裝與空回應防護')
  {
    const { server, port } = await startMockServer(() => [
      200,
      {
        candidates: [{ content: { parts: [{ text: '解說' }] } }],
        usageMetadata: { promptTokenCount: 8, candidatesTokenCount: 3 }
      }
    ])
    const provider = new GeminiProvider({ baseUrl: `http://127.0.0.1:${port}` })
    const chunks = await collect(
      provider.generateExplanationStream(
        explanationRequest('gemini', 'gemini-3.5-flash', 'AIza-test'),
        new AbortController().signal
      )
    )
    server.close()
    check(
      'streaming：text_delta + done',
      chunks.length === 2 && chunks[0].type === 'text_delta' && chunks[1].type === 'done'
    )

    const empty = await startMockServer(() => [200, { candidates: [] }])
    const provider2 = new GeminiProvider({ baseUrl: `http://127.0.0.1:${empty.port}` })
    let message = ''
    try {
      await provider2.generateExplanation(
        explanationRequest('gemini', 'gemini-3.5-flash', 'AIza-test')
      )
    } catch (err) {
      message = err instanceof Error ? err.message : String(err)
    }
    empty.server.close()
    check('空 candidates 拋出明確錯誤', message.includes('沒有文字內容'), message)
  }

  console.log(`\n結果：${passed} 通過，${failed} 失敗`)
  if (failed > 0) process.exit(1)
}

main().catch((err) => {
  console.error('測試執行失敗：', err)
  process.exit(1)
})
