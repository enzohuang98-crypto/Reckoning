import assert from 'node:assert/strict'
import { createServer, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { OpenRouterProvider } from '../../../src/main/ai/providers/OpenRouterProvider'
import {
  AIHttpError,
  AIResponseValidationError,
  describeAIExecutionError,
  describeCredentialTestError,
  networkErrorCode
} from '../../../src/main/ai/http'
import type { AIExplanationRequest } from '../../../src/shared/types/AIExplanationTypes'
import type { AIExplanationStreamChunk } from '../../../src/shared/types/AIProviderTypes'

const MODEL = 'vendor/stream:free'
const request: AIExplanationRequest = {
  provider: 'openrouter',
  model: MODEL,
  apiKey: 'synthetic-test-key',
  prompt: 'p',
  maxOutputTokens: 600,
  metadata: { requestId: 'r', analysisId: 'a', userLevel: 'basic', explanationStyle: 'long_analytical' }
}

function sse(response: ServerResponse, value: unknown): void {
  response.write(`data: ${typeof value === 'string' ? value : JSON.stringify(value)}\n\n`)
}

async function withStreamServer(
  stream: (response: ServerResponse, body: Record<string, unknown>) => void,
  run: (provider: OpenRouterProvider, bodies: Array<Record<string, unknown>>) => Promise<void>,
  idleMs = 30_000
): Promise<void> {
  const bodies: Array<Record<string, unknown>> = []
  const server = createServer((req, res) => {
    let raw = ''
    req.on('data', (chunk) => {
      raw += String(chunk)
    })
    req.on('end', () => {
      if (req.url?.startsWith('/api/v1/models')) {
        res.writeHead(200, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ data: [{ id: MODEL, supported_parameters: ['reasoning'] }] }))
        return
      }
      const body = JSON.parse(raw) as Record<string, unknown>
      bodies.push(body)
      res.writeHead(200, { 'content-type': 'text/event-stream' })
      stream(res, body)
    })
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  try {
    const baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/v1`
    await run(new OpenRouterProvider({ baseUrl, streamIdleTimeoutMs: idleMs }), bodies)
  } finally {
    server.closeAllConnections()
    server.close()
  }
}

async function collect(
  provider: OpenRouterProvider,
  signal = new AbortController().signal
): Promise<{ chunks: AIExplanationStreamChunk[]; error: unknown }> {
  const chunks: AIExplanationStreamChunk[] = []
  try {
    for await (const chunk of provider.generateExplanationStream(request, signal)) chunks.push(chunk)
    return { chunks, error: null }
  } catch (error) {
    return { chunks, error }
  }
}

async function main(): Promise<void> {
  // 註解行、跨段切開的 JSON、[DONE]。
  await withStreamServer((res) => {
    res.write(': OPENROUTER PROCESSING\n\n')
    res.write(`data: ${JSON.stringify({ model: 'vendor/stream', choices: [{ delta: { content: '炮二' } }] })}`)
    setTimeout(() => {
      res.write('\n\n')
      sse(res, { model: 'vendor/stream', choices: [{ delta: { content: '平五先佔中路。' }, finish_reason: 'stop' }] })
      sse(res, { choices: [], usage: { prompt_tokens: 9, completion_tokens: 7, completion_tokens_details: { reasoning_tokens: 0 } } })
      sse(res, '[DONE]')
      res.end()
    }, 10)
  }, async (provider, bodies) => {
    const { chunks, error } = await collect(provider)
    assert.equal(error, null)
    assert.deepEqual(chunks.filter((chunk) => chunk.type === 'text_delta').map((chunk) => chunk.type === 'text_delta' && chunk.deltaText), ['炮二', '平五先佔中路。'])
    assert.deepEqual(chunks.at(-1), {
      type: 'done',
      usage: { inputTokens: 9, outputTokens: 7, reasoningTokens: 0 },
      finishReason: 'stop',
      actualModel: 'vendor/stream'
    })
    assert.equal(bodies[0].stream, true)
    assert.deepEqual(bodies[0].reasoning, { effort: 'none', exclude: true })
  })

  // 串流中途的錯誤物件。
  await withStreamServer((res) => {
    sse(res, { model: MODEL, choices: [{ delta: { content: '一半' } }] })
    sse(res, { error: { code: 503, message: 'upstream secret detail' } })
    res.end()
  }, async (provider) => {
    const { chunks, error } = await collect(provider)
    assert.equal(chunks.length, 1, 'the partial delta was already delivered')
    assert.ok(error instanceof AIHttpError)
    assert.equal(error.status, 503)
    assert.equal(error.message.includes('secret'), false)
  })

  // 串流中途錯誤的文字代碼保留下來（只收短代碼），狀態仍當 502；服務原文訊息不保留。
  await withStreamServer((res) => {
    sse(res, { model: MODEL, choices: [{ delta: { content: '一半' } }] })
    sse(res, { error: { code: 'server_error', message: 'upstream secret detail' } })
    res.end()
  }, async (provider) => {
    const { error } = await collect(provider)
    assert.ok(error instanceof AIHttpError)
    assert.equal(error.status, 502)
    assert.equal(error.providerCode, 'server_error')
    assert.equal(error.message.includes('secret'), false)
  })
  await withStreamServer((res) => {
    sse(res, { model: MODEL, choices: [{ delta: { content: '一半' } }] })
    sse(res, { error: { code: 'a message with spaces that is not a code', message: 'x' } })
    res.end()
  }, async (provider) => {
    const { error } = await collect(provider)
    assert.ok(error instanceof AIHttpError)
    assert.equal(error.providerCode, undefined, 'free text is never kept as a code')
  })

  // 閒置逾時：送出一段後不再有任何位元組。
  await withStreamServer((res) => {
    sse(res, { model: MODEL, choices: [{ delta: { content: '開始' } }] })
  }, async (provider) => {
    const started = Date.now()
    const { error } = await collect(provider)
    assert.ok(Date.now() - started < 2_000)
    assert.ok(error instanceof Error && error.name === 'TimeoutError', String(error))
    assert.equal(describeCredentialTestError(error, 'OpenRouter').diagnostic?.category, 'timeout')
  }, 100)

  // 註解也算位元組：持續送註解不會觸發閒置逾時。
  await withStreamServer((res) => {
    let ticks = 0
    const timer = setInterval(() => {
      ticks += 1
      if (ticks < 5) {
        res.write(': OPENROUTER PROCESSING\n\n')
        return
      }
      clearInterval(timer)
      sse(res, { model: MODEL, choices: [{ delta: { content: '終於回答。' }, finish_reason: 'stop' }] })
      sse(res, '[DONE]')
      res.end()
    }, 40)
  }, async (provider) => {
    const { error, chunks } = await collect(provider)
    assert.equal(error, null)
    assert.equal(chunks.at(-1)?.type, 'done')
  }, 100)

  // 只有推理、沒有正文 → generation_incomplete；截斷 → output_truncated。
  for (const [finish, reason] of [['stop', 'empty_content'], ['length', 'output_truncated']] as const) {
    await withStreamServer((res) => {
      sse(res, { model: MODEL, choices: [{ delta: { content: finish === 'length' ? '半句' : '' }, finish_reason: finish }] })
      sse(res, '[DONE]')
      res.end()
    }, async (provider) => {
      const { error } = await collect(provider)
      assert.ok(error instanceof AIResponseValidationError, String(error))
      assert.equal(error.details.reason, reason)
    })
  }

  // 其他家族的模型 → model_mismatch。
  await withStreamServer((res) => {
    sse(res, { model: 'other/model:free', choices: [{ delta: { content: 'x' } }] })
    res.end()
  }, async (provider) => {
    const { error } = await collect(provider)
    assert.ok(error instanceof AIResponseValidationError)
    assert.equal(error.category, 'model_mismatch')
  })

  // 使用者取消 → AbortError，不是逾時。
  await withStreamServer((res) => {
    sse(res, { model: MODEL, choices: [{ delta: { content: '開始' } }] })
  }, async (provider) => {
    const controller = new AbortController()
    setTimeout(() => controller.abort(), 50)
    const { error } = await collect(provider, controller.signal)
    assert.ok(error instanceof Error && error.name === 'AbortError', String(error))
  })

  // 串流途中連線被切斷：Node 的 fetch 丟 TypeError，底層代碼在 cause；診斷只帶代碼，不帶原文。
  await withStreamServer((res) => {
    sse(res, { model: MODEL, choices: [{ delta: { content: '開始' } }] })
    setTimeout(() => res.socket?.destroy(), 20)
  }, async (provider) => {
    const { error } = await collect(provider)
    assert.ok(error instanceof TypeError, String(error))
    const diagnostic = describeAIExecutionError(error)
    assert.equal(diagnostic.category, 'network')
    assert.match(diagnostic.networkCode ?? '', /^[A-Z][A-Z0-9_]+$/)
    assert.equal(JSON.stringify(diagnostic).includes('terminated'), false)
  })

  // 代碼擷取只接受大寫代碼格式，也會往 AggregateError 裡找。
  assert.equal(networkErrorCode(new TypeError('fetch failed', { cause: { code: 'ECONNRESET' } })), 'ECONNRESET')
  assert.equal(
    networkErrorCode(new TypeError('fetch failed', { cause: new AggregateError([Object.assign(new Error('a'), { code: 'ECONNREFUSED' })]) })),
    'ECONNREFUSED'
  )
  assert.equal(networkErrorCode(new TypeError('fetch failed', { cause: { code: 'leak sk-or-secret' } })), undefined)
  assert.equal(networkErrorCode(new TypeError('x is undefined')), undefined)

  // 憑證被攔截：訊息指出防毒軟體／公司網路，且不標為可重試。
  const intercepted = describeAIExecutionError(
    new TypeError('fetch failed', { cause: { code: 'SELF_SIGNED_CERT_IN_CHAIN' } })
  )
  assert.equal(intercepted.category, 'network')
  assert.equal(intercepted.networkCode, 'SELF_SIGNED_CERT_IN_CHAIN')
  assert.equal(intercepted.retryable, false)
  assert.match(intercepted.message, /防毒軟體/)

  console.log('OpenRouter streaming tests passed')
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
