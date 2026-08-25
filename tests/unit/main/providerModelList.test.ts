import assert from 'node:assert/strict'
import { OpenAIProvider } from '../../../src/main/ai/providers/OpenAIProvider'
import { AnthropicProvider } from '../../../src/main/ai/providers/AnthropicProvider'
import { GeminiProvider } from '../../../src/main/ai/providers/GeminiProvider'

async function main(): Promise<void> {
  const originalFetch = globalThis.fetch
  try {
  let request: { url: string; headers: Headers } | null = null
  globalThis.fetch = async (input, init) => {
    request = { url: String(input), headers: new Headers(init?.headers) }
    return new Response(JSON.stringify({
      data: [{ id: 'gpt-5.6-sol' }, { id: 'gpt-audio' }, { id: 'text-embedding-3-small' }]
    }), { status: 200, headers: { 'content-type': 'application/json' } })
  }
  assert.deepEqual(await new OpenAIProvider().listModels('sk-test'), ['gpt-5.6-sol'])
  assert.equal(request?.url, 'https://api.openai.com/v1/models')
  assert.equal(request?.headers.get('authorization'), 'Bearer sk-test')

  globalThis.fetch = async (input, init) => {
    request = { url: String(input), headers: new Headers(init?.headers) }
    return new Response(JSON.stringify({
      data: [{ id: 'claude-sonnet-5' }, { id: 'not-claude' }]
    }), { status: 200, headers: { 'content-type': 'application/json' } })
  }
  assert.deepEqual(await new AnthropicProvider().listModels('sk-ant-test'), ['claude-sonnet-5'])
  assert.equal(request?.url, 'https://api.anthropic.com/v1/models?limit=1000')
  assert.equal(request?.headers.get('x-api-key'), 'sk-ant-test')
  assert.equal(request?.headers.get('anthropic-version'), '2023-06-01')

  globalThis.fetch = async (input, init) => {
    request = { url: String(input), headers: new Headers(init?.headers) }
    return new Response(JSON.stringify({
      models: [
        { name: 'models/gemini-3.7-flash', supportedGenerationMethods: ['generateContent'] },
        { name: 'models/embedding-001', supportedGenerationMethods: ['embedContent'] }
      ]
    }), { status: 200, headers: { 'content-type': 'application/json' } })
  }
  assert.deepEqual(await new GeminiProvider().listModels('AIza-test'), ['models/gemini-3.7-flash'])
  assert.equal(request?.url, 'https://generativelanguage.googleapis.com/v1beta/models?pageSize=1000')
  assert.equal(request?.headers.get('x-goog-api-key'), 'AIza-test')
  assert.equal(request?.url.includes('AIza-test'), false)

    console.log('官方 Provider 模型清单测试：通过')
  } finally {
    globalThis.fetch = originalFetch
  }
}

void main().catch((error) => {
  console.error(error)
  process.exit(1)
})
