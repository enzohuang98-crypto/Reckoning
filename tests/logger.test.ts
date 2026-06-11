/**
 * Logger 遮蔽測試（SDS v0.2 §2.11：logger 自動遮蔽 apiKey、Authorization header、secret token）
 *
 * 執行：npx tsx --tsconfig tsconfig.node.json tests/logger.test.ts
 */

import { maskSecrets } from '../src/main/Logger'

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

console.log('## maskSecrets（§2.11 Log 洩漏防護）')

{
  const masked = maskSecrets('error calling api with key sk-ant-api03-AbCdEf12345678 failed')
  check('Anthropic 金鑰被遮蔽', !masked.includes('AbCdEf12345678') && masked.includes('sk-***'), masked)
}
{
  const masked = maskSecrets('OpenAI: sk-proj1234567890abcdef rejected')
  check('OpenAI 金鑰被遮蔽', !masked.includes('proj1234567890'), masked)
}
{
  const masked = maskSecrets('request with AIzaSyD-1234567890abcdefg denied')
  check('Google 金鑰被遮蔽', !masked.includes('SyD-1234567890'), masked)
}
{
  const masked = maskSecrets('headers: Authorization: Bearer secret-token-abc123, accept: json')
  check('Authorization header 被遮蔽', !masked.includes('secret-token-abc123'), masked)
}
{
  const masked = maskSecrets('x-goog-api-key: AbCd1234 x-api-key=Zz99')
  check('x-goog-api-key / x-api-key 被遮蔽', !masked.includes('AbCd1234') && !masked.includes('Zz99'), masked)
}
{
  const masked = maskSecrets('{"provider":"anthropic","apiKey":"my-secret-value","model":"claude-sonnet-4-6"}')
  check('JSON apiKey 欄位被遮蔽', !masked.includes('my-secret-value'), masked)
  check('JSON 其他欄位保留', masked.includes('claude-sonnet-4-6'), masked)
}
{
  const masked = maskSecrets('license XQA1.eyJsaWNlbnNlZSI6IkVuem8ifQ.c2lnbmF0dXJl invalid')
  check('License Key 被遮蔽', !masked.includes('eyJsaWNlbnNlZSI'), masked)
}
{
  const masked = maskSecrets('引擎握手逾時：對 UCI 與 UCCI 指令皆無回應。score cp 42')
  check('一般訊息不受影響', masked === '引擎握手逾時：對 UCI 與 UCCI 指令皆無回應。score cp 42', masked)
}

console.log(`\n結果：${passed} 通過，${failed} 失敗`)
if (failed > 0) process.exit(1)
