import { existsSync } from 'node:fs'
import {
  readJsonFile,
  writeJsonFileAtomicAsync
} from '../storage/SecureJsonFile'
import type { UpdatePreferences } from '@shared/types/AppUpdate'

const MAX_PREFERENCES_BYTES = 8 * 1024
const MAX_VERSION_LENGTH = 64

const DEFAULT_PREFERENCES: UpdatePreferences = {
  backgroundPreparationEnabled: true,
  skippedVersion: null,
  snoozedVersion: null,
  snoozeUntil: null
}

function safeVersion(value: unknown): string | null {
  if (value === null) return null
  if (typeof value !== 'string') return null
  const version = value.trim()
  return version.length > 0 && version.length <= MAX_VERSION_LENGTH
    ? version
    : null
}

function normalize(value: unknown): UpdatePreferences {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return { ...DEFAULT_PREFERENCES }
  }
  const input = value as Partial<UpdatePreferences>
  return {
    backgroundPreparationEnabled:
      typeof input.backgroundPreparationEnabled === 'boolean'
        ? input.backgroundPreparationEnabled
        : true,
    skippedVersion: safeVersion(input.skippedVersion),
    snoozedVersion: safeVersion(input.snoozedVersion),
    snoozeUntil:
      typeof input.snoozeUntil === 'number' &&
      Number.isFinite(input.snoozeUntil) &&
      input.snoozeUntil >= 0
        ? input.snoozeUntil
        : null
  }
}

export class UpdatePreferencesStore {
  private state: UpdatePreferences
  private writeQueue = Promise.resolve()

  constructor(private readonly filePath: string) {
    try {
      this.state = existsSync(filePath)
        ? normalize(readJsonFile<unknown>(filePath, MAX_PREFERENCES_BYTES))
        : { ...DEFAULT_PREFERENCES }
    } catch {
      // 損壞或不安全的偏好檔不影響啟動；採安全預設且不覆寫原檔。
      this.state = { ...DEFAULT_PREFERENCES }
    }
  }

  get(): UpdatePreferences {
    return { ...this.state }
  }

  setBackgroundPreparation(enabled: boolean): Promise<void> {
    return this.commit((current) => ({
      ...current,
      backgroundPreparationEnabled: enabled
    }))
  }

  skipVersion(version: string): Promise<void> {
    const normalized = safeVersion(version)
    if (!normalized) return Promise.reject(new Error('Invalid update version.'))
    return this.commit((current) => ({
      ...current,
      skippedVersion: normalized,
      snoozedVersion: null,
      snoozeUntil: null
    }))
  }

  clearSkippedVersion(version: string): Promise<void> {
    return this.commit((current) =>
      current.skippedVersion === version
        ? { ...current, skippedVersion: null }
        : current
    )
  }

  snoozeVersion(version: string, until: number): Promise<void> {
    const normalized = safeVersion(version)
    if (!normalized || !Number.isFinite(until) || until < 0) {
      return Promise.reject(new Error('Invalid update snooze preference.'))
    }
    return this.commit((current) => ({
      ...current,
      snoozedVersion: normalized,
      snoozeUntil: until
    }))
  }

  clearSnooze(version: string): Promise<void> {
    return this.commit((current) =>
      current.snoozedVersion === version
        ? { ...current, snoozedVersion: null, snoozeUntil: null }
        : current
    )
  }

  private commit(
    update: (current: UpdatePreferences) => UpdatePreferences
  ): Promise<void> {
    const write = this.writeQueue.then(async () => {
      const next = update(this.state)
      if (next === this.state) return
      await writeJsonFileAtomicAsync(this.filePath, next, MAX_PREFERENCES_BYTES)
      this.state = next
    })
    this.writeQueue = write.catch(() => undefined)
    return write
  }
}
