/**
 * License Key 買斷授權測試（SDS Q5）。
 *
 * 執行：npx tsx --tsconfig tsconfig.node.json tests/license.test.ts
 *
 * 涵蓋：簽發→驗證 round-trip、簽章竄改、錯誤公鑰、格式錯誤、
 * 產品不符、LicenseService 啟用/狀態/解除流程（in-memory storage）。
 */

import { generateKeyPairSync, randomUUID, sign } from 'node:crypto'
import {
  LICENSE_KEY_PREFIX,
  LICENSE_PRODUCT,
  LicenseService,
  verifyLicenseKey
} from '../src/main/license/LicenseService'
import type { LicenseInfo } from '../src/shared/types/License'
import type { StorageService } from '../src/main/storage/StorageService'

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

/** in-memory StorageService 替身（LicenseService 只用 read/write） */
function memoryStorage(): StorageService {
  const files = new Map<string, string>()
  return {
    read<T>(name: string, fallback: T): T {
      const raw = files.get(name)
      if (raw === undefined) return fallback
      try {
        return JSON.parse(raw) as T
      } catch {
        return fallback
      }
    },
    write<T>(name: string, data: T): void {
      files.set(name, JSON.stringify(data))
    },
    exists(name: string): boolean {
      return files.has(name)
    }
  } as unknown as StorageService
}

/** 與 tools/license-keygen.ts 相同的簽發流程 */
function issueKey(
  privateKey: ReturnType<typeof generateKeyPairSync>['privateKey'] | import('node:crypto').KeyObject,
  info: LicenseInfo
): string {
  const payload = Buffer.from(JSON.stringify(info), 'utf8')
  const signature = sign(null, payload, privateKey as import('node:crypto').KeyObject)
  return `${LICENSE_KEY_PREFIX}.${payload.toString('base64url')}.${signature.toString('base64url')}`
}

function makeInfo(patch: Partial<LicenseInfo> = {}): LicenseInfo {
  return {
    licenseId: randomUUID(),
    licensee: '測試使用者',
    product: LICENSE_PRODUCT,
    edition: 'perpetual',
    issuedAt: new Date().toISOString(),
    ...patch
  }
}

function main(): void {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519')
  const publicKeyPem = publicKey.export({ type: 'spki', format: 'pem' }).toString()

  section('verifyLicenseKey：簽發→驗證 round-trip')
  {
    const info = makeInfo()
    const key = issueKey(privateKey, info)
    const result = verifyLicenseKey(key, publicKey)
    check('有效 key 通過驗證', result.valid)
    check(
      'payload 解出原始授權資料',
      result.valid && result.info.licenseId === info.licenseId && result.info.licensee === '測試使用者'
    )
    check('前後空白容忍', verifyLicenseKey(`  ${key}  `, publicKey).valid)
  }

  section('verifyLicenseKey：拒絕情境')
  {
    const key = issueKey(privateKey, makeInfo())
    const [prefix, payload, sig] = key.split('.')

    const tamperedInfo = makeInfo({ licensee: '盜版仔' })
    const tamperedPayload = Buffer.from(JSON.stringify(tamperedInfo), 'utf8').toString('base64url')
    const tampered = verifyLicenseKey(`${prefix}.${tamperedPayload}.${sig}`, publicKey)
    check('竄改 payload → 簽章失敗', !tampered.valid && tampered.message.includes('簽章'))

    const otherPair = generateKeyPairSync('ed25519')
    const wrongKey = verifyLicenseKey(key, otherPair.publicKey)
    check('別把公鑰簽的 key → 失敗', !wrongKey.valid)

    check('空字串 → 格式錯誤', !verifyLicenseKey('', publicKey).valid)
    check('缺段 → 格式錯誤', !verifyLicenseKey('XQA1.abc', publicKey).valid)
    check('錯誤前綴 → 格式錯誤', !verifyLicenseKey(`ZZZ9.${payload}.${sig}`, publicKey).valid)
    check('亂碼 → 不會 throw、回傳失敗', !verifyLicenseKey('XQA1.!!!.???', publicKey).valid)

    const wrongProduct = issueKey(privateKey, makeInfo({ product: 'other-app' }))
    const productResult = verifyLicenseKey(wrongProduct, publicKey)
    check('產品不符 → 拒絕', !productResult.valid && productResult.message.includes('產品'))

    const missingField = issueKey(privateKey, makeInfo({ licensee: '' }))
    check('缺必要欄位 → 拒絕', !verifyLicenseKey(missingField, publicKey).valid)
  }

  section('LicenseService：啟用 / 狀態 / 解除')
  {
    const storage = memoryStorage()
    const service = new LicenseService(storage, publicKeyPem)

    const before = service.getStatus()
    check('初始未啟用', !before.activated && (before.message ?? '').includes('尚未'))

    const bad = service.activate('XQA1.not.valid')
    check('無效 key 啟用失敗且不寫入', !bad.activated && !service.getStatus().activated)

    const key = issueKey(privateKey, makeInfo({ licensee: 'Enzo' }))
    const activated = service.activate(key)
    check('有效 key 啟用成功', activated.activated && activated.info?.licensee === 'Enzo')
    check('activatedAt 記錄', typeof activated.activatedAt === 'string')

    const status = service.getStatus()
    check('重啟後（重新讀檔）仍啟用', status.activated && status.info?.licensee === 'Enzo')

    // 手改 license.json 內容（模擬竄改）→ 狀態回未啟用
    storage.write('license.json', { licenseKey: 'XQA1.hack.hack', activatedAt: 'x' })
    check('儲存的 key 被竄改 → 視為未啟用', !service.getStatus().activated)

    service.activate(key)
    const deactivated = service.deactivate()
    check('解除啟用', !deactivated.activated && !service.getStatus().activated)
  }

  console.log(`\n結果：${passed} 通過，${failed} 失敗`)
  if (failed > 0) process.exit(1)
}

main()
