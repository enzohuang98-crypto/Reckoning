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
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import {
  ALL_PROVIDER_IDS,
  type AIProviderId
} from '@shared/types/AIProviderTypes'
import {
  MAX_SECRET_FILE_BYTES,
  normalizeAiBaseUrl
} from '../security/InputValidation'
import { readJsonFile, writeJsonFileAtomic } from './SecureJsonFile'

interface SecretsFile {
  /** providerId → 加密後金鑰 (base64) */
  secrets: Record<string, string>
  activeProvider?: AIProviderId | null
  /** OpenAI-compatible 金鑰只可送往使用者儲存金鑰時確認的端點。 */
  activeBaseUrl?: string | null
  version: number
}

const SECRETS_FILENAME = 'secrets.enc.json'

export interface SecretKeyHealth {
  provider: AIProviderId | null
  /** 有金鑰且可成功解密才算已設定 */
  configured: boolean
  /** 檔案裡有金鑰但無法解密（OS 加密金鑰已變動），需要使用者重新輸入 */
  needsReentry: boolean
}

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
  setApiKey(
    providerId: AIProviderId,
    apiKey: string,
    baseUrl?: string
  ): void {
    if (!safeStorage.isEncryptionAvailable()) {
      throw new Error('此系統不支援安全加密儲存，拒絕以明文保存金鑰。')
    }
    const data = this.read()
    const encrypted = safeStorage.encryptString(apiKey).toString('base64')
    data.secrets = { [providerId]: encrypted }
    data.activeProvider = providerId
    data.activeBaseUrl =
      providerId === 'openai-compatible' && baseUrl
        ? normalizeAiBaseUrl(baseUrl)
        : null
    data.version = 3
    this.write(data)
  }

  getActiveProvider(): AIProviderId | null {
    const data = this.read()
    if (data.activeProvider && this.hasEncryptedKey(data, data.activeProvider)) {
      return data.activeProvider
    }
    return ALL_PROVIDER_IDS.find((provider) =>
      this.hasEncryptedKey(data, provider)
    ) ?? null
  }

  /**
   * 金鑰健康狀態：不只看檔案有沒有條目，還實際驗證能否解密。
   * safeStorage 的加密金鑰（Chromium Local State）若曾被重建（例如 userData 搬移、
   * 多實例同時寫入），舊密文會永遠解不開——此時必須提示使用者重新輸入，
   * 而不是回報「已設定」卻在生成解說時才失敗。
   */
  getKeyHealth(): SecretKeyHealth {
    const data = this.read()
    const provider =
      data.activeProvider && this.hasEncryptedKey(data, data.activeProvider)
        ? data.activeProvider
        : ALL_PROVIDER_IDS.find((candidate) =>
            this.hasEncryptedKey(data, candidate)
          ) ?? null
    if (!provider) return { provider: null, configured: false, needsReentry: false }
    const decryptable =
      this.getApiKey(provider) !== null &&
      (provider !== 'openai-compatible' || Boolean(data.activeBaseUrl))
    return { provider, configured: decryptable, needsReentry: !decryptable }
  }

  getBoundBaseUrl(providerId: AIProviderId): string | null {
    const data = this.read()
    return data.activeProvider === providerId ? data.activeBaseUrl ?? null : null
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
    if (data.activeProvider === providerId) {
      data.activeProvider = null
      data.activeBaseUrl = null
    }
    this.write(data)
  }

  deleteActiveApiKey(): void {
    const data = this.read()
    data.secrets = {}
    data.activeProvider = null
    data.activeBaseUrl = null
    data.version = 3
    this.write(data)
  }

  private hasEncryptedKey(data: SecretsFile, providerId: AIProviderId): boolean {
    return (
      typeof data.secrets[providerId] === 'string' &&
      data.secrets[providerId].length > 0
    )
  }

  private read(): SecretsFile {
    if (!existsSync(this.filePath)) {
      return { secrets: {}, version: 1 }
    }
    try {
      const parsed = readJsonFile<unknown>(this.filePath, MAX_SECRET_FILE_BYTES)
      if (
        typeof parsed !== 'object' ||
        parsed === null ||
        !('secrets' in parsed) ||
        typeof parsed.secrets !== 'object' ||
        parsed.secrets === null
      ) {
        return { secrets: {}, version: 1 }
      }
      const secrets = Object.fromEntries(
        Object.entries(parsed.secrets).filter(
          ([provider, value]) =>
            ALL_PROVIDER_IDS.includes(provider as AIProviderId) &&
            typeof value === 'string' &&
            value.length <= MAX_SECRET_FILE_BYTES
        )
      )
      const activeProvider =
        'activeProvider' in parsed &&
        ALL_PROVIDER_IDS.includes(parsed.activeProvider as AIProviderId)
          ? (parsed.activeProvider as AIProviderId)
          : null
      let activeBaseUrl: string | null = null
      if (
        activeProvider === 'openai-compatible' &&
        'activeBaseUrl' in parsed &&
        typeof parsed.activeBaseUrl === 'string'
      ) {
        try {
          activeBaseUrl = normalizeAiBaseUrl(parsed.activeBaseUrl)
        } catch {
          activeBaseUrl = null
        }
      }
      return { secrets, activeProvider, activeBaseUrl, version: 3 }
    } catch {
      return { secrets: {}, version: 1 }
    }
  }

  private write(data: SecretsFile): void {
    writeJsonFileAtomic(this.filePath, data, MAX_SECRET_FILE_BYTES)
  }
}
