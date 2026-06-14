import { EngineRegistryService } from '../src/main/engine/EngineRegistryService'

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

console.log(`結果：${passed} 通過，${failed} 失敗`)
if (failed > 0) process.exitCode = 1
