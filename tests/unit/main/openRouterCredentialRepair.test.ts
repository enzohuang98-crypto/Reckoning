import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import {
  autoConfigureCredential
} from '../../../src/main/ai/autoConfigureCredential'
import { mapStreamingErrorToPayload } from '../../../src/main/ipc/aiExplanationHandlers'
import {
  AIHttpError,
  AIResponseValidationError,
  describeCredentialTestError,
  type AICredentialErrorCategory
} from '../../../src/main/ai/http'
import {
  OPENROUTER_CREDENTIAL_TEST_GENERATION_TIMEOUT_MS,
  OPENROUTER_CREDENTIAL_TEST_MAX_OUTPUT_TOKENS,
  OpenRouterProvider
} from '../../../src/main/ai/providers/OpenRouterProvider'
import type { AIModelInfo } from '../../../src/shared/types/AIProviderTypes'
import type {
  SecretCredentialRef,
  SecretStatus
} from '../../../src/shared/types/ipc'
import type { AIExplanationRequest } from '../../../src/shared/types/AIExplanationTypes'

interface RecordedRequest {
  url: string
  authorization?: string
  body?: unknown
}

interface MockResponse {
  status?: number
  body?: unknown
  rawBody?: string
  headers?: Record<string, string>
  delayMs?: number
  destroy?: boolean
}

