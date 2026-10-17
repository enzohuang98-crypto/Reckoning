import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { resolve } from 'node:path'
import type { ChildProcess } from 'node:child_process'
import {
  ILLEGAL_INSTRUCTION_EXIT_CODE,
  compatibleEnginePath,
  probeEngineCpu
} from '../../../src/main/engine/bundledEngine'
import { EngineRegistryService } from '../../../src/main/engine/EngineRegistryService'
import type { StorageService } from '../../../src/main/storage/StorageService'

interface FakeChild {
  child: ChildProcess
  stdinText: () => string
  killed: () => boolean
}

function fakeChild(behaviour: (emitter: EventEmitter) => void): FakeChild {
  const emitter = new EventEmitter()
  let written = ''
  let killed = false
  const stdin = new EventEmitter() as EventEmitter & { end: (text: string) => void }
  stdin.end = (text: string) => {
    written += text
    setImmediate(() => behaviour(emitter))
  }
  Object.assign(emitter, { stdin, kill: () => { killed = true; return true } })
  return { child: emitter as unknown as ChildProcess, stdinText: () => written, killed: () => killed }
}

async function main(): Promise<void> {
  // 沒有 AVX2 的 CPU：Windows 以 STATUS_ILLEGAL_INSTRUCTION 結束（無號或有號值）。
  for (const code of [ILLEGAL_INSTRUCTION_EXIT_CODE, ILLEGAL_INSTRUCTION_EXIT_CODE - 2 ** 32]) {
    const fake = fakeChild((child) => child.emit('exit', code))
    assert.equal(await probeEngineCpu('C:\\app\\engine\\pikafish.exe', () => fake.child), 'unsupported_cpu')
    assert.equal(fake.stdinText(), 'uci\nquit\n', '只送握手與結束，不做搜尋')
  }

  const ok = fakeChild((child) => child.emit('exit', 0))
  assert.equal(await probeEngineCpu('x', () => ok.child), 'ok')

  // 其他失敗（找不到檔案、一般錯誤碼、逾時）不改引擎，交給原本的錯誤訊息。
  const missing = fakeChild((child) => child.emit('error', new Error('ENOENT')))
  assert.equal(await probeEngineCpu('x', () => missing.child), 'unknown')
  const other = fakeChild((child) => child.emit('exit', 1))
  assert.equal(await probeEngineCpu('x', () => other.child), 'unknown')
  const hang = fakeChild(() => undefined)
  assert.equal(await probeEngineCpu('x', () => hang.child, 20), 'unknown')
  assert.equal(hang.killed(), true, '逾時要結束試跑的程序')
  assert.equal(await probeEngineCpu('x', () => { throw new Error('spawn failed') }), 'unknown')

  assert.match(compatibleEnginePath('/opt/app/engine/pikafish.exe'), /engine[\\/]pikafish-sse41-popcnt\.exe$/)

  // 登錄：只有指向內建 AVX2 版的項目，且確定是 CPU 不支援時才改成相容版。
  const writes: unknown[] = []
  const storage = {
    read: <T,>(_file: string, fallback: T): T => fallback,
    writeAsync: async (_file: string, value: unknown) => { writes.push(value) }
  } as unknown as StorageService
  // 用平台的絕對路徑：登錄會以 path.resolve 正規化（Windows 會補上磁碟代號）。
  const bundled = resolve('/opt/app/engine/pikafish.exe')
  const fallback = compatibleEnginePath(bundled)
  const registry = new EngineRegistryService(storage, bundled)
  const before = registry.list().installations
  assert.equal(before.length, 1)
  assert.equal(before[0]!.executablePath, bundled)

  assert.equal(await registry.useCompatibleBundledEngineIfNeeded(bundled, fallback, async () => 'ok'), false)
  assert.equal(registry.list().installations[0]!.executablePath, bundled, '能跑就不改')
  assert.equal(await registry.useCompatibleBundledEngineIfNeeded(bundled, fallback, async () => 'unknown'), false)
  assert.equal(registry.list().installations[0]!.executablePath, bundled, '不確定原因時不改')

  let probed = 0
  assert.equal(
    await registry.useCompatibleBundledEngineIfNeeded(bundled, fallback, async () => { probed += 1; return 'unsupported_cpu' }),
    true
  )
  const switched = registry.list().installations[0]!
  assert.equal(switched.executablePath, fallback)
  assert.equal(switched.verified, false)
  assert.equal(registry.getAdapter()?.constructor.name, 'PikafishAdapter', '改路徑後會建立新的引擎介面')
  await registry.flush()
  assert.ok(writes.length > 0, '改用相容版後會寫回登錄')

  // 已改過（或使用者自備引擎）就不再試跑。
  assert.equal(await registry.useCompatibleBundledEngineIfNeeded(bundled, fallback, async () => { probed += 1; return 'unsupported_cpu' }), false)
  assert.equal(probed, 1)

  console.log('bundled engine CPU fallback tests passed')
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
