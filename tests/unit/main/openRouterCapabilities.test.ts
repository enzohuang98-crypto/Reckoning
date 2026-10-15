import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { OpenRouterProvider } from '../../../src/main/ai/providers/OpenRouterProvider'

const KEY = 'sk-or-v1-capability-test-key'

async function withCatalog(
  respond: (url: string) => { status: number; body: unknown },
  run: (baseUrl: string, urls: string[]) => Promise<void>
): Promise<void> {
  const urls: string[] = []
  const server = createServer((request, response) => {
    urls.push(request.url ?? '')
    const { status, body } = respond(request.url ?? '')
    response.writeHead(status, { 'content-type': 'application/json' })
    response.end(JSON.stringify(body))
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  try {
    await run(`http://127.0.0.1:${(server.address() as AddressInfo).port}/api/v1`, urls)
  } finally {
    server.close()
  }
}

const catalog = {
  data: [
    {
      id: 'vendor/thinker:free',
      supported_parameters: ['max_tokens', 'reasoning', 'include_reasoning', 'response_format'],
      context_length: 131072,
      top_provider: { max_completion_tokens: 8192 },
      architecture: { output_modalities: ['text'] },
      pricing: { prompt: '0', completion: '0', request: '0' }
    },
    {
      id: 'vendor/plain:free',
      supported_parameters: ['max_tokens', 'structured_outputs'],
      top_provider: { max_completion_tokens: null },
      architecture: { output_modalities: ['text'] },
      pricing: { prompt: '0', completion: '0', request: '0' }
    },
    { id: 'vendor/unknown:free', architecture: { output_modalities: ['text'] } }
  ]
}

async function main(): Promise<void> {
  await withCatalog(() => ({ status: 200, body: catalog }), async (baseUrl, urls) => {
    const provider = new OpenRouterProvider({ baseUrl })
    const thinker = await provider.getModelCapabilities(KEY, 'vendor/thinker:free')
    assert.deepEqual(thinker, {
      supportsReasoning: true,
      supportsResponseFormat: true,
      supportsStructuredOutputs: false,
      maxCompletionTokens: 8192,
      contextLength: 131072
    })
    const plain = await provider.getModelCapabilities(KEY, 'vendor/plain:free')
    assert.deepEqual(plain, {
      supportsReasoning: false,
      supportsResponseFormat: false,
      supportsStructuredOutputs: true
    })
    assert.equal(await provider.getModelCapabilities(KEY, 'vendor/unknown:free'), null)
    assert.equal(await provider.getModelCapabilities(KEY, 'vendor/missing:free'), null)
    assert.deepEqual(urls, ['/api/v1/models?output_modalities=text'], 'catalog is fetched once and cached')

    provider.observeModelBehavior('vendor/thinker:free', { reasoningMandatory: true })
    assert.equal((await provider.getModelCapabilities(KEY, 'vendor/thinker:free'))?.reasoningMandatory, true)
    provider.observeModelBehavior('vendor/thinker:free', { reasoningRejected: true })
    const rejected = await provider.getModelCapabilities(KEY, 'vendor/thinker:free')
    assert.equal(rejected?.supportsReasoning, false)
    assert.equal(rejected?.reasoningMandatory, true, 'observations accumulate')

    await provider.getModelCapabilities('sk-or-v1-another-key', 'vendor/plain:free')
    assert.equal(urls.length, 2, 'cache is per key')
    const cacheDump = JSON.stringify([...(provider as unknown as { catalogCache: Map<string, unknown> }).catalogCache.keys()])
    assert.equal(cacheDump.includes(KEY), false, 'cache keys must not contain the API key')
  })

  // listFreeModels（設定頁／憑證測試）會順便填入快取，之後生成不必再讀目錄。
  await withCatalog(
    (url) => (url === '/api/v1/key' ? { status: 200, body: { data: {} } } : { status: 200, body: catalog }),
    async (baseUrl, urls) => {
      const provider = new OpenRouterProvider({ baseUrl })
      await provider.listFreeModels(KEY)
      assert.equal(urls.length, 2)
      assert.equal((await provider.getModelCapabilities(KEY, 'vendor/thinker:free'))?.supportsReasoning, true)
      assert.equal(urls.length, 2)
    }
  )

  // 讀取失敗回傳 null，且短時間內不重試。
  await withCatalog(() => ({ status: 503, body: { error: 'down' } }), async (baseUrl, urls) => {
    const provider = new OpenRouterProvider({ baseUrl })
    assert.equal(await provider.getModelCapabilities(KEY, 'vendor/thinker:free'), null)
    assert.equal(await provider.getModelCapabilities(KEY, 'vendor/thinker:free'), null)
    assert.equal(urls.length, 1)
  })
  console.log('OpenRouter capability cache tests passed')
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
