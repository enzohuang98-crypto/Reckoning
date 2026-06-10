/**
 * 安全金鑰儲存 (SecretStore)
 *
 * 使用 Electron safeStorage（OS 級加密：Windows DPAPI / macOS Keychain / Linux libsecret）
 * 加密 API 金鑰，寫入 userData 下的獨立檔案 secrets.enc.json。
 *
 * 設計鐵則：
 *  - 金鑰只以「加密後 base64」形式落地，永不明文寫入任何設定檔。
 *  - 金鑰與「一般設定」（localStorage）完全分離。
 *  - renderer 只能 set/has/delete，永遠無法讀回明文（解密只在 main 行程內進行）。
 */

import { app, safeStorage } from 'electron'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { AIProviderId } from '@shared/types/AIProviderTypes'

interface SecretsFile {
  /** providerId → 加密後金鑰 (base64) */
  secrets: Record<string, string>
  version: number
}

const SECRETS_FILENAME = 'secrets.enc.json'

export class SecretStore {
  private readonly filePath: string

  constructor(filePath?: string) {
    this.filePath = filePath ?? join(app.getPath('userData'), SECRETS_FILENAME)
  }

  /** 作業系統是否支援加密儲存 */
  isEncryptionAvailable(): boolean {
    return safeStorage.isEncryptionAvailable()
  }

  /** 儲存（加密）某 Provider 的 API 金鑰 */
  setApiKey(providerId: AIProviderId, apiKey: string): void {
    if (!safeStorage.isEncryptionAvailable()) {
      throw new Error('此系統不支援安全加密儲存，拒絕以明文保存金鑰。')
    }
    const data = this.read()
    const encrypted = safeStorage.encryptString(apiKey).toString('base64')
    data.secrets[providerId] = encrypted
    this.write(data)
  }

  /** 是否已存有某 Provider 的金鑰 */
  hasApiKey(providerId: AIProviderId): boolean {
    const data = this.read()
    return typeof data.secrets[providerId] === 'string' && data.secrets[providerId].length > 0
  }

  /**
   * 取得解密後的金鑰（僅供 main 行程內部使用，例如呼叫 AI Provider）。
   * 不可經由 IPC 回傳給 renderer。
   */
  getApiKey(providerId: AIProviderId): string | null {
    const data = this.read()
    const encrypted = data.secrets[providerId]
    if (!encrypted) return null
    try {
      return safeStorage.decryptString(Buffer.from(encrypted, 'base64'))
    } catch {
      return null
    }
  }

  /** 刪除某 Provider 的金鑰 */
  deleteApiKey(providerId: AIProviderId): void {
    const data = this.read()
    delete data.secrets[providerId]
    this.write(data)
  }

  private read(): SecretsFile {
    if (!existsSync(this.filePath)) {
      return { secrets: {}, version: 1 }
    }
    try {
      const raw = readFileSync(this.filePath, 'utf8')
      const parsed = JSON.parse(raw) as SecretsFile
      if (!parsed.secrets) return { secrets: {}, version: 1 }
      return parsed
    } catch {
      return { secrets: {}, version: 1 }
    }
  }

  private write(data: SecretsFile): void {
    writeFileSync(this.filePath, JSON.stringify(data, null, 2), { encoding: 'utf8' })
  }
}
