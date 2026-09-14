/**
 * 安全金鑰儲存 (SecretStore)
 *
 * 每把金鑰綁定到精確的 provider + model + normalized baseUrl。renderer 只能
 * 取得不含密文的 metadata；明文只會在 main process 內解密。
 */

import { app, safeStorage } from 'electron'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import {
  ALL_PROVIDER_IDS,
  PROVIDER_DEFAULT_MODELS,
  type AIProviderId
} from '@shared/types/AIProviderTypes'
import type {
  SecretCredentialMetadata,
  SecretCredentialRef,
  SecretStatus
} from '@shared/types/ipc'
import {
  MAX_SECRET_FILE_BYTES,
  normalizeAiBaseUrl
} from '../security/InputValidation'
import { readJsonFileAsync, writeJsonFileAtomicAsync } from './SecureJsonFile'

interface StoredCredential extends SecretCredentialRef {
  encryptedKey: string
}

interface SecretsFileV4 {
  credentials: StoredCredential[]
  activeCredential?: SecretCredentialRef | null
  version: 4
}

interface LegacySecretsFileV3 {
  secrets: Record<string, string>
  activeProvider?: AIProviderId | null
  activeBaseUrl?: string | null
}

interface SecretEncryption {
  isEncryptionAvailable(): boolean
  encryptString(value: string): Buffer
  decryptString(value: Buffer): string
}

export interface SecretCredentialSnapshot {
  credential: SecretCredentialRef
  apiKey: string
  revision: number
}

export class SecretCredentialChangedError extends Error {
  readonly name = 'SecretCredentialChangedError'

  constructor() {
    super('The active credential changed before the model switch was committed.')
  }
}

export class SecretCredentialConflictError extends Error {
  readonly name = 'SecretCredentialConflictError'

  constructor() {
    super('The target model already has a different credential.')
  }
}

const SECRETS_FILENAME = 'secrets.enc.json'
const MODEL_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$/

function defaultModel(provider: AIProviderId): string {
  const models = PROVIDER_DEFAULT_MODELS[provider]
  const model = models.find((candidate) => candidate.isDefault) ?? models[0]
  if (!model) throw new Error(`Provider ${provider} 沒有可安全遷移的預設模型。`)
  return model.id
}

function normalizeCredentialRef(
  provider: AIProviderId,
  model: string,
  baseUrl?: string | null
): SecretCredentialRef {
  const normalizedModel = model.trim()
  if (!MODEL_ID_PATTERN.test(normalizedModel)) {
    throw new Error('模型 ID 格式無效。')
  }
  return {
    provider,
    model: normalizedModel,
    ...(provider === 'openai-compatible'
      ? { baseUrl: normalizeAiBaseUrl(baseUrl) }
      : {})
  }
}

function credentialId(credential: SecretCredentialRef): string {
  return JSON.stringify([
    credential.provider,
    credential.model,
    credential.baseUrl ?? ''
  ])
}

function sameCredential(
  left: SecretCredentialRef | null | undefined,
  right: SecretCredentialRef | null | undefined
): boolean {
  return Boolean(left && right && credentialId(left) === credentialId(right))
}

export class SecretStore {
  private readonly filePath: string
  private readonly encryption: SecretEncryption
  private mutationQueue: Promise<void> = Promise.resolve()
  private revision = 0

  constructor(
    filePath?: string,
    encryption: SecretEncryption = safeStorage
  ) {
    this.filePath = filePath ?? join(app.getPath('userData'), SECRETS_FILENAME)
    this.encryption = encryption
  }

  isEncryptionAvailable(): boolean {
    return this.encryption.isEncryptionAvailable()
  }

