/**
 * AI Provider / ModelRegistry 測試（以本機 HTTP server 模擬 API）。
 *
 * 執行：npx tsx --tsconfig tsconfig.node.json tests/unit/main/providers.test.ts
 *
 * 涵蓋：
 *  - §2.17.9 AIExplanationRequest 新契約（provider/model/apiKey/prompt）
 *  - 請求 URL / 認證 header / body 形狀與回應解析
 *  - §2.17.4 streaming 介面（包裝模式：單一 text_delta + done）與 AbortSignal
 *  - ModelRegistry：getModel / hasModel / getDefaultModel / UnsupportedModelError
 *  - 價目表移除後 provider 只回報 token 用量
 */

import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { AnthropicProvider } from '../../../src/main/ai/providers/AnthropicProvider'
import { OpenAIProvider } from '../../../src/main/ai/providers/OpenAIProvider'
import { OpenAICompatibleProvider } from '../../../src/main/ai/providers/OpenAICompatibleProvider'
import {
  extractApiErrorMessage,
  readJsonResponseBounded
} from '../../../src/main/ai/http'
import { GeminiProvider } from '../../../src/main/ai/providers/GeminiProvider'
import { modelRegistry, UnsupportedModelError } from '../../../src/main/ai/ModelRegistry'
import type { AIExplanationRequest } from '../../../src/shared/types/AIExplanationTypes'
import {
  AI_COMPATIBLE_PRESETS,
  PROVIDER_DEFAULT_MODELS,
  type AIExplanationStreamChunk
} from '../../../src/shared/types/AIProviderTypes'
import {
  KeyedOperationGate,
  OperationBusyError
} from '../../../src/main/security/KeyedOperationGate'

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

/** 啟動一個永不回應的 server，用來模擬 testCredential 逾時情境 */
function startHangingServer(): Promise<{ server: Server; port: number }> {
  const server = createServer(() => {
    /* 故意不回應，讓呼叫端的 AbortSignal.timeout 觸發 */
  })
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      const port = typeof address === 'object' && address ? address.port : 0
      resolve({ server, port })
    })
  })
}

const PROMPT = '【引擎分析數據】引擎最佳著法：h2e2　評估 +0.42（測試 prompt）'

/** §2.17.9 契約：prompt 已由 main process 組裝，request 只帶字串 */
function explanationRequest(
  provider: 'anthropic' | 'openai' | 'gemini' | 'openai-compatible',
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
  max_completion_tokens?: number
  max_output_tokens?: number
  temperature?: number
  reasoning_effort?: string
  reasoning?: { effort?: string }
  input?: string
  store?: boolean
  response_format?: { type?: string }
  messages?: Array<{ role?: string; content?: string }>
}

interface GeminiRequestBody {
  contents?: Array<{ role?: string; parts?: Array<{ text?: string }> }>
  generationConfig?: {
    maxOutputTokens?: number
    temperature?: number
    thinkingConfig?: { thinkingLevel?: string; includeThoughts?: boolean }
    responseMimeType?: string
  }
}

async function collect(
  iterable: AsyncIterable<AIExplanationStreamChunk>
): Promise<AIExplanationStreamChunk[]> {
  const chunks: AIExplanationStreamChunk[] = []
  for await (const chunk of iterable) chunks.push(chunk)
  return chunks
}

