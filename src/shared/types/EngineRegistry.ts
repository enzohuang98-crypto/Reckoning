import type { EngineProtocol } from './EngineAnalysis'

export type EngineProfileId =
  | 'pikafish'
  | 'px0'
  | 'chessmaster'
  | 'cyclone'
  | 'bugchess'
  | 'wuyun'
  | 'alphacat'
  | 'elephant-eye'
  | 'jiajia'
  | 'maxqi'
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
    id: 'px0',
    label: 'PikaXiangqiZero / Px0',
    protocolPreference: 'uci',
    description: 'UCI 神經網路象棋引擎，實際硬體與權重需求依版本而異。'
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
    id: 'wuyun',
    label: '烏雲象棋',
    protocolPreference: null,
    description: '依引擎版本自動偵測 UCI 或 UCCI。'
  },
  {
    id: 'alphacat',
    label: '阿爾法貓',
    protocolPreference: null,
    description: '依版本自動偵測 UCI 或 UCCI。'
  },
  {
    id: 'elephant-eye',
    label: '象眼',
    protocolPreference: null,
    description: '依引擎版本自動偵測 UCI 或 UCCI。'
  },
  {
    id: 'jiajia',
    label: '佳佳象棋',
    protocolPreference: null,
    description: '依引擎版本自動偵測 UCI 或 UCCI。'
  },
  {
    id: 'maxqi',
    label: 'MaxQi',
    protocolPreference: null,
    description: '依引擎版本自動偵測 UCI 或 UCCI。'
  },
  {
    id: 'custom',
    label: '自訂 UCI／UCCI 引擎',
    protocolPreference: null,
    description: '適用於其他遵循 UCI 或 UCCI 的本機象棋引擎。'
  }
]

const ENGINE_PROFILE_IDS = new Set<EngineProfileId>(
  ENGINE_PROFILES.map((profile) => profile.id)
)

export function isEngineProfileId(value: unknown): value is EngineProfileId {
  return typeof value === 'string' && ENGINE_PROFILE_IDS.has(value as EngineProfileId)
}

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
  return (
    ENGINE_PROFILES.find((profile) => profile.id === id) ??
    ENGINE_PROFILES.find((profile) => profile.id === 'custom')!
  )
}
