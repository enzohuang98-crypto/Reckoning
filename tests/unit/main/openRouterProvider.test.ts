import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { OpenRouterProvider } from '../../../src/main/ai/providers/OpenRouterProvider'
import { AIHttpError, AIResponseValidationError, describeCredentialTestError } from '../../../src/main/ai/http'
import type { AIExplanationRequest } from '../../../src/shared/types/AIExplanationTypes'

interface RecordedRequest {
  url: string
  authorization?: string
  routerMetadata?: string
  body?: unknown
}

function chatRequests(requests: RecordedRequest[]): RecordedRequest[] {
  return requests.filter((request) => request.url === '/api/v1/chat/completions')
}

class StatusReply {
  constructor(
    readonly status: number,
    readonly body: unknown,
    readonly headers: Record<string, string> = {}
  ) {}
}

async function withServer(
  handler: (request: RecordedRequest) => unknown,
  run: (baseUrl: string, requests: RecordedRequest[]) => Promise<void>
): Promise<void> {
  const requests: RecordedRequest[] = []
  const server = createServer((request, response) => {
    let raw = ''
    request.on('data', (chunk) => {
      raw += String(chunk)
    })
    request.on('end', () => {
      const recorded: RecordedRequest = {
        url: request.url ?? '',
        authorization: request.headers.authorization,
        routerMetadata: request.headers['x-openrouter-metadata'] as string | undefined,
        body: raw ? JSON.parse(raw) : undefined
      }
      requests.push(recorded)
      const handled = handler(recorded)
      if (handled instanceof StatusReply) {
        response.writeHead(handled.status, {
          'content-type': 'application/json',
          ...handled.headers
        })
        response.end(JSON.stringify(handled.body))
        return
      }
      response.writeHead(200, { 'content-type': 'application/json' })
      response.end(JSON.stringify(handled))
    })
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  try {
    const { port } = server.address() as AddressInfo
    await run(`http://127.0.0.1:${port}/api/v1`, requests)
  } finally {
    server.close()
  }
}

async function main(): Promise<void> {
await withServer(
  ({ url }) => {
    if (url === '/api/v1/key') return { data: { label: 'test-key' } }
    return {
      data: [
        {
          id: 'meta-llama/llama-free:free',
          name: 'Llama Free',
          architecture: { output_modalities: ['text'] },
          pricing: { prompt: '0', completion: '0', request: '0' }
        },
        {
          id: 'openrouter/free',
          name: 'Random Free Router',
          architecture: { output_modalities: ['text'] },
          pricing: { prompt: '0', completion: '0', request: '0' }
        },
        {
          id: 'vendor/paid-model',
          name: 'Paid',
          architecture: { output_modalities: ['text'] },
          pricing: { prompt: '0.000001', completion: '0', request: '0' }
        },
        {
          id: 'vendor/image-free:free',
          name: 'Image Only',
          architecture: { output_modalities: ['image'] },
          pricing: { prompt: '0', completion: '0', request: '0' }
        }
      ]
    }
  },
  async (baseUrl, requests) => {
    const models = await new OpenRouterProvider({ baseUrl }).listFreeModels('sk-or-v1-test')
    assert.deepEqual(models, [
      { id: 'meta-llama/llama-free:free', label: 'Llama Free' }
    ])
    assert.deepEqual(requests.map((request) => request.url), [
      '/api/v1/key',
      '/api/v1/models?output_modalities=text'
    ])
    assert(requests.every((request) => request.authorization === 'Bearer sk-or-v1-test'))
    assert(requests.every((request) => request.routerMetadata === 'enabled'))
  }
)

await withServer(
  () => ({
    model: 'meta-llama/llama-free:free',
    choices: [{ message: { content: '精确模型回应' } }],
    usage: { prompt_tokens: 12, completion_tokens: 7 }
  }),
  async (baseUrl, requests) => {
    const model = 'meta-llama/llama-free:free'
    const request: AIExplanationRequest = {
      provider: 'openrouter',
      model,
      apiKey: 'sk-or-v1-test',
      prompt: 'test prompt',
      metadata: {
        requestId: 'openrouter-test',
        analysisId: 'openrouter-test',
        userLevel: 'basic',
        explanationStyle: 'long_analytical'
      }
    }
    const response = await new OpenRouterProvider({ baseUrl }).generateExplanation(request)
    const chat = chatRequests(requests)
    const body = chat[0]?.body as Record<string, unknown>
    assert.equal(chat.length, 1)
    assert.equal(chat[0]?.url, '/api/v1/chat/completions')
    assert.equal(body.model, model, 'UI 选中的完整模型 ID 必须原样送到 OpenRouter')
    assert.equal('models' in body, false, '不得附带后备模型清单让 OpenRouter 改选其他模型')
    assert.equal(response.model, model)
    assert.equal(response.text, '精确模型回应')
  }
)

await withServer(
  () => ({
    model: 'vendor/model-b:free',
    choices: [{ message: { content: 'wrong model' } }]
  }),
  async (baseUrl) => {
    const request: AIExplanationRequest = {
      provider: 'openrouter',
      model: 'vendor/model-a:free',
      apiKey: 'sk-or-v1-test',
      prompt: 'test prompt',
      metadata: {
        requestId: 'openrouter-mismatch',
        analysisId: 'openrouter-mismatch',
        userLevel: 'basic',
        explanationStyle: 'long_analytical'
      }
    }
    await assert.rejects(
      new OpenRouterProvider({ baseUrl }).generateExplanation(request),
      /模型路由不一致/
    )
  }
)

for (const format of ['json', 'text', undefined] as const) {
  await withServer(() => ({ model: 'test/model:free', choices: [{message: {content: '{"ok":true}'}}] }), async (baseUrl, requests) => {
    const request: AIExplanationRequest = {
      provider: 'openrouter', model: 'test/model:free', apiKey: 'synthetic-test-key',
      prompt: 'Return JSON', responseFormat: format,
      metadata: {requestId:'response-format',analysisId:'response-format',userLevel:'intermediate',explanationStyle:'long_analytical'}
    }
    await new OpenRouterProvider({baseUrl}).generateExplanation(request)
    const body=chatRequests(requests)[0].body as Record<string,unknown>
    assert.deepEqual(body.response_format, format === 'json' ? {type:'json_object'} : undefined)
    assert.equal(body.reasoning, undefined)
    assert.equal(body.model, request.model)
  })
}

// P2-2：推理參數改由模型目錄能力決定，不再寫死單一模型的特判。
await withServer(
  ({ url }) => url.startsWith('/api/v1/models')
    ? {
        data: [{
          id: 'nvidia/nemotron-3-ultra-550b-a55b:free',
          supported_parameters: ['reasoning', 'response_format', 'max_tokens'],
          top_provider: { max_completion_tokens: 3_000 }
        }]
      }
    : {
        model: 'nvidia/nemotron-3-ultra-550b-a55b:free',
        choices: [{ message: { content: '{"ok":true}' }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 10, completion_tokens: 5, completion_tokens_details: { reasoning_tokens: 0 } }
      },
  async (baseUrl, requests) => {
    const request: AIExplanationRequest = {
      provider: 'openrouter',
      model: 'nvidia/nemotron-3-ultra-550b-a55b:free',
      apiKey: 'synthetic-test-key',
      prompt: 'Return structured coaching JSON',
      responseFormat: 'json',
      maxOutputTokens: 4_000,
      metadata: {
        requestId: 'nemotron-reasoning-budget',
        analysisId: 'nemotron-reasoning-budget',
        userLevel: 'intermediate',
        explanationStyle: 'long_analytical'
      }
    }
    const provider = new OpenRouterProvider({ baseUrl })
    const response = await provider.generateExplanation(request)
    const body = chatRequests(requests)[0].body as Record<string, unknown>
    assert.deepEqual(body.reasoning, { effort: 'none', exclude: true })
    assert.equal(body.max_tokens, 3_000, 'max_tokens is capped at the model output limit')
    assert.deepEqual(body.response_format, { type: 'json_object' })
    assert.equal(response.usage?.reasoningTokens, 0)
    assert.equal(response.finishReason, 'stop')

    await provider.generateExplanation({ ...request, reasoningMode: 'off_strict', systemPrompt: 'SYSTEM RULES' })
    const strict = chatRequests(requests)[1].body as Record<string, unknown>
    assert.deepEqual(strict.reasoning, { enabled: false, exclude: true })
    assert.deepEqual(strict.messages, [
      { role: 'system', content: 'SYSTEM RULES' },
      { role: 'user', content: 'Return structured coaching JSON' }
    ])
    assert.equal(requests.filter((item) => item.url.startsWith('/api/v1/models')).length, 1)
  }
)

// 帶 reasoning 被 400 拒絕：不帶 reasoning 重送一次，並記住之後不再帶。
{
  let chatCalls = 0
  await withServer(
    ({ url, body }) => {
      if (url.startsWith('/api/v1/models')) {
        return { data: [{ id: 'vendor/strict:free', supported_parameters: ['reasoning'] }] }
      }
      chatCalls += 1
      if ((body as Record<string, unknown>).reasoning) {
        return new StatusReply(400, { error: { code: 400, message: 'reasoning not supported' } })
      }
      return { model: 'vendor/strict:free', choices: [{ message: { content: '好' }, finish_reason: 'stop' }] }
    },
    async (baseUrl, requests) => {
      const provider = new OpenRouterProvider({ baseUrl })
      const request: AIExplanationRequest = {
        provider: 'openrouter', model: 'vendor/strict:free', apiKey: 'synthetic-test-key', prompt: 'p',
        metadata: { requestId: 'r', analysisId: 'a', userLevel: 'basic', explanationStyle: 'long_analytical' }
      }
      const first = await provider.generateExplanation(request)
      assert.equal(first.text, '好')
      assert.equal(first.providerAttempts, 2)
      assert.equal(chatCalls, 2)
      const second = await provider.generateExplanation(request)
      assert.equal(second.providerAttempts, undefined)
      assert.equal(chatCalls, 3, 'reasoning is not sent again after being rejected')
      assert.equal((chatRequests(requests)[2].body as Record<string, unknown>).reasoning, undefined)
    }
  )
}

// 要求關閉推理仍被推理吃光：記住推理無法關閉，下次加上推理額度。
await withServer(
  ({ url }) => url.startsWith('/api/v1/models')
    ? { data: [{ id: 'vendor/thinker:free', supported_parameters: ['reasoning'] }] }
    : {
        model: 'vendor/thinker:free',
        choices: [{ message: { content: '' }, finish_reason: 'length' }],
        usage: { prompt_tokens: 10, completion_tokens: 800, completion_tokens_details: { reasoning_tokens: 800 } }
      },
  async (baseUrl, requests) => {
    const provider = new OpenRouterProvider({ baseUrl })
    const request: AIExplanationRequest = {
      provider: 'openrouter', model: 'vendor/thinker:free', apiKey: 'synthetic-test-key', prompt: 'p',
      maxOutputTokens: 800,
      metadata: { requestId: 'r', analysisId: 'a', userLevel: 'basic', explanationStyle: 'long_analytical' }
    }
    const error = await provider.generateExplanation(request).then(() => null, (caught: unknown) => caught)
    assert.ok(error instanceof AIResponseValidationError)
    assert.equal(error.details.reason, 'empty_content')
    assert.equal(error.details.reasoningTokens, 800)
    await provider.generateExplanation(request).catch(() => undefined)
    const second = chatRequests(requests)[1].body as Record<string, unknown>
    assert.equal(second.max_tokens, 3_800)
    assert.deepEqual(second.reasoning, { effort: 'low', exclude: true })
  }
)
console.log('OpenRouter free-model binding, response-format, and reasoning-budget tests passed')

// P1-7：429 依本文中的固定代碼判讀每日／每分鐘額度，且不保留服務原文。
const rateLimitedRequest: AIExplanationRequest = {
  provider: 'openrouter',
  model: 'test/model:free',
  apiKey: 'synthetic-test-key',
  prompt: 'p',
  metadata: {
    requestId: 'rate-limit',
    analysisId: 'rate-limit',
    userLevel: 'intermediate',
    explanationStyle: 'long_analytical'
  }
}
await withServer(
  () => new StatusReply(429, {
    error: { code: 429, message: 'Rate limit exceeded: free-models-per-day. Add 10 credits to unlock 1000 free model requests per day' }
  }, { 'x-ratelimit-reset': String(Date.now() + 3_600_000) }),
  async (baseUrl) => {
    const error = await new OpenRouterProvider({ baseUrl })
      .generateExplanation(rateLimitedRequest)
      .then(() => null, (caught: unknown) => caught)
    assert.ok(error instanceof AIHttpError)
    assert.equal(error.status, 429)
    assert.equal(error.quota, 'daily')
    assert.ok((error.retryAfterMs ?? 0) > 3_500_000, 'x-ratelimit-reset epoch ms becomes remaining ms')
    assert.equal(error.message.includes('free-models-per-day'), false)
    const diagnostic = describeCredentialTestError(error, 'OpenRouter').diagnostic
    assert.equal(diagnostic?.quota, 'daily')
    assert.equal(diagnostic?.retryable, false)
  }
)
await withServer(
  () => new StatusReply(429, {
    error: { code: 429, message: 'Rate limit exceeded: free-models-per-min.' }
  }, { 'retry-after': '12' }),
  async (baseUrl) => {
    const error = await new OpenRouterProvider({ baseUrl })
      .generateExplanation(rateLimitedRequest)
      .then(() => null, (caught: unknown) => caught)
    assert.ok(error instanceof AIHttpError)
    assert.equal(error.quota, 'minute')
    assert.equal(error.retryAfterMs, 12_000)
    const diagnostic = describeCredentialTestError(error, 'OpenRouter').diagnostic
    assert.equal(diagnostic?.quota, 'minute')
    assert.equal(diagnostic?.retryable, true)
  }
)
console.log('OpenRouter 429 quota classification tests passed')
}

void main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
