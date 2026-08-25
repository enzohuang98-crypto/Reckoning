import assert from 'node:assert/strict'
import {
  AUTO_MODEL_PRIORITY,
  selectAutomaticModel
} from '../../../src/shared/logic/ai/AutoCredential'
import { detectApiKeyProvider } from '../../../src/shared/logic/validation/ApiKeyProvider'

assert.equal(detectApiKeyProvider(' sk-ant-example ')?.provider, 'anthropic')
assert.equal(detectApiKeyProvider('AIza-example')?.provider, 'gemini')
assert.equal(detectApiKeyProvider('sk-example')?.provider, 'openai')
assert.equal(detectApiKeyProvider('deepseek-example'), null)

assert.equal(
  selectAutomaticModel('openai', ['gpt-5.6-terra', 'gpt-5.6-sol']),
  AUTO_MODEL_PRIORITY.openai[0]
)
assert.equal(
  selectAutomaticModel('anthropic', ['claude-opus-5', 'claude-sonnet-5']),
  'claude-sonnet-5'
)
assert.equal(
  selectAutomaticModel('gemini', ['models/gemini-3.6-flash', 'models/gemini-3.7-flash']),
  'gemini-3.7-flash'
)
assert.equal(selectAutomaticModel('gemini', ['gemini-3.1-pro-preview']), null)

console.log('自动金钥匙路由测试：通过')
