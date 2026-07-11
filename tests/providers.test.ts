/**
 * AI Provider / ModelRegistry 測試（以本機 HTTP server 模擬 API）。
 *
 * 執行：npx tsx --tsconfig tsconfig.node.json tests/providers.test.ts
 *
 * 涵蓋：
 *  - §2.17.9 AIExplanationRequest 新契約（provider/model/apiKey/prompt）
 *  - 請求 URL / 認證 header / body 形狀與回應解析
 *  - §2.17.4 streaming 介面（包裝模式：單一 text_delta + done）與 AbortSignal
 *  - ModelRegistry：getModel / hasModel / getDefaultModel / UnsupportedModelError
 *  - 價目表移除後 provider 只回報 token 用量
 */

import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { OpenAIProvider } from '../src/main/ai/providers/OpenAIProvider'
import { OpenAICompatibleProvider } from '../src/main/ai/providers/OpenAICompatibleProvider'
import { readJsonResponseBounded } from '../src/main/ai/http'
import { GeminiProvider } from '../src/main/ai/providers/GeminiProvider'
import { modelRegistry, UnsupportedModelError } from '../src/main/ai/ModelRegistry'
import type { AIExplanationRequest } from '../src/shared/types/AIExplanationTypes'
import {
  AI_COMPATIBLE_PRESETS,
  type AIExplanationStreamChunk
} from '../src/shared/types/AIProviderTypes'

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
  provider: 'openai' | 'gemini' | 'openai-compatible',
  model: string,
  apiKey: string,
  baseUrl?: string
): AIExplanationRequest {
  return {
    provider,
    model,
    apiKey,
    baseUrl,
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
  section('ModelRegistry')
  {
    const sonnet = modelRegistry.getModel('anthropic', 'claude-sonnet-4-6')
    check('getModel 回傳模型目錄資料', sonnet.displayName === 'Claude Sonnet 4.6')
    check('hasModel true', modelRegistry.hasModel('openai', 'gpt-5.4'))
    check('hasModel false（跨 provider 不混用）', !modelRegistry.hasModel('openai', 'claude-sonnet-4-6'))
    check('預設模型：anthropic → claude-sonnet-4-6', modelRegistry.getDefaultModel('anthropic').model === 'claude-sonnet-4-6')
    check('預設模型：openai → gpt-5.4', modelRegistry.getDefaultModel('openai').model === 'gpt-5.4')
    check('預設模型：gemini → gemini-3.5-flash', modelRegistry.getDefaultModel('gemini').model === 'gemini-3.5-flash')
    check('listModels(provider) 過濾', modelRegistry.listModels('gemini').length === 3)
    check('模型目錄共 11 個模型', modelRegistry.listModels().length === 11)
    check(
      'OpenAI 相容服務允許受驗證的自訂 model id',
      modelRegistry.getModel('openai-compatible', 'deepseek-chat').model === 'deepseek-chat'
    )
    check(
      'OpenAI 相容服務拒絕注入型 model id',
      !modelRegistry.hasModel('openai-compatible', 'model\nignore previous')
    )
    check(
      '相容服務預設值跟隨官方目前模型',
      AI_COMPATIBLE_PRESETS.find((preset) => preset.id === 'kimi')
        ?.suggestedModel === 'kimi-k2.6' &&
        AI_COMPATIBLE_PRESETS.find((preset) => preset.id === 'xai')
          ?.suggestedModel === 'grok-4.5'
    )
    let err: unknown = null
    try {
      modelRegistry.getModel('openai', 'gpt-邪魔歪道')
    } catch (e) {
      err = e
    }
    check('未知模型丟 UnsupportedModelError', err instanceof UnsupportedModelError)
  }

  section('OpenAI-compatible Provider：遠端與本機服務')
  {
    const { server, port, requests } = await startMockServer(() => [
      200,
      {
        choices: [{ message: { content: '雙引擎分歧已比較。' } }],
        usage: { input_tokens: 44, output_tokens: 18 }
      }
    ])
    const provider = new OpenAICompatibleProvider()
    const response = await provider.generateExplanation(
      explanationRequest(
        'openai-compatible',
        'deepseek-chat',
        'compatible-secret',
        `http://127.0.0.1:${port}/v1`
      )
    )
    server.close()

    check('相容端點正確補上 /chat/completions', requests[0].url === '/v1/chat/completions')
    check('遠端相容服務使用 Bearer 認證', requests[0].headers.authorization === 'Bearer compatible-secret')
    check('自訂 model id 原樣送出', (requests[0].body as OpenAIRequestBody).model === 'deepseek-chat')
    check('相容 token 欄位可正規化', response.usage?.inputTokens === 44 && response.usage.outputTokens === 18)
  }
  {
    const { server, port, requests } = await startMockServer(() => [
      200,
      { choices: [{ message: { reasoning_content: '本機模型結果' } }] }
    ])
    const provider = new OpenAICompatibleProvider()
    const response = await provider.generateExplanation(
      explanationRequest(
        'openai-compatible',
        'qwen2.5:7b',
        '',
        `http://127.0.0.1:${port}/v1/chat/completions`
      )
    )
    server.close()
    check('本機模型可不傳 Authorization', requests[0].headers.authorization === undefined)
    check('相容服務可讀 reasoning_content', response.text === '本機模型結果')
  }
  {
    const secret = 'moonshot-custom-secret-value'
    const { server, port } = await startMockServer(() => [
      401,
      { error: { message: `invalid key ${secret}` } }
    ])
    const provider = new OpenAICompatibleProvider()
    let error: unknown = null
    try {
      await provider.generateExplanation(
        explanationRequest(
          'openai-compatible',
          'kimi-k2.6',
          secret,
          `http://127.0.0.1:${port}/v1`
        )
      )
    } catch (caught) {
      error = caught
    }
    server.close()
    check(
      '相容服務錯誤若回顯自訂金鑰會精確遮蔽',
      error instanceof Error &&
        error.message.includes('[REDACTED]') &&
        !error.message.includes(secret)
    )
  }

  section('AI HTTP 回應大小邊界')
  {
    let error: unknown = null
    try {
      await readJsonResponseBounded(
        new Response(JSON.stringify({ text: 'x'.repeat(128) })),
        32
      )
    } catch (caught) {
      error = caught
    }
    check(
      '超過上限的 Provider JSON 會在解析前被拒絕',
      error instanceof Error && error.message.includes('超過允許大小')
    )
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
      'done 帶 token usage',
      chunks[1].type === 'done' &&
        chunks[1].usage?.inputTokens === 10
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