async function withServer(
  handler: (request: RecordedRequest) => MockResponse,
  run: (baseUrl: string, requests: RecordedRequest[]) => Promise<void>
): Promise<void> {
  const requests: RecordedRequest[] = []
  const server = createServer((request, response) => {
    let raw = ''
    request.on('data', (chunk) => {
      raw += String(chunk)
    })
    request.on('end', () => {
      let body: unknown
      if (raw) {
        try {
          body = JSON.parse(raw)
        } catch {
          body = raw
        }
      }
      const recorded: RecordedRequest = {
        url: request.url ?? '',
        authorization: request.headers.authorization,
        body
      }
      requests.push(recorded)
      const result = handler(recorded)
      if (result.destroy) {
        response.destroy()
        return
      }
      response.writeHead(result.status ?? 200, {
        'content-type': 'application/json',
        ...result.headers
      })
      const responseBody = result.rawBody ?? JSON.stringify(result.body ?? {})
      if (result.delayMs && result.delayMs > 0) {
        setTimeout(() => response.end(responseBody), result.delayMs)
      } else {
        response.end(responseBody)
      }
    })
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  try {
    const { port } = server.address() as AddressInfo
    await run(`http://127.0.0.1:${port}/api/v1`, requests)
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }
}

function requestFor(model: string, requestId = 'repair-test'): AIExplanationRequest {
  return {
    provider: 'openrouter',
    model,
    apiKey: 'sk-or-v1-test',
    prompt: 'test prompt',
    metadata: {
      requestId,
      analysisId: requestId,
      userLevel: 'basic',
      explanationStyle: 'long_analytical'
    }
  }
}

function freeModels(): { data: Array<Record<string, unknown>> } {
  return {
    data: [
      {
        id: 'vendor/model-a:free',
        name: 'Model A',
        architecture: { output_modalities: ['text'] },
        pricing: { prompt: '0', completion: '0', request: '0' }
      }
    ]
  }
}

function emptyStatus(): SecretStatus {
  return {
    configured: false,
    needsReentry: false,
    activeCredential: null,
    credentials: []
  }
}

function createFakeSecretStore(options: {
  status?: SecretStatus
  failSet?: boolean
} = {}): {
  secretStore: {
    setCredential: (
      provider: SecretCredentialRef['provider'],
      model: string,
      apiKey: string,
      baseUrl?: string
    ) => Promise<SecretCredentialRef>
    getStatus: () => Promise<SecretStatus>
  }
  writes: Array<{ provider: string; model: string; apiKey: string }>
} {
  let status = options.status ?? emptyStatus()
  const writes: Array<{ provider: string; model: string; apiKey: string }> = []
  return {
    writes,
    secretStore: {
      async setCredential(provider, model, apiKey) {
        writes.push({ provider, model, apiKey })
        if (options.failSet) throw new Error('synthetic storage failure')
        status = {
          configured: true,
          needsReentry: false,
          activeCredential: { provider, model },
          credentials: [
            {
              provider,
              model,
              configured: true,
              needsReentry: false
            }
          ]
        }
        return { provider, model }
      },
      async getStatus() {
        return status
      }
    }
  }
}

function assertDiagnostic(
  value: unknown,
  expected: {
    stage: 'key' | 'catalog' | 'generation' | 'storage'
    category: AICredentialErrorCategory
    httpStatus?: number
    retryable: boolean
    retryAfterMs?: number
  }
): void {
  assert.equal(typeof value, 'object')
  const diagnostic = (value as { diagnostic?: Record<string, unknown> }).diagnostic
  assert.deepEqual(diagnostic, {
    stage: expected.stage,
    category: expected.category,
    ...(expected.httpStatus === undefined ? {} : { httpStatus: expected.httpStatus }),
    retryable: expected.retryable,
    ...(expected.retryAfterMs === undefined ? {} : { retryAfterMs: expected.retryAfterMs }),
    message: diagnostic?.message
  })
  assert.equal(typeof diagnostic?.message, 'string')
}

async function main(): Promise<void> {
  assert.equal(OPENROUTER_CREDENTIAL_TEST_GENERATION_TIMEOUT_MS, 25_000)
  assert.equal(OPENROUTER_CREDENTIAL_TEST_MAX_OUTPUT_TOKENS, 512)
  const statusCases = [
    { status: 401, category: 'authentication' as const, retryable: false },
    { status: 403, category: 'permission' as const, retryable: false },
    { status: 402, category: 'billing' as const, retryable: false }
  ]
  for (const statusCase of statusCases) {
    const result = describeCredentialTestError(
      new AIHttpError(statusCase.status, 'key', 'safe status only'),
      'OpenRouter'
    )
    assert.equal(result.ok, false)
    assertDiagnostic(result, {
      stage: 'key',
      category: statusCase.category,
      httpStatus: statusCase.status,
      retryable: statusCase.retryable
    })
  }

  await withServer(
    () => ({
      body: {
        model: 'vendor/model-a:free',
        choices: [{
          message: {
            content: null,
            reasoning: 'internal reasoning must not become the answer'
          }
        }]
      }
    }),
    async (baseUrl) => {
      await assert.rejects(
        new OpenRouterProvider({ baseUrl }).generateExplanation(
          requestFor('vendor/model-a:free')
        ),
        (error: unknown) =>
          error instanceof AIResponseValidationError &&
          error.category === 'generation_incomplete'
      )
    }
  )

  await withServer(
    () => ({
      body: {
        model: 'vendor/model-a:free',
        choices: [{
          message: { content: 'OK', reasoning_content: 'not answer' },
          finish_reason: 'length'
        }]
      }
    }),
    async (baseUrl) => {
      await assert.rejects(
        new OpenRouterProvider({ baseUrl }).generateExplanation(
          requestFor('vendor/model-a:free', 'credential-test')
        ),
        (error: unknown) =>
          error instanceof AIResponseValidationError &&
          error.category === 'generation_incomplete'
      )
    }
  )


  await withServer(
    () => ({
      delayMs: 250,
      body: {
        model: 'vendor/model-a:free',
        choices: [{ message: { content: 'OK' } }]
      }
    }),
    async (baseUrl) => {
      const result = await new OpenRouterProvider({ baseUrl }).testCredentialWithModels(
        'sk-or-v1-test',
        'vendor/model-a:free',
        [{ id: 'vendor/model-a:free', label: 'Model A' } satisfies AIModelInfo],
        100
      )
      assert.equal(result.ok, false)
      assertDiagnostic(result, {
        stage: 'generation',
        category: 'timeout',
        retryable: true
      })
    }
  )


  await withServer(
    () => ({
      delayMs: 250,
      body: {
        model: 'vendor/model-a:free',
        choices: [{ message: { content: 'OK' } }]
      }
    }),
    async (baseUrl) => {
      const controller = new AbortController()
      const pending = new OpenRouterProvider({ baseUrl }).generateExplanation(
        requestFor('vendor/model-a:free'),
        controller.signal
      )
      setTimeout(() => controller.abort(), 25)
      await assert.rejects(pending, (error: unknown) => {
        const payload = mapStreamingErrorToPayload('production-cancel', error)
        return (
          error instanceof DOMException &&
          error.name === 'AbortError' &&
          payload.code === 'cancelled'
        )
      })
    }
  )

  await withServer(
    () => ({ destroy: true }),
    async (baseUrl) => {
      await assert.rejects(
        new OpenRouterProvider({ baseUrl }).generateExplanation(
          requestFor('vendor/model-a:free')
        ),
        (error: unknown) => {
          const payload = mapStreamingErrorToPayload('production-network', error)
          return error instanceof TypeError && payload.code === 'network_error'
        }
      )
    }
  )

  await withServer(
    () => ({ rawBody: '{not-json' }),
    async (baseUrl) => {
      await assert.rejects(
        new OpenRouterProvider({ baseUrl }).generateExplanation(
          requestFor('vendor/model-a:free')
        ),
        (error: unknown) =>
          error instanceof AIResponseValidationError &&
          error.category === 'response_format'
      )
    }
  )

  await withServer(
    () => ({
      status: 401,
      body: { error: { message: 'provider detail must stay out of the result' } }
    }),
    async (baseUrl, requests) => {
      const result = await new OpenRouterProvider({ baseUrl }).testCredential(
        'sk-or-v1-test',
        'vendor/model-a:free'
      )
      assert.equal(result.ok, false)
      assertDiagnostic(result, {
        stage: 'key',
        category: 'authentication',
        httpStatus: 401,
        retryable: false
      })
      assert.equal(requests.length, 1)
    }
  )

  await withServer(
    (request) =>
      request.url === '/api/v1/key'
        ? { body: { data: { label: 'test-key' } } }
        : {
            status: 503,
            headers: { 'retry-after': '2' },
            body: { error: { message: 'busy' } }
          },
    async (baseUrl, requests) => {
      const result = await new OpenRouterProvider({ baseUrl }).testCredential(
        'sk-or-v1-test',
        'vendor/model-a:free'
      )
      assert.equal(result.ok, false)
      assertDiagnostic(result, {
        stage: 'catalog',
        category: 'provider_unavailable',
        httpStatus: 503,
        retryable: true,
        retryAfterMs: 2000
      })
      assert.deepEqual(requests.map((request) => request.url), [
        '/api/v1/key',
        '/api/v1/models?output_modalities=text'
      ])
    }
  )

  await withServer(
    (request) => {
      if (request.url === '/api/v1/key') return { body: { data: {} } }
      if (request.url?.startsWith('/api/v1/models')) return { body: freeModels() }
      return {
        status: 429,
        headers: { 'retry-after': '1' },
        body: { error: { message: 'rate limited' } }
      }
    },
    async (baseUrl) => {
      const result = await new OpenRouterProvider({ baseUrl }).testCredential(
        'sk-or-v1-test',
        'vendor/model-a:free'
      )
      assert.equal(result.ok, false)
      assertDiagnostic(result, {
        stage: 'generation',
        category: 'rate_limited',
        httpStatus: 429,
        retryable: true,
        retryAfterMs: 1000
      })
    }
  )

  await withServer(
    (request) => {
      if (request.url === '/api/v1/key') return { body: { data: {} } }
      if (request.url?.startsWith('/api/v1/models')) return { body: freeModels() }
      return {
        body: {
          model: 'vendor/model-a:free',
          choices: [{ message: { content: 'OK' } }]
        }
      }
    },
    async (baseUrl, requests) => {
      const result = await new OpenRouterProvider({ baseUrl }).testCredential(
        'sk-or-v1-test',
        'vendor/model-a:free',
        undefined,
        500
      )
      assert.equal(result.ok, true)
      assert.equal(requests.length, 3, '一次自有驗證只能走 key、models、generation')
      assert.equal(
        (requests[2]?.body as Record<string, unknown>).max_tokens,
        OPENROUTER_CREDENTIAL_TEST_MAX_OUTPUT_TOKENS
      )
    }
  )

  await withServer(
    (request) => {
      if (request.url === '/api/v1/key') return { body: { data: {} } }
      if (request.url?.startsWith('/api/v1/models')) return { body: freeModels() }
      return {
        body: {
          model: 'vendor/model-a:free',
          choices: [{ message: { content: 'OK' } }]
        }
      }
    },
    async (baseUrl, requests) => {
      const provider = new OpenRouterProvider({ baseUrl })
      const result = await provider.testCredentialWithModels(
        'sk-or-v1-test',
        'vendor/model-a:free',
        [{ id: 'vendor/model-a:free', label: 'Model A' } satisfies AIModelInfo],
        500
      )
      assert.equal(result.ok, true)
      assert.equal(requests.length, 1, '已有清單時生成驗證不得重複呼叫 key/models')
    }
  )

  await withServer(
    (request) => {
      if (request.url === '/api/v1/key') return { body: { data: {} } }
      if (request.url?.startsWith('/api/v1/models')) return { body: freeModels() }
      return {
        body: {
          model: 'vendor/model-a:free',
          choices: [{ message: { content: 'OK' } }]
        }
      }
    },
    async (baseUrl, requests) => {
      const fake = createFakeSecretStore()
      const result = await autoConfigureCredential(
        { apiKey: 'sk-or-v1-test', model: 'vendor/model-a:free' },
        {
          getProvider: () => new OpenRouterProvider({ baseUrl }),
          secretStore: fake.secretStore
        }
      )
      assert.equal(result.ok, true)
      if (result.ok) assert.equal(result.configured, true)
      assert.equal(fake.writes.length, 1)
      assert.equal(requests.length, 3, '自動連線不得重複列模型或偷偷改用其他模型')
    }
  )


  await withServer(
    () => ({
      delayMs: 250,
      body: { data: {} }
    }),
    async (baseUrl) => {
      const result = await new OpenRouterProvider({ baseUrl }).testCredential(
        'sk-or-v1-test',
        'vendor/model-a:free',
        undefined,
        100
      )
      assert.equal(result.ok, false)
      assertDiagnostic(result, {
        stage: 'key',
        category: 'timeout',
        retryable: true
      })
    }
  )

  await withServer(
    (request) =>
      request.url === '/api/v1/key'
        ? { destroy: true }
        : { body: freeModels() },
    async (baseUrl) => {
      const result = await new OpenRouterProvider({ baseUrl }).testCredential(
        'sk-or-v1-test',
        'vendor/model-a:free'
      )
      assert.equal(result.ok, false)
      assertDiagnostic(result, {
        stage: 'key',
        category: 'network',
        retryable: true
      })
    }
  )


  await withServer(
    (request) =>
      request.url === '/api/v1/key'
        ? { body: { data: {} } }
        : { destroy: true },
    async (baseUrl) => {
      const result = await new (OpenRouterProvider)({ baseUrl }).testCredential(
        'sk-or-v1-test',
        'vendor/model-a:free'
      )
      assert.equal(result.ok, false)
      assertDiagnostic(result, {
        stage: 'catalog',
        category: 'network',
        retryable: true
      })
    }
  )

  await withServer(
    (request) =>
      request.url === '/api/v1/key'
        ? { destroy: true }
        : { body: freeModels() },
    async (baseUrl) => {
      const fake = createFakeSecretStore()
      const result = await autoConfigureCredential(
        { apiKey: 'sk-or-v1-test', model: 'vendor/model-a:free' },
        {
          getProvider: () => new OpenRouterProvider({ baseUrl }),
          secretStore: fake.secretStore
        }
      )
      assert.equal(result.ok, false)
      assertDiagnostic(result, {
        stage: 'key',
        category: 'network',
        retryable: true
      })
      assert.equal(fake.writes.length, 0)
    }
  )


  await withServer(
    (request) =>
      request.url === '/api/v1/key'
        ? { status: 401, body: { error: { message: 'invalid key' } } }
        : { body: freeModels() },
    async (baseUrl) => {
      const fake = createFakeSecretStore()
      const result = await autoConfigureCredential(
        { apiKey: 'sk-or-v1-rejected', model: 'vendor/model-a:free' },
        {
          getProvider: () => new OpenRouterProvider({ baseUrl }),
          secretStore: fake.secretStore
        }
      )
      assert.equal(result.ok, false)
      assertDiagnostic(result, {
        stage: 'key',
        category: 'authentication',
        httpStatus: 401,
        retryable: false
      })
      assert.equal(fake.writes.length, 0, '金鑰驗證失敗時不得寫入或切換憑證')
    }
  )

  await withServer(
    (request) => {
      if (request.url === '/api/v1/key') return { body: { data: {} } }
      if (request.url?.startsWith('/api/v1/models')) return { body: freeModels() }
      return {
        body: {
          model: 'vendor/model-a:free',
          choices: [{ message: { content: 'OK' } }]
        }
      }
    },
    async (baseUrl) => {
      const fake = createFakeSecretStore({ failSet: true })
      const result = await autoConfigureCredential(
        { apiKey: 'sk-or-v1-test', model: 'vendor/model-a:free' },
        {
          getProvider: () => new OpenRouterProvider({ baseUrl }),
          secretStore: fake.secretStore
        }
      )
      assert.equal(result.ok, false)
      assertDiagnostic(result, {
        stage: 'storage',
        category: 'storage',
        retryable: true
      })
      assert.equal(fake.writes.length, 1)
    }
  )

  console.log('OpenRouter M1/M2 credential repair tests passed')
}

void main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