async function main(): Promise<void> {
  section('昂貴操作 admission control')
  {
    const gate = new KeyedOperationGate(2)
    let releaseFirst!: () => void
    let releaseSecond!: () => void
    let firstCalls = 0
    const first = gate.run('first', async () => {
      firstCalls += 1
      await new Promise<void>((resolve) => {
        releaseFirst = resolve
      })
      return 'first-result'
    })
    const duplicate = gate.run('first', async () => 'must-not-run')
    const second = gate.run('second', async () => {
      await new Promise<void>((resolve) => {
        releaseSecond = resolve
      })
      return 'second-result'
    })
    let busy = false
    try {
      await gate.run('third', async () => 'third-result')
    } catch (error) {
      busy = error instanceof OperationBusyError
    }
    check('相同工作共用一個 in-flight promise', first === duplicate && firstCalls === 1)
    check('超過全域上限時立即回報 busy', busy && gate.activeCount() === 2)
    releaseFirst()
    releaseSecond()
    check(
      '完成後正確釋放 admission capacity',
      (await first) === 'first-result' &&
        (await duplicate) === 'first-result' &&
        (await second) === 'second-result' &&
        gate.activeCount() === 0
    )
  }

  section('ModelRegistry')
  {
    const sonnet = modelRegistry.getModel('anthropic', 'claude-sonnet-4-6')
    check('getModel 回傳模型目錄資料', sonnet.displayName === 'Claude Sonnet 4.6')
    check('Anthropic 新模型可選用',
      modelRegistry.hasModel('anthropic', 'claude-fable-5') &&
      modelRegistry.hasModel('anthropic', 'claude-sonnet-5') &&
      modelRegistry.hasModel('anthropic', 'claude-opus-4-6'))
    check('hasModel true', modelRegistry.hasModel('openai', 'gpt-5.4'))
    check('hasModel false（跨 provider 不混用）', !modelRegistry.hasModel('openai', 'claude-sonnet-4-6'))
    check('預設模型：anthropic → claude-sonnet-5', modelRegistry.getDefaultModel('anthropic').model === 'claude-sonnet-5')
    check('預設模型：openai → gpt-5.6-sol', modelRegistry.getDefaultModel('openai').model === 'gpt-5.6-sol')
    check('預設模型：gemini → gemini-3.5-flash', modelRegistry.getDefaultModel('gemini').model === 'gemini-3.5-flash')
    check('listModels(provider) 過濾', modelRegistry.listModels('gemini').length === 9)
    check('模型目錄共 38 個模型', modelRegistry.listModels().length === 38)
    const officialProviders = ['anthropic', 'openai', 'gemini'] as const
    const uiModels = officialProviders.flatMap((provider) =>
      PROVIDER_DEFAULT_MODELS[provider].map((model) => `${provider}/${model.id}`)
    )
    const catalogModels = modelRegistry
      .listModels()
      .map((model) => `${model.provider}/${model.model}`)
    check(
      '官方模型目錄與設定頁選項完全一致',
      uiModels.length === catalogModels.length &&
        uiModels.every((model) => catalogModels.includes(model))
    )
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

  section('AnthropicProvider：請求形狀與成功路徑')
  {
    const { server, port, requests } = await startMockServer(() => [
      200,
      {
        id: 'msg_test',
        type: 'message',
        role: 'assistant',
        content: [{ type: 'text', text: '紅方優勢，建議炮二平五。' }],
        model: 'claude-sonnet-4-6',
        stop_reason: 'end_turn',
        stop_sequence: null,
        usage: { input_tokens: 120, output_tokens: 40 }
      }
    ])
    const provider = new AnthropicProvider({ baseUrl: `http://127.0.0.1:${port}` })
    const res = await provider.generateExplanation(
      explanationRequest('anthropic', 'claude-sonnet-4-6', 'sk-ant-test-123')
    )
    server.close()

    check('呼叫 /v1/messages', requests[0].url === '/v1/messages', requests[0].url)
    check('x-api-key 認證 header', requests[0].headers['x-api-key'] === 'sk-ant-test-123')
    const body = requests[0].body as {
      model?: string
      max_tokens?: number
      messages?: Array<{ role?: string; content?: string }>
    }
    check('body.model 正確', body.model === 'claude-sonnet-4-6')
    check(
      '單一 user 訊息帶完整 prompt（§2.17.9）',
      body.messages?.length === 1 &&
        body.messages[0].role === 'user' &&
        body.messages[0].content === PROMPT
    )
    check('回應文字解析', res.text === '紅方優勢，建議炮二平五。')
    check('token 用量解析', res.usage?.inputTokens === 120 && res.usage.outputTokens === 40)
    check('groundedOnEngineData 旗標', res.groundedOnEngineData === true)
  }
  {
    const { server, port } = await startMockServer(() => [
      401,
      { type: 'error', error: { type: 'authentication_error', message: 'invalid x-api-key' } }
    ])
    const provider = new AnthropicProvider({ baseUrl: `http://127.0.0.1:${port}` })
    let message = ''
    try {
      await provider.generateExplanation(
        explanationRequest('anthropic', 'claude-sonnet-4-6', 'sk-ant-bad')
      )
    } catch (err) {
      message = err instanceof Error ? err.message : String(err)
    }
    server.close()
    check('錯誤含狀態碼', message.includes('401'), message)
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
  {
    const abort = new DOMException('cancelled while reading error body', 'AbortError')
    const response = new Response(
      new ReadableStream<Uint8Array>({
        start(controller) {
          controller.error(abort)
        }
      }),
      { status: 503, statusText: 'Service Unavailable' }
    )
    let error: unknown = null
    try {
      await extractApiErrorMessage(response)
    } catch (caught) {
      error = caught
    }
    check(
      '讀取非 2xx 錯誤 body 時的 AbortError 不會被 statusText 吞掉',
      error === abort
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
    check('GPT-5 不傳 temperature', body.temperature === undefined)
    check('GPT-5 使用 reasoning none', body.reasoning_effort === 'none')
    check('使用 max_completion_tokens', body.max_completion_tokens === 4096)
    check(
      '單一 user 訊息帶完整 prompt（§2.17.9）',
      body.messages?.length === 1 && body.messages[0].role === 'user' && body.messages[0].content === PROMPT,
      body.messages?.map((m) => m.role)
    )
    check('回應文字已修剪', res.text === '紅方優勢，建議炮二平五。')
    check('token 用量解析', res.usage?.inputTokens === 100 && res.usage.outputTokens === 50)
    check('groundedOnEngineData 旗標', res.groundedOnEngineData === true)
  }

  {
    const { server, port, requests } = await startMockServer(() => [
      200,
      {
        output: [
          {
            type: 'message',
            content: [{ type: 'output_text', text: 'GPT-5.6 模型解說' }]
          }
        ],
        usage: { input_tokens: 10, output_tokens: 6 }
      }
    ])
    const provider = new OpenAIProvider({ baseUrl: `http://127.0.0.1:${port}/v1` })
    const response = await provider.generateExplanation(
      explanationRequest('openai', 'gpt-5.6-sol', 'sk-56-test')
    )
    server.close()
    const body = requests[0].body as OpenAIRequestBody
    check('GPT-5.6 系列走 Responses API', requests[0].url === '/v1/responses')
    check('GPT-5.6 Responses 使用 reasoning none', body.reasoning?.effort === 'none')
    check('GPT-5.6 Responses 解析 output_text', response.text === 'GPT-5.6 模型解說')
  }

  {
    const { server, port, requests } = await startMockServer(() => [
      200,
      {
        output: [
          { type: 'reasoning', content: [{ type: 'summary_text', text: 'hidden' }] },
          {
            type: 'message',
            content: [{ type: 'output_text', text: 'Pro 模型解說' }]
          }
        ],
        usage: { input_tokens: 12, output_tokens: 7 }
      }
    ])
    const provider = new OpenAIProvider({ baseUrl: `http://127.0.0.1:${port}/v1` })
    const response = await provider.generateExplanation(
      explanationRequest('openai', 'gpt-5.5-pro', 'sk-pro-test')
    )
    server.close()
    const body = requests[0].body as OpenAIRequestBody
    check('Pro 模型走 Responses API', requests[0].url === '/v1/responses')
    check(
      'Responses API 使用 input 與 max_output_tokens',
      body.input === PROMPT && body.max_output_tokens === 4096
    )
    check('Responses 不儲存測試輸入', body.store === false)
    check('Responses 只解析 output_text', response.text === 'Pro 模型解說')
    check(
      'Responses token 用量正規化',
      response.usage?.inputTokens === 12 && response.usage.outputTokens === 7
    )
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
        candidates: [{
          content: {
            role: 'model',
            parts: [
              { text: '內部推理不應顯示。', thought: true },
              { text: '黑方應跳馬防守。' }
            ]
          }
        }],
        usageMetadata: {
          promptTokenCount: 80,
          candidatesTokenCount: 30,
          thoughtsTokenCount: 12,
          totalTokenCount: 122
        }
      }
    ])
    const provider = new GeminiProvider({ baseUrl: `http://127.0.0.1:${port}` })
    const request = explanationRequest('gemini', 'gemini-3.5-flash', 'AIza-test')
    request.responseFormat = 'json'
    const res = await provider.generateExplanation(request)
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
      'Gemini 3.x 保留模型預設 temperature',
      body.generationConfig?.maxOutputTokens === 4096 &&
        body.generationConfig.temperature === undefined,
      body.generationConfig
    )
    check(
      'Gemini 使用低延遲 thinking 且不回傳推理內容',
      body.generationConfig?.thinkingConfig?.thinkingLevel === 'low' &&
        body.generationConfig.thinkingConfig.includeThoughts === false,
      body.generationConfig?.thinkingConfig
    )
    check(
      'JSON 請求使用 generateContent 實際支援的 application/json MIME type',
      body.generationConfig?.responseMimeType === 'application/json',
      body.generationConfig
    )
    check('回應文字解析並排除 thought parts', res.text === '黑方應跳馬防守。')
    check(
      'token 用量解析包含 Gemini thinking tokens',
      res.usage?.inputTokens === 80 && res.usage.outputTokens === 42
    )
  }
  {
    const { server, port, requests } = await startMockServer(() => [
      200,
      { candidates: [{ content: { parts: [{ text: '舊版模型回應' }] } }] }
    ])
    const provider = new GeminiProvider({ baseUrl: `http://127.0.0.1:${port}` })
    await provider.generateExplanation(
      explanationRequest('gemini', 'gemini-2.5-flash', 'AIza-test')
    )
    server.close()
    const body = requests[0].body as GeminiRequestBody
    check(
      'Gemini 2.5 不會收到僅適用 3.x 的 thinkingLevel',
      body.generationConfig?.thinkingConfig === undefined,
      body.generationConfig
    )
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

  section('AnthropicProvider：testCredential')
  {
    const { server, port, requests } = await startMockServer(() => [
      200,
      {
        id: 'msg_test',
        type: 'message',
        role: 'assistant',
        model: 'claude-sonnet-5',
        content: [{ type: 'text', text: 'OK' }],
        stop_reason: 'end_turn',
        usage: { input_tokens: 5, output_tokens: 1 }
      }
    ])
    const provider = new AnthropicProvider({ baseUrl: `http://127.0.0.1:${port}` })
    const result = await provider.testCredential('sk-ant-valid', 'claude-sonnet-5')
    server.close()
    check('成功時 ok=true', result.ok === true, result)
    check('實際呼叫 Messages API', requests[0].url === '/v1/messages', requests[0])
  }
  {
    const { server, port } = await startMockServer(() => [
      401,
      { type: 'error', error: { type: 'authentication_error', message: 'invalid x-api-key' } }
    ])
    const provider = new AnthropicProvider({ baseUrl: `http://127.0.0.1:${port}` })
    const result = await provider.testCredential('sk-ant-bad', 'claude-sonnet-5')
    server.close()
    check(
      '401 時 ok=false 且訊息提及認證失敗',
      result.ok === false && result.message.includes('認證失敗'),
      result
    )
  }
  {
    const { server, port } = await startHangingServer()
    const provider = new AnthropicProvider({ baseUrl: `http://127.0.0.1:${port}` })
    const result = await provider.testCredential(
      'sk-ant-slow',
      'claude-sonnet-5',
      undefined,
      200
    )
    server.close()
    check(
      '逾時時 ok=false 且訊息提及逾時',
      result.ok === false && result.message.includes('逾時'),
      result
    )
  }
  {
    const oversizedText = 'x'.repeat(5 * 1024 * 1024 + 1)
    const { server, port } = await startMockServer(() => [
      200,
      {
        id: 'msg_oversized',
        type: 'message',
        role: 'assistant',
        model: 'claude-sonnet-5',
        content: [{ type: 'text', text: oversizedText }],
        stop_reason: 'end_turn',
        usage: { input_tokens: 5, output_tokens: 1 }
      }
    ])
    const provider = new AnthropicProvider({ baseUrl: `http://127.0.0.1:${port}` })
    let bounded = false
    try {
      await provider.generateExplanation(
        explanationRequest('anthropic', 'claude-sonnet-5', 'sk-ant-test')
      )
    } catch (error) {
      bounded =
        error instanceof Error &&
        error.message.includes('超過允許大小')
    }
    server.close()
    check('Anthropic 在 SDK 解析前拒絕超過 5 MiB 的回應', bounded)
  }

  section('OpenAIProvider：testCredential')
  {
    const { server, port, requests } = await startMockServer(() => [
      200,
      { choices: [{ message: { content: 'OK' } }], usage: {} }
    ])
    const provider = new OpenAIProvider({ baseUrl: `http://127.0.0.1:${port}/v1` })
    const result = await provider.testCredential('sk-test-valid', 'gpt-5.4')
    server.close()
    check('成功時 ok=true', result.ok === true, result)
    check(
      '實際呼叫 Chat Completions API',
      requests[0].url === '/v1/chat/completions',
      requests[0]
    )
  }
  {
    const { server, port } = await startMockServer(() => [
      401,
      { error: { message: 'Incorrect API key provided' } }
    ])
    const provider = new OpenAIProvider({ baseUrl: `http://127.0.0.1:${port}/v1` })
    const result = await provider.testCredential('sk-bad', 'gpt-5.4')
    server.close()
    check(
      '401 時 ok=false 且訊息提及認證失敗',
      result.ok === false && result.message.includes('認證失敗'),
      result
    )
  }
  {
    const { server, port } = await startHangingServer()
    const provider = new OpenAIProvider({ baseUrl: `http://127.0.0.1:${port}/v1` })
    const result = await provider.testCredential(
      'sk-slow',
      'gpt-5.4',
      undefined,
      200
    )
    server.close()
    check(
      '逾時時 ok=false 且訊息提及逾時',
      result.ok === false && result.message.includes('逾時'),
      result
    )
  }

  section('GeminiProvider：testCredential')
  {
    const { server, port, requests } = await startMockServer(() => [
      200,
      {
        candidates: [{ content: { parts: [{ text: 'OK' }] } }],
        usageMetadata: {}
      }
    ])
    const provider = new GeminiProvider({ baseUrl: `http://127.0.0.1:${port}` })
    const result = await provider.testCredential('AIza-valid', 'gemini-3.5-flash')
    server.close()
    check('成功時 ok=true', result.ok === true, result)
    check('x-goog-api-key header', requests[0].headers['x-goog-api-key'] === 'AIza-valid')
    check('金鑰不在 URL query（§2.11）', !requests[0].url.includes('AIza-valid'))
    check(
      '實際呼叫 generateContent API',
      requests[0].url.includes(':generateContent'),
      requests[0]
    )
  }
  {
    const { server, port } = await startMockServer(() => [
      401,
      { error: { message: 'API key not valid' } }
    ])
    const provider = new GeminiProvider({ baseUrl: `http://127.0.0.1:${port}` })
    const result = await provider.testCredential('AIza-bad', 'gemini-3.5-flash')
    server.close()
    check(
      '401 時 ok=false 且訊息提及認證失敗',
      result.ok === false && result.message.includes('認證失敗'),
      result
    )
  }
  {
    const { server, port } = await startHangingServer()
    const provider = new GeminiProvider({ baseUrl: `http://127.0.0.1:${port}` })
    const result = await provider.testCredential(
      'AIza-slow',
      'gemini-3.5-flash',
      undefined,
      200
    )
    server.close()
    check(
      '逾時時 ok=false 且訊息提及逾時',
      result.ok === false && result.message.includes('逾時'),
      result
    )
  }

  section('OpenAICompatibleProvider：testCredential')
  {
    const { server, port, requests } = await startMockServer(() => [
      200,
      { choices: [{ message: { content: 'OK' } }] }
    ])
    const provider = new OpenAICompatibleProvider()
    const result = await provider.testCredential(
      'local-token',
      'local-model',
      `http://127.0.0.1:${port}/v1`
    )
    server.close()
    check('成功時 ok=true', result.ok === true, result)
    check(
      '實際呼叫相容 Chat Completions API',
      requests[0].url === '/v1/chat/completions',
      requests[0]
    )
  }
  {
    const { server, port } = await startMockServer(() => [404, { error: 'not found' }])
    const provider = new OpenAICompatibleProvider()
    const result = await provider.testCredential(
      'some-token',
      'local-model',
      `http://127.0.0.1:${port}/v1`
    )
    server.close()
    check(
      '404 生成失敗時不得假裝模型可用',
      result.ok === false && result.message.includes('(404)'),
      result
    )
  }
  {
    const { server, port } = await startMockServer(() => [
      401,
      { error: { message: 'invalid token' } }
    ])
    const provider = new OpenAICompatibleProvider()
    const result = await provider.testCredential(
      'bad-token',
      'local-model',
      `http://127.0.0.1:${port}/v1`
    )
    server.close()
    check(
      '401 時 ok=false 且訊息提及認證失敗',
      result.ok === false && result.message.includes('認證失敗'),
      result
    )
  }
  {
    const { server, port } = await startHangingServer()
    const provider = new OpenAICompatibleProvider()
    const result = await provider.testCredential(
      'slow-token',
      'local-model',
      `http://127.0.0.1:${port}/v1`,
      200
    )
    server.close()
    check(
      '逾時時 ok=false 且訊息提及逾時',
      result.ok === false && result.message.includes('逾時'),
      result
    )
  }
  {
    const provider = new OpenAICompatibleProvider()
    const result = await provider.testCredential('any-token', 'local-model')
    check(
      '未設定端點時明確拒絕',
      result.ok === false && result.message.includes('尚未設定'),
      result
    )
  }
  {
    let redirectedRequests = 0
    const destination = createServer((_req, res) => {
      redirectedRequests += 1
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ choices: [{ message: { content: 'OK' } }] }))
    })
    await new Promise<void>((resolve) =>
      destination.listen(0, '127.0.0.1', () => resolve())
    )
    const destinationAddress = destination.address()
    const destinationPort =
      typeof destinationAddress === 'object' && destinationAddress
        ? destinationAddress.port
        : 0
    const redirector = createServer((_req, res) => {
      res.writeHead(307, {
        location: `http://127.0.0.1:${destinationPort}/redirected`
      })
      res.end()
    })
    await new Promise<void>((resolve) =>
      redirector.listen(0, '127.0.0.1', () => resolve())
    )
    const redirectAddress = redirector.address()
    const redirectPort =
      typeof redirectAddress === 'object' && redirectAddress
        ? redirectAddress.port
        : 0
    const provider = new OpenAICompatibleProvider()
    const result = await provider.testCredential(
      'local-token',
      'local-model',
      `http://127.0.0.1:${redirectPort}/v1`
    )
    redirector.close()
    destination.close()
    check(
      '相容端點重新導向會 fail closed，不送出第二跳請求',
      result.ok === false && redirectedRequests === 0,
      { result, redirectedRequests }
    )
  }

  console.log(`\n結果：${passed} 通過，${failed} 失敗`)
  if (failed > 0) process.exit(1)
}

main().catch((err) => {
  console.error('測試執行失敗：', err)
  process.exit(1)
})
