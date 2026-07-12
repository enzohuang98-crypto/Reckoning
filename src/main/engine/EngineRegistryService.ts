import { randomUUID } from 'node:crypto'
import {
  EMPTY_ENGINE_REGISTRY,
  getEngineProfile,
  isEngineProfileId,
  type EngineCapabilities,
  type EngineInstallation,
  type EngineProfileId,
  type EngineRegistrySnapshot
} from '@shared/types/EngineRegistry'
import type { EngineProtocol } from '@shared/types/EngineAnalysis'
import type { StorageService } from '../storage/StorageService'
import { normalizeEnginePath } from '../security/InputValidation'
import { PikafishAdapter } from './PikafishAdapter'

export const ENGINE_REGISTRY_FILE = 'engine-registry.json'
const LEGACY_ENGINE_CONFIG_FILE = 'engine-config.json'
const ENGINE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/
const MAX_ENGINE_NAME_LENGTH = 80
const MAX_ENGINE_ERROR_LENGTH = 500

interface LegacyEngineConfig {
  enginePath?: unknown
  engineProtocol?: unknown
}

function defaultCapabilities(): EngineCapabilities {
  return {
    multiPv: true,
    configurableThreads: false,
    configurableHash: false
  }
}

function isProtocol(value: unknown): value is EngineProtocol {
  return value === 'uci' || value === 'ucci'
}

function boundedDisplayString(
  value: unknown,
  fallback: string,
  maxLength = MAX_ENGINE_NAME_LENGTH
): string {
  if (typeof value !== 'string') return fallback
  const normalized = value
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .trim()
    .slice(0, maxLength)
  return normalized || fallback
}

function sanitizeCapabilities(value: unknown): EngineCapabilities {
  const base = defaultCapabilities()
  if (typeof value !== 'object' || value === null) return base
  const raw = value as Partial<EngineCapabilities>
  return {
    multiPv: typeof raw.multiPv === 'boolean' ? raw.multiPv : base.multiPv,
    configurableThreads:
      typeof raw.configurableThreads === 'boolean'
        ? raw.configurableThreads
        : base.configurableThreads,
    configurableHash:
      typeof raw.configurableHash === 'boolean'
        ? raw.configurableHash
        : base.configurableHash
  }
}

function sanitizeInstallation(value: unknown): EngineInstallation | null {
  if (typeof value !== 'object' || value === null) return null
  const item = value as Partial<EngineInstallation>
  if (
    typeof item.id !== 'string' ||
    !ENGINE_ID_PATTERN.test(item.id) ||
    typeof item.executablePath !== 'string'
  ) {
    return null
  }
  let executablePath: string
  try {
    const normalized = normalizeEnginePath(item.executablePath)
    if (!normalized) return null
    executablePath = normalized
  } catch {
    return null
  }
  const profileId: EngineProfileId = isEngineProfileId(item.profileId)
    ? item.profileId
    : 'custom'
  const profile = getEngineProfile(profileId)
  return {
    id: item.id,
    profileId,
    displayName: boundedDisplayString(item.displayName, profile.label),
    executablePath,
    protocol: isProtocol(item.protocol) ? item.protocol : null,
    detectedName:
      typeof item.detectedName === 'string'
        ? boundedDisplayString(item.detectedName, profile.label)
        : null,
    enabled: item.enabled !== false,
    verified: item.verified === true,
    capabilities: sanitizeCapabilities(item.capabilities),
    lastTestedAt:
      typeof item.lastTestedAt === 'string' ? item.lastTestedAt : undefined,
    lastError:
      typeof item.lastError === 'string'
        ? boundedDisplayString(item.lastError, '', MAX_ENGINE_ERROR_LENGTH) || undefined
        : undefined
  }
}

function sanitizeRegistry(value: unknown): EngineRegistrySnapshot {
  if (typeof value !== 'object' || value === null) return EMPTY_ENGINE_REGISTRY
  const candidate = value as Partial<EngineRegistrySnapshot>
  const installations = Array.isArray(candidate.installations)
    ? candidate.installations
        .map(sanitizeInstallation)
        .filter((item): item is EngineInstallation => item !== null)
        .slice(0, 20)
    : []
  const ids = new Set(installations.map((item) => item.id))
  return {
    installations,
    activeEngineId:
      typeof candidate.activeEngineId === 'string' &&
      ids.has(candidate.activeEngineId)
        ? candidate.activeEngineId
        : installations[0]?.id ?? null,
    verificationEngineId:
      typeof candidate.verificationEngineId === 'string' &&
      ids.has(candidate.verificationEngineId)
        ? candidate.verificationEngineId
        : null
  }
}

export class EngineRegistryService {
  private snapshot: EngineRegistrySnapshot
  private readonly adapters = new Map<string, PikafishAdapter>()

  constructor(private readonly storage: StorageService) {
    const stored = sanitizeRegistry(
      storage.read<unknown>(ENGINE_REGISTRY_FILE, EMPTY_ENGINE_REGISTRY)
    )
    this.snapshot =
      stored.installations.length > 0 ? stored : this.migrateLegacyConfiguration()
  }