  /** 新增或更新精確憑證；其他模型與 provider 的憑證不受影響。 */
  async setCredential(
    provider: AIProviderId,
    model: string,
    apiKey: string,
    baseUrl?: string
  ): Promise<SecretCredentialRef> {
    return this.enqueueMutation(async () => {
      if (!this.encryption.isEncryptionAvailable()) {
        throw new Error('此系統不支援安全加密儲存，拒絕以明文保存金鑰。')
      }
      const ref = normalizeCredentialRef(provider, model, baseUrl)
      const data = await this.read()
      const encryptedKey = this.encryption.encryptString(apiKey).toString('base64')
      const next: StoredCredential = { ...ref, encryptedKey }
      const id = credentialId(ref)
      const existingIndex = data.credentials.findIndex(
        (credential) => credentialId(credential) === id
      )
      if (existingIndex >= 0) data.credentials[existingIndex] = next
      else data.credentials.push(next)
      data.activeCredential = ref
      await this.write(data)
      this.revision += 1
      return ref
    })
  }

  /** 只允許把可解密的精確憑證設為使用中。 */
  async setActiveCredential(
    provider: AIProviderId,
    model: string,
    baseUrl?: string
  ): Promise<boolean> {
    return this.enqueueMutation(async () => {
      const ref = normalizeCredentialRef(provider, model, baseUrl)
      const data = await this.read()
      const stored = this.findStored(data, ref)
      if (!stored || this.decrypt(stored) === null) return false
      data.activeCredential = ref
      await this.write(data)
      this.revision += 1
      return true
    })
  }

  /** 是否存在精確密文；不代表目前仍能解密。 */
  async hasCredential(
    provider: AIProviderId,
    model: string,
    baseUrl?: string
  ): Promise<boolean> {
    const ref = normalizeCredentialRef(provider, model, baseUrl)
    await this.mutationQueue
    return Boolean(this.findStored(await this.read(), ref))
  }

  /** 僅供 main process 使用；不存在或無法解密時回傳 null。 */
  async getCredential(
    provider: AIProviderId,
    model: string,
    baseUrl?: string
  ): Promise<string | null> {
    const ref = normalizeCredentialRef(provider, model, baseUrl)
    await this.mutationQueue
    const stored = this.findStored(await this.read(), ref)
    return stored ? this.decrypt(stored) : null
  }

  /** 以單一序列化讀取捕獲 active 的模型、明文與 instance revision。 */
  async captureActiveCredential(
    expected?: SecretCredentialRef
  ): Promise<SecretCredentialSnapshot | null> {
    return this.enqueueMutation(async () => {
      const data = await this.read()
      const active = data.activeCredential
      if (!active || (expected && !sameCredential(active, expected))) return null
      const stored = this.findStored(data, active)
      if (!stored) return null
      const apiKey = this.decrypt(stored)
      if (apiKey === null) return null
      return {
        credential: { ...active },
        apiKey,
        revision: this.revision
      }
    })
  }

  /** 以單一序列化讀取捕獲精確憑證，避免 has/get 間的競爭。 */
  async captureCredential(
    provider: AIProviderId,
    model: string,
    baseUrl?: string
  ): Promise<{ apiKey: string | null; exists: boolean }> {
    const ref = normalizeCredentialRef(provider, model, baseUrl)
    return this.enqueueMutation(async () => {
      const stored = this.findStored(await this.read(), ref)
      return {
        apiKey: stored ? this.decrypt(stored) : null,
        exists: Boolean(stored)
      }
    })
  }

