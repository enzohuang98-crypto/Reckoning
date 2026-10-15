import {
  readJsonFileAsync,
  writeJsonFileAtomicAsync
} from '../storage/SecureJsonFile'
import { isValidAIModelId } from '@shared/types/AIProviderTypes'

const MAX_PREFERENCES_BYTES = 8 * 1024
export const MAX_OPENROUTER_BACKUP_MODELS = 2

export interface AiPreferences {
  /** 使用者核可、主模型故障時可改用的 OpenRouter 免費模型（依序嘗試）。 */
  openRouterBackupModels: string[]
}

const DEFAULT_PREFERENCES: AiPreferences = { openRouterBackupModels: [] }

function isFreeModelId(value: unknown): value is string {
  return typeof value === 'string' && isValidAIModelId(value) && value.endsWith(':free')
}

function normalize(value: unknown): AiPreferences {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return { openRouterBackupModels: [] }
  }
  const raw = (value as Partial<AiPreferences>).openRouterBackupModels
  return {
    openRouterBackupModels: Array.isArray(raw)
      ? [...new Set(raw.filter(isFreeModelId))].slice(0, MAX_OPENROUTER_BACKUP_MODELS)
      : []
  }
}

export type BackupModelValidation =
  | { ok: true; models: string[] }
  | { ok: false; message: string }

/**
 * 備援模型只能由 main 驗證後保存：格式合法、以 :free 結尾、存在於這把已存金鑰
 * 讀到的即時免費清單、不等於主模型，最多 2 個。
 */
export function validateOpenRouterBackupModels(
  value: unknown,
  primaryModel: string,
  availableFreeModelIds: readonly string[]
): BackupModelValidation {
  if (!Array.isArray(value)) return { ok: false, message: '備援模型格式無效。' }
  const models = value.map((item) => (typeof item === 'string' ? item.trim() : item))
  if (models.length > MAX_OPENROUTER_BACKUP_MODELS) {
    return { ok: false, message: `備援模型最多 ${MAX_OPENROUTER_BACKUP_MODELS} 個。` }
  }
  const available = new Set(availableFreeModelIds)
  const accepted: string[] = []
  for (const model of models) {
    if (!isFreeModelId(model)) {
      return { ok: false, message: '備援模型必須是 OpenRouter 的 :free 模型。' }
    }
    if (model === primaryModel) {
      return { ok: false, message: '備援模型不能和主模型相同。' }
    }
    if (!available.has(model)) {
      return { ok: false, message: `模型 ${model} 目前不在免費清單中，請重新讀取模型。` }
    }
    if (!accepted.includes(model)) accepted.push(model)
  }
  return { ok: true, models: accepted }
}

/** 非機密 AI 偏好；非同步原子寫入（設計原則 §9），損壞時採安全預設。 */
export class AiPreferencesStore {
  private state: AiPreferences = { ...DEFAULT_PREFERENCES }
  private initialization: Promise<void> | null = null
  private writeQueue = Promise.resolve()

  constructor(private readonly filePath: string) {}

  initialize(): Promise<void> {
    if (this.initialization) return this.initialization
    this.initialization = (async () => {
      try {
        this.state = normalize(
          await readJsonFileAsync<unknown>(this.filePath, MAX_PREFERENCES_BYTES)
        )
      } catch {
        this.state = { openRouterBackupModels: [] }
      }
    })()
    return this.initialization
  }

  async get(): Promise<AiPreferences> {
    await this.initialize()
    return { openRouterBackupModels: [...this.state.openRouterBackupModels] }
  }

  setOpenRouterBackupModels(models: readonly string[]): Promise<void> {
    const write = this.writeQueue.then(async () => {
      await this.initialize()
      const next = normalize({ openRouterBackupModels: models })
      await writeJsonFileAtomicAsync(this.filePath, next, MAX_PREFERENCES_BYTES)
      this.state = next
    })
    this.writeQueue = write.catch(() => undefined)
    return write
  }
}
