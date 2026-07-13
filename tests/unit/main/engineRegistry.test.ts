import { EngineRegistryService } from '../../../src/main/engine/EngineRegistryService'
import {
  ENGINE_PROFILES,
  getEngineProfile,
  isEngineProfileId
} from '../../../src/shared/types/EngineRegistry'

let passed = 0
let failed = 0

function check(name: string, condition: boolean): void {
  if (condition) {
    passed++
    console.log(`  ✓ ${name}`)
  } else {
    failed++
    console.error(`  ✗ ${name}`)
  }
}

class FakeStorage {
  readonly values = new Map<string, unknown>()

  read<T>(name: string, fallback: T): T {
    return (this.values.has(name) ? this.values.get(name) : fallback) as T
  }

  write<T>(name: string, value: T): void {
    this.values.set(name, structuredClone(value))
  }
}

console.log('\n## 多引擎登錄')

const storage = new FakeStorage()
const registry = new EngineRegistryService(storage as never)
const pikafish = registry.add({
  profileId: 'pikafish',
  executablePath: 'C:\\Engines\\pikafish.exe'
})
const cyclone = registry.add({
  profileId: 'cyclone',
  displayName: '測試旋風',
  executablePath: 'C:\\Engines\\cyclone.exe'
})

check('可加入多個引擎', registry.list().installations.length === 2)
check('第一個引擎自動成為主引擎', registry.list().activeEngineId === pikafish.id)
check('預設協定依引擎 profile 設定', cyclone.protocol === 'ucci')
check(
  '常見引擎選項包含小蟲、旋風、烏雲與 Px0',
  ['bugchess', 'cyclone', 'wuyun', 'px0'].every((id) =>
    ENGINE_PROFILES.some((profile) => profile.id === id)
  )
)
check(
  '所有顯示的引擎 profile 都能通過 main 邊界驗證',
  ENGINE_PROFILES.every((profile) => isEngineProfileId(profile.id))
)
check('其他 UCI／UCCI 引擎仍可使用自訂 profile', getEngineProfile('unknown' as never).id === 'custom')

const profileStorage = new FakeStorage()
const profileRegistry = new EngineRegistryService(profileStorage as never)
for (const [index, profile] of ENGINE_PROFILES.entries()) {
  profileRegistry.add({
    profileId: profile.id,
    executablePath: `C:\\Engines\\profile-${index}.exe`
  })
}
const reloadedProfiles = new EngineRegistryService(profileStorage as never)
  .list()
  .installations.map((installation) => installation.profileId)
check(
  '所有引擎 profile 儲存後重啟仍可保留',
  ENGINE_PROFILES.every((profile) => reloadedProfiles.includes(profile.id))
)

registry.select(cyclone.id, pikafish.id)
check('可分別選擇主引擎與複核引擎', registry.list().verificationEngineId === pikafish.id)

registry.updateDetected(cyclone.id, {
  verified: true,
  detectedName: 'Cyclone Test',
  protocol: 'ucci'
})
check(
  '只有實際測試後才標示已驗證',
  registry.getInstallation(cyclone.id)?.verified === true
)

registry.remove(cyclone.id)
check('移除主引擎後自動切換剩餘引擎', registry.list().activeEngineId === pikafish.id)
check('移除主引擎時清除衝突的複核選擇', registry.list().verificationEngineId === null)

const legacyStorage = new FakeStorage()
legacyStorage.values.set('engine-config.json', {
  enginePath: 'C:\\Engines\\legacy.exe',
  engineProtocol: 'uci'
})
const migrated = new EngineRegistryService(legacyStorage as never).list()
check('舊版單一路徑會遷移為 Pikafish 安裝項目', migrated.installations.length === 1)
check('遷移不會錯誤標示為已驗證', migrated.installations[0]?.verified === false)

const tamperedStorage = new FakeStorage()
tamperedStorage.values.set('engine-registry.json', {
  installations: [
    {
      id: 'bad',
      profileId: 'pikafish',
      displayName: 'Remote engine',
      executablePath: '\\\\server\\share\\engine.exe',
      protocol: 'uci',
      detectedName: null,
      enabled: true,
      verified: true,
      capabilities: { multiPv: true, configurableThreads: false, configurableHash: false }
    }
  ],
  activeEngineId: 'bad',
  verificationEngineId: null
})
const tampered = new EngineRegistryService(tamperedStorage as never).list()
check('讀取既有登錄檔時會丟棄不安全的網路共享引擎路徑', tampered.installations.length === 0)

const dirtyStorage = new FakeStorage()
dirtyStorage.values.set('engine-registry.json', {
  installations: [
    {
      id: 'engine_1',
      profileId: 'cyclone',
      displayName: 'Cyclone\nInjected',
      executablePath: 'C:\\Engines\\..\\Engines\\cyclone.exe',
      protocol: 'ucci',
      detectedName: 'Detected\rName',
      enabled: true,
      verified: true,
      capabilities: { multiPv: 'yes', configurableThreads: true, configurableHash: 'no' },
      lastError: `x${'!'.repeat(800)}`
    }
  ],
  activeEngineId: 'engine_1',
  verificationEngineId: null
})
const dirty = new EngineRegistryService(dirtyStorage as never).list()
check('讀取既有登錄檔時會正規化本機引擎路徑', dirty.installations[0]?.executablePath === 'C:\\Engines\\cyclone.exe')
check('讀取既有登錄檔時會移除顯示名稱控制字元', dirty.installations[0]?.displayName === 'CycloneInjected')
check('讀取既有登錄檔時會清洗 capabilities 型別', dirty.installations[0]?.capabilities.configurableThreads === true && dirty.installations[0]?.capabilities.configurableHash === false)

const unsafeLegacyStorage = new FakeStorage()
unsafeLegacyStorage.values.set('engine-config.json', {
  enginePath: '\\\\server\\share\\legacy.exe',
  engineProtocol: 'uci'
})
const unsafeMigrated = new EngineRegistryService(unsafeLegacyStorage as never).list()
check('舊版單一路徑遷移會拒絕不安全路徑', unsafeMigrated.installations.length === 0)

console.log(`結果：${passed} 通過，${failed} 失敗`)
if (failed > 0) process.exitCode = 1