  /**
   * 將仍為 active 的來源密文原子改綁到目標模型。驗證在鎖外完成；
   * commit 時以 revision 與 active ref 拒絕過期操作。
   */
  async rebindOpenRouterCredential(
    snapshot: SecretCredentialSnapshot,
    targetModel: string
  ): Promise<SecretCredentialRef> {
    return this.enqueueMutation(async () => {
      const source = normalizeCredentialRef(
        snapshot.credential.provider,
        snapshot.credential.model,
        snapshot.credential.baseUrl
      )
      const target = normalizeCredentialRef('openrouter', targetModel)
      const data = await this.read()
      if (
        source.provider !== 'openrouter' ||
        source.baseUrl !== undefined ||
        snapshot.revision !== this.revision ||
        !sameCredential(data.activeCredential, source)
      ) {
        throw new SecretCredentialChangedError()
      }
      const sourceStored = this.findStored(data, source)
      const sourceKey = sourceStored ? this.decrypt(sourceStored) : null
      if (!sourceStored || sourceKey === null || sourceKey !== snapshot.apiKey) {
        throw new SecretCredentialChangedError()
      }
      if (sameCredential(source, target)) return target

      const targetStored = this.findStored(data, target)
      if (targetStored) {
        const targetKey = this.decrypt(targetStored)
        if (targetKey === null || targetKey !== sourceKey) {
          throw new SecretCredentialConflictError()
        }
        data.credentials = data.credentials.filter(
          (credential) => !sameCredential(credential, source)
        )
      } else {
        const sourceIndex = data.credentials.findIndex(
          (credential) => sameCredential(credential, source)
        )
        data.credentials[sourceIndex] = {
          ...target,
          encryptedKey: sourceStored.encryptedKey
        }
      }
      data.activeCredential = target
      await this.write(data)
      this.revision += 1
      return target
    })
  }

  /** 刪除一把精確憑證；同 provider 的其他模型仍會保留。 */
  async deleteCredential(
    provider: AIProviderId,
    model: string,
    baseUrl?: string
  ): Promise<void> {
    await this.enqueueMutation(async () => {
      const ref = normalizeCredentialRef(provider, model, baseUrl)
      const data = await this.read()
      const id = credentialId(ref)
      data.credentials = data.credentials.filter(
        (credential) => credentialId(credential) !== id
      )
      if (sameCredential(data.activeCredential, ref)) {
        data.activeCredential = this.firstDecryptable(data)?.ref ?? null
      }
      await this.write(data)
      this.revision += 1
    })
  }

  /** 回傳安全 metadata；不包含明文或密文。 */
  async getStatus(): Promise<SecretStatus> {
    await this.mutationQueue
    const data = await this.read()
    const credentials: SecretCredentialMetadata[] = data.credentials.map(
      (stored) => {
        const configured = this.decrypt(stored) !== null
        return {
          provider: stored.provider,
          model: stored.model,
          ...(stored.baseUrl ? { baseUrl: stored.baseUrl } : {}),
          configured,
          needsReentry: !configured
        }
      }
    )
    const activeCandidate = data.activeCredential
      ? credentials.find((credential) => sameCredential(credential, data.activeCredential))
      : undefined
    const fallback = credentials.find((credential) => credential.configured)
    const activeMetadata = activeCandidate?.configured
      ? activeCandidate
      : fallback ?? activeCandidate ?? credentials[0]
    const activeCredential = activeMetadata
      ? {
          provider: activeMetadata.provider,
          model: activeMetadata.model,
          ...(activeMetadata.baseUrl ? { baseUrl: activeMetadata.baseUrl } : {})
        }
      : null
    return {
      configured: activeMetadata?.configured ?? false,
      needsReentry: activeMetadata?.needsReentry ?? false,
      activeCredential,
      credentials
    }
  }

  private findStored(
    data: SecretsFileV4,
    ref: SecretCredentialRef
  ): StoredCredential | undefined {
    const id = credentialId(ref)
    return data.credentials.find((credential) => credentialId(credential) === id)
  }

  private decrypt(stored: StoredCredential): string | null {
    try {
      return this.encryption.decryptString(
        Buffer.from(stored.encryptedKey, 'base64')
      )
    } catch {
      return null
    }
  }

  private firstDecryptable(
    data: SecretsFileV4
  ): { ref: SecretCredentialRef; apiKey: string } | null {
    for (const stored of data.credentials) {
      const apiKey = this.decrypt(stored)
      if (apiKey !== null) {
        const { provider, model, baseUrl } = stored
        return {
          ref: {
            provider,
            model,
            ...(baseUrl ? { baseUrl } : {})
          },
          apiKey
        }
      }
    }
    return null
  }