  private migrateLegacyConfiguration(): EngineRegistrySnapshot {
    const legacy = this.storage.read<LegacyEngineConfig>(
      LEGACY_ENGINE_CONFIG_FILE,
      {}
    )
    if (typeof legacy.enginePath !== 'string' || !legacy.enginePath.trim()) {
      return EMPTY_ENGINE_REGISTRY
    }
    let executablePath: string
    try {
      const normalized = normalizeEnginePath(legacy.enginePath)
      if (!normalized) return EMPTY_ENGINE_REGISTRY
      executablePath = normalized
    } catch {
      return EMPTY_ENGINE_REGISTRY
    }
    const installation: EngineInstallation = {
      id: randomUUID(),
      profileId: 'pikafish',
      displayName: 'Pikafish',
      executablePath,
      protocol: isProtocol(legacy.engineProtocol) ? legacy.engineProtocol : null,
      detectedName: null,
      enabled: true,
      verified: false,
      capabilities: defaultCapabilities()
    }
    const migrated: EngineRegistrySnapshot = {
      installations: [installation],
      activeEngineId: installation.id,
      verificationEngineId: null
    }
    this.snapshot = migrated
    this.persist()
    return migrated
  }

  private persist(): void {
    this.storage.write(ENGINE_REGISTRY_FILE, this.snapshot)
  }

  list(): EngineRegistrySnapshot {
    return structuredClone(this.snapshot)
  }

  getInstallation(id?: string | null): EngineInstallation | null {
    const resolvedId = id ?? this.snapshot.activeEngineId
    return (
      this.snapshot.installations.find(
        (installation) => installation.id === resolvedId && installation.enabled
      ) ?? null
    )
  }

  getAdapter(id?: string | null): PikafishAdapter | null {
    const installation = this.getInstallation(id)
    if (!installation) return null
    const existing = this.adapters.get(installation.id)
    if (existing) return existing
    const adapter = new PikafishAdapter(
      installation.executablePath,
      installation.protocol,
      installation.displayName,
      installation.id
    )
    adapter.onProtocolDetected((protocol) => {
      this.updateDetected(installation.id, { protocol })
    })
    this.adapters.set(installation.id, adapter)
    return adapter
  }

  add(input: {
    profileId: EngineProfileId
    displayName?: string
    executablePath: string
  }): EngineInstallation {
    if (this.snapshot.installations.length >= 20) {
      throw new Error('最多只能加入 20 個引擎。')
    }
    const profile = getEngineProfile(input.profileId)
    const installation: EngineInstallation = {
      id: randomUUID(),
      profileId: profile.id,
      displayName: input.displayName?.trim() || profile.label,
      executablePath: input.executablePath,
      protocol: profile.protocolPreference,
      detectedName: null,
      enabled: true,
      verified: false,
      capabilities: defaultCapabilities()
    }
    this.snapshot = {
      ...this.snapshot,
      installations: [...this.snapshot.installations, installation],
      activeEngineId: this.snapshot.activeEngineId ?? installation.id
    }
    this.persist()
    return installation
  }

  remove(id: string): EngineRegistrySnapshot {
    this.adapters.get(id)?.setUserPath(null)
    this.adapters.delete(id)
    const installations = this.snapshot.installations.filter(
      (installation) => installation.id !== id
    )
    const activeEngineId =
      this.snapshot.activeEngineId === id
        ? installations[0]?.id ?? null
        : this.snapshot.activeEngineId
    const verificationEngineId =
      this.snapshot.verificationEngineId === id ||
      this.snapshot.verificationEngineId === activeEngineId
        ? null
        : this.snapshot.verificationEngineId
    this.snapshot = {
      installations,
      activeEngineId,
      verificationEngineId
    }
    this.persist()
    return this.list()
  }

  select(activeEngineId: string, verificationEngineId?: string | null): EngineRegistrySnapshot {
    if (!this.snapshot.installations.some((item) => item.id === activeEngineId)) {
      throw new Error('找不到指定的主引擎。')
    }
    if (
      verificationEngineId &&
      (!this.snapshot.installations.some(
        (item) => item.id === verificationEngineId
      ) ||
        verificationEngineId === activeEngineId)
    ) {
      throw new Error('複核引擎必須是另一個已安裝的引擎。')
    }
    this.snapshot = {
      ...this.snapshot,
      activeEngineId,
      verificationEngineId: verificationEngineId ?? null
    }
    this.persist()
    return this.list()
  }

  updateDetected(
    id: string,
    patch: Partial<
      Pick<
        EngineInstallation,
        | 'protocol'
        | 'detectedName'
        | 'verified'
        | 'capabilities'
        | 'lastTestedAt'
        | 'lastError'
      >
    >
  ): void {
    this.snapshot = {
      ...this.snapshot,
      installations: this.snapshot.installations.map((installation) =>
        installation.id === id ? { ...installation, ...patch } : installation
      )
    }
    this.persist()
  }

  replaceLegacyPath(path: string | null): EngineRegistrySnapshot {
    const active = this.getInstallation()
    if (!path) {
      if (active) return this.remove(active.id)
      return this.list()
    }
    if (!active) {
      this.add({ profileId: 'pikafish', executablePath: path })
      return this.list()
    }
    this.adapters.delete(active.id)
    this.snapshot = {
      ...this.snapshot,
      installations: this.snapshot.installations.map((installation) =>
        installation.id === active.id
          ? {
              ...installation,
              executablePath: path,
              protocol: getEngineProfile(installation.profileId).protocolPreference,
              detectedName: null,
              verified: false,
              lastError: undefined
            }
          : installation
      )
    }
    this.persist()
    return this.list()
  }
}
