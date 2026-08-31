import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { OpenRouterProvider } from '../../../src/main/ai/providers/OpenRouterProvider'
import type { AIExplanationRequest } from '../../../src/shared/types/AIExplanationTypes'

interface RecordedRequest {
  url: string
  authorization?: string
  routerMetadata?: string
  body?: unknown
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
      response.writeHead(200, { 'content-type': 'application/json' })
      response.end(JSON.stringify(handler(recorded)))
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
    const body = requests[0]?.body as Record<string, unknown>
    assert.equal(requests[0]?.url, '/api/v1/chat/completions')
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

console.log('OpenRouter 免费模型与精确模型绑定测试：通过')
}

void main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