  private async read(): Promise<SecretsFileV4> {
    if (!existsSync(this.filePath)) {
      return { credentials: [], activeCredential: null, version: 4 }
    }
    try {
      const parsed = await readJsonFileAsync<unknown>(
        this.filePath,
        MAX_SECRET_FILE_BYTES
      )
      if (this.isV4File(parsed)) return this.normalizeV4(parsed)
      const migrated = this.migrateV3(parsed)
      await this.write(migrated)
      return migrated
    } catch {
      return { credentials: [], activeCredential: null, version: 4 }
    }
  }

  private isV4File(value: unknown): value is SecretsFileV4 {
    return (
      typeof value === 'object' &&
      value !== null &&
      'version' in value &&
      value.version === 4 &&
      'credentials' in value &&
      Array.isArray(value.credentials)
    )
  }

  private normalizeV4(data: SecretsFileV4): SecretsFileV4 {
    const unique = new Map<string, StoredCredential>()
    for (const raw of data.credentials) {
      if (
        typeof raw !== 'object' ||
        raw === null ||
        !ALL_PROVIDER_IDS.includes(raw.provider) ||
        typeof raw.model !== 'string' ||
        typeof raw.encryptedKey !== 'string' ||
        raw.encryptedKey.length === 0 ||
        raw.encryptedKey.length > MAX_SECRET_FILE_BYTES
      ) {
        continue
      }
      try {
        const ref = normalizeCredentialRef(raw.provider, raw.model, raw.baseUrl)
        unique.set(credentialId(ref), { ...ref, encryptedKey: raw.encryptedKey })
      } catch {
        // 不安全或損壞的 metadata 不進入可選清單。
      }
    }
    let activeCredential: SecretCredentialRef | null = null
    if (data.activeCredential) {
      try {
        const candidate = normalizeCredentialRef(
          data.activeCredential.provider,
          data.activeCredential.model,
          data.activeCredential.baseUrl
        )
        if (unique.has(credentialId(candidate))) activeCredential = candidate
      } catch {
        activeCredential = null
      }
    }
    return {
      credentials: [...unique.values()],
      activeCredential,
      version: 4
    }
  }

  /** v3 的 provider-only 金鑰遷移到該 provider 的預設模型。 */
  private migrateV3(value: unknown): SecretsFileV4 {
    if (
      typeof value !== 'object' ||
      value === null ||
      !('secrets' in value) ||
      typeof value.secrets !== 'object' ||
      value.secrets === null
    ) {
      return { credentials: [], activeCredential: null, version: 4 }
    }
    const legacy = value as LegacySecretsFileV3
    const credentials: StoredCredential[] = []
    for (const provider of ALL_PROVIDER_IDS) {
      const encryptedKey = legacy.secrets[provider]
      if (
        typeof encryptedKey !== 'string' ||
        encryptedKey.length === 0 ||
        encryptedKey.length > MAX_SECRET_FILE_BYTES
      ) {
        continue
      }
      try {
        const ref = normalizeCredentialRef(
          provider,
          defaultModel(provider),
          provider === 'openai-compatible' && legacy.activeProvider === provider
            ? legacy.activeBaseUrl
            : undefined
        )
        credentials.push({ ...ref, encryptedKey })
      } catch {
        // 舊相容服務沒有可信任的綁定網址時不可遷移，避免把 key 送錯端點。
      }
    }
    const active = credentials.find(
      (credential) => credential.provider === legacy.activeProvider
    )
    return {
      credentials,
      activeCredential: active
        ? {
            provider: active.provider,
            model: active.model,
            ...(active.baseUrl ? { baseUrl: active.baseUrl } : {})
          }
        : null,
      version: 4
    }
  }

  private async write(data: SecretsFileV4): Promise<void> {
    await writeJsonFileAtomicAsync(this.filePath, data, MAX_SECRET_FILE_BYTES)
  }

  private enqueueMutation<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.mutationQueue.then(operation)
    this.mutationQueue = result.then(
      () => undefined,
      () => undefined
    )
    return result
  }
}
