/**
 * 買斷授權服務 (LicenseService) — SDS Q5
 *
 * 離線驗證：License Key 為 `XQA1.<base64url(payload)>.<base64url(sig)>`，
 * payload 是 LicenseInfo JSON，sig 是發行者私鑰的 Ed25519 簽章。
 * 驗證只用內嵌公鑰，完全離線，不需 license server（符合 SDS 附錄 B
 * 「不能離線使用會與低成本策略衝突」的考量）。
 *
 * 安全邊界：驗證與儲存只在 main process；renderer 只經 IPC 取得
 * LicenseStatus（不含可重複散布的完整 key）。
 * 已啟用的 key 存於 userData/license.json（StorageService）。
 */

import { createPublicKey, verify as cryptoVerify, type KeyObject } from 'node:crypto'
import type { LicenseInfo, LicenseStatus } from '@shared/types/License'
import type { StorageService } from '../storage/StorageService'

export const LICENSE_KEY_PREFIX = 'XQA1'
export const LICENSE_PRODUCT = 'xiangqi-analyzer'
export const LICENSE_FILE = 'license.json'

/**
 * 發行者公鑰（Ed25519 SPKI PEM）。
 * 對應私鑰由 tools/license-keygen.ts 產生並保存在發行者本機
 * （tools/keys/，已 gitignore），絕不進入程式碼或安裝檔。
 */
const EMBEDDED_PUBLIC_KEY_PEM = `-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEAR/YWP5i+K0NWJXCD36RFmSdR+W8PolrjMS2doeBsjuY=
-----END PUBLIC KEY-----`

/** license.json 檔案內容 */
interface StoredLicense {
  licenseKey: string | null
  activatedAt: string | null
}

const EMPTY_STORED: StoredLicense = { licenseKey: null, activatedAt: null }

/** 驗證結果（內部） */
export type LicenseVerification =
  | { valid: true; info: LicenseInfo }
  | { valid: false; message: string }

/** 純驗證函式：格式 → 簽章 → 欄位逐層檢查（可單元測試，不碰檔案系統） */
export function verifyLicenseKey(
  licenseKey: string,
  publicKey: KeyObject
): LicenseVerification {
  const trimmed = licenseKey.trim()
  const parts = trimmed.split('.')
  if (parts.length !== 3 || parts[0] !== LICENSE_KEY_PREFIX) {
    return { valid: false, message: 'License Key 格式不正確。' }
  }
  let payload: Buffer
  let signature: Buffer
  try {
    payload = Buffer.from(parts[1], 'base64url')
    signature = Buffer.from(parts[2], 'base64url')
  } catch {
    return { valid: false, message: 'License Key 編碼無法解析。' }
  }
  let signatureOk = false
  try {
    signatureOk = cryptoVerify(null, payload, publicKey, signature)
  } catch {
    signatureOk = false
  }
  if (!signatureOk) {
    return { valid: false, message: 'License Key 簽章驗證失敗（金鑰無效或已被竄改）。' }
  }
  let info: LicenseInfo
  try {
    info = JSON.parse(payload.toString('utf8')) as LicenseInfo
  } catch {
    return { valid: false, message: 'License Key 內容無法解析。' }
  }
  if (info.product !== LICENSE_PRODUCT) {
    return { valid: false, message: '此 License Key 不屬於本產品。' }
  }
  if (info.edition !== 'perpetual') {
    return { valid: false, message: '不支援的授權型態。' }
  }
  if (!info.licenseId || !info.licensee || !info.issuedAt) {
    return { valid: false, message: 'License Key 缺少必要授權資料。' }
  }
  return { valid: true, info }
}

export class LicenseService {
  private readonly storage: StorageService
  private readonly publicKey: KeyObject

  constructor(storage: StorageService, publicKeyPem: string = EMBEDDED_PUBLIC_KEY_PEM) {
    this.storage = storage
    this.publicKey = createPublicKey(publicKeyPem)
  }

  /** 目前授權狀態（每次都重新驗證儲存的 key，防手改 license.json） */
  getStatus(): LicenseStatus {
    const stored = this.storage.read<StoredLicense>(LICENSE_FILE, EMPTY_STORED)
    if (!stored.licenseKey) {
      return { activated: false, message: '尚未輸入 License Key。' }
    }
    const result = verifyLicenseKey(stored.licenseKey, this.publicKey)
    if (!result.valid) {
      return { activated: false, message: result.message }
    }
    return {
      activated: true,
      info: result.info,
      activatedAt: stored.activatedAt ?? undefined
    }
  }

  /** 驗證並啟用；失敗時回傳 activated=false + message，不寫入任何資料 */
  activate(licenseKey: string): LicenseStatus {
    const result = verifyLicenseKey(licenseKey, this.publicKey)
    if (!result.valid) {
      return { activated: false, message: result.message }
    }
    const activatedAt = new Date().toISOString()
    this.storage.write<StoredLicense>(LICENSE_FILE, {
      licenseKey: licenseKey.trim(),
      activatedAt
    })
    return { activated: true, info: result.info, activatedAt }
  }

  /** 解除啟用（清除本機儲存的 key） */
  deactivate(): LicenseStatus {
    this.storage.write<StoredLicense>(LICENSE_FILE, EMPTY_STORED)
    return { activated: false, message: '已解除啟用。' }
  }
}
