/**
 * License Key 發行工具（發行者本機使用，不隨 App 散布）
 *
 * 用法：
 *   npx tsx --tsconfig tsconfig.node.json tools/license-keygen.ts init
 *     → 產生 Ed25519 金鑰對至 tools/keys/（私鑰絕不 commit；目錄已 gitignore），
 *       並印出要內嵌進 src/main/license/LicenseService.ts 的公鑰 PEM。
 *
 *   npx tsx --tsconfig tsconfig.node.json tools/license-keygen.ts issue --licensee "王小明"
 *     → 用私鑰簽發一組買斷 License Key（XQA1.<payload>.<sig>）。
 */

import { generateKeyPairSync, randomUUID, sign, createPrivateKey } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { LICENSE_KEY_PREFIX, LICENSE_PRODUCT } from '../src/main/license/LicenseService'
import type { LicenseInfo } from '../src/shared/types/License'

const KEYS_DIR = join(__dirname, 'keys')
const PRIVATE_KEY_PATH = join(KEYS_DIR, 'license-private.pem')
const PUBLIC_KEY_PATH = join(KEYS_DIR, 'license-public.pem')

function init(): void {
  if (existsSync(PRIVATE_KEY_PATH)) {
    console.error(`私鑰已存在：${PRIVATE_KEY_PATH}（如要重新產生請先手動刪除）`)
    process.exit(1)
  }
  const { publicKey, privateKey } = generateKeyPairSync('ed25519')
  mkdirSync(dirname(PRIVATE_KEY_PATH), { recursive: true })
  writeFileSync(PRIVATE_KEY_PATH, privateKey.export({ type: 'pkcs8', format: 'pem' }))
  writeFileSync(PUBLIC_KEY_PATH, publicKey.export({ type: 'spki', format: 'pem' }))
  console.log(`私鑰已寫入 ${PRIVATE_KEY_PATH}（請妥善保管、絕不 commit）`)
  console.log(`公鑰已寫入 ${PUBLIC_KEY_PATH}`)
  console.log('\n請把以下公鑰 PEM 貼進 src/main/license/LicenseService.ts 的 EMBEDDED_PUBLIC_KEY_PEM：\n')
  console.log(publicKey.export({ type: 'spki', format: 'pem' }).toString())
}

function issue(licensee: string): void {
  if (!existsSync(PRIVATE_KEY_PATH)) {
    console.error(`找不到私鑰 ${PRIVATE_KEY_PATH}，請先執行 init。`)
    process.exit(1)
  }
  const privateKey = createPrivateKey(readFileSync(PRIVATE_KEY_PATH, 'utf8'))
  const info: LicenseInfo = {
    licenseId: randomUUID(),
    licensee,
    product: LICENSE_PRODUCT,
    edition: 'perpetual',
    issuedAt: new Date().toISOString()
  }
  const payload = Buffer.from(JSON.stringify(info), 'utf8')
  const signature = sign(null, payload, privateKey)
  const key = `${LICENSE_KEY_PREFIX}.${payload.toString('base64url')}.${signature.toString('base64url')}`
  console.log(`授權編號：${info.licenseId}`)
  console.log(`被授權人：${info.licensee}`)
  console.log(`\nLicense Key：\n${key}`)
}

const [, , command, ...rest] = process.argv
if (command === 'init') {
  init()
} else if (command === 'issue') {
  const idx = rest.indexOf('--licensee')
  const licensee = idx >= 0 ? rest[idx + 1] : undefined
  if (!licensee) {
    console.error('用法：license-keygen.ts issue --licensee "名字"')
    process.exit(1)
  }
  issue(licensee)
} else {
  console.error('用法：license-keygen.ts <init|issue --licensee "名字">')
  process.exit(1)
}
