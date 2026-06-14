import type { EngineProtocol } from './EngineAnalysis'

export type EngineProfileId =
  | 'pikafish'
  | 'chessmaster'
  | 'cyclone'
  | 'bugchess'
  | 'alphacat'
  | 'custom'

export interface EngineProfile {
  id: EngineProfileId
  label: string
  protocolPreference: EngineProtocol | null
  description: string
}

export const ENGINE_PROFILES: EngineProfile[] = [
  {
    id: 'pikafish',
    label: 'Pikafish',
    protocolPreference: 'uci',
    description: 'UCI 象棋引擎，通常需要同目錄權重檔。'
  },
  {
    id: 'chessmaster',
    label: '象棋名手',
    protocolPreference: 'ucci',
    description: 'UCCI 相容引擎，實際選項依版本而異。'
  },
  {
    id: 'cyclone',
    label: '象棋旋風',
    protocolPreference: 'ucci',
    description: 'UCCI 相容引擎，實際選項依版本而異。'
  },
  {
    id: 'bugchess',
    label: '象棋小蟲',
    protocolPreference: 'ucci',
    description: 'UCCI 相容引擎，實際選項依版本而異。'
  },
  {
    id: 'alphacat',
    label: '阿爾法貓',
    protocolPreference: null,
    description: '依版本自動偵測 UCI 或 UCCI。'
  },
  {
    id: 'custom',
    label: '自訂 UCI／UCCI 引擎',
    protocolPreference: null,
    description: '適用於其他遵循 UCI 或 UCCI 的本機象棋引擎。'
  }
]

export interface EngineCapabilities {
  multiPv: boolean
  configurableThreads: boolean
  configurableHash: boolean
}

export interface EngineInstallation {
  id: string
  profileId: EngineProfileId
  displayName: string
  executablePath: string
  protocol: EngineProtocol | null
  detectedName: string | null
  enabled: boolean
  verified: boolean
  capabilities: EngineCapabilities
  lastTestedAt?: string
  lastError?: string
}

export interface EngineRegistrySnapshot {
  installations: EngineInstallation[]
  activeEngineId: string | null
  verificationEngineId: string | null
}

export const EMPTY_ENGINE_REGISTRY: EngineRegistrySnapshot = {
  installations: [],
  activeEngineId: null,
  verificationEngineId: null
}

export function getEngineProfile(id: EngineProfileId): EngineProfile {
  return ENGINE_PROFILES.find((profile) => profile.id === id) ?? ENGINE_PROFILES[5]
}
