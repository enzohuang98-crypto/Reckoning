import { randomUUID } from 'node:crypto'
import {
  EMPTY_ENGINE_REGISTRY,
  getEngineProfile,
  type EngineCapabilities,
  type EngineInstallation,
  type EngineProfileId,
  type EngineRegistrySnapshot
} from '@shared/types/EngineRegistry'
import type { EngineProtocol } from '@shared/types/EngineAnalysis'
import type { StorageService } from '../storage/StorageService'
import { PikafishAdapter } from './PikafishAdapter'

export const ENGINE_REGISTRY_FILE = 'engine-registry.json'
const LEGACY_ENGINE_CONFIG_FILE = 'engine-config.json'

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

function sanitizeInstallation(value: unknown): EngineInstallation | null {
  if (typeof value !== 'object' || value === null) return null
  const item = value as Partial<EngineInstallation>
  if (
    typeof item.id !== 'string' ||
    typeof item.displayName !== 'string' ||
    typeof item.executablePath !== 'string'
  ) {
    return null
  }
  const profileId: EngineProfileId =
    item.profileId === 'pikafish' ||
    item.profileId === 'chessmaster' ||
    item.profileId === 'cyclone' ||
    item.profileId === 'bugchess' ||
    item.profileId === 'alphacat' ||
    item.profileId === 'custom'
      ? item.profileId
      : 'custom'
  return {
    id: item.id,
    profileId,
    displayName: item.displayName.trim() || getEngineProfile(profileId).label,
    executablePath: item.executablePath,
    protocol: isProtocol(item.protocol) ? item.protocol : null,
    detectedName: typeof item.detectedName === 'string' ? item.detectedName : null,
    enabled: item.enabled !== false,
    verified: item.verified === true,
    capabilities: {
      ...defaultCapabilities(),
      ...(typeof item.capabilities === 'object' && item.capabilities !== null
        ? item.capabilities
        : {})
    },
    lastTestedAt:
      typeof item.lastTestedAt === 'string' ? item.lastTestedAt : undefined,
    lastError: typeof item.lastError === 'string' ? item.lastError : undefined
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
    const installation: EngineInstallation = {
      id: randomUUID(),
      profileId: 'pikafish',
      displayName: 'Pikafish',
      executablePath: legacy.enginePath,
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
