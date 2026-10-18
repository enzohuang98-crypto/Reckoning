/**
 * 內建 Pikafish 的 CPU 相容性。
 *
 * 安裝檔內建的 `pikafish.exe` 是 AVX2 版本；沒有 AVX2 的 CPU（較舊電腦、部分 Celeron／Pentium 筆電）
 * 執行時會因非法指令直接結束，分析完全無法使用。啟動時以極短的握手試跑一次，
 * 只有確定是「CPU 不支援的指令」才改用同目錄的 SSE4.1 相容版；其他失敗（找不到檔案、逾時）維持原狀，
 * 交給原本的引擎錯誤訊息處理。
 */

import { spawn, type ChildProcess } from 'node:child_process'
import { dirname, join } from 'node:path'

/** Windows 的 STATUS_ILLEGAL_INSTRUCTION：程式用到 CPU 不支援的指令。 */
export const ILLEGAL_INSTRUCTION_EXIT_CODE = 0xc000001d

export const COMPATIBLE_ENGINE_FILE = 'pikafish-sse41-popcnt.exe'

const PROBE_TIMEOUT_MS = 5_000

export type EngineCpuProbe = 'ok' | 'unsupported_cpu' | 'unknown'

type SpawnEngine = (executablePath: string) => ChildProcess

const defaultSpawn: SpawnEngine = (executablePath) =>
  spawn(executablePath, [], { cwd: dirname(executablePath), windowsHide: true })

/** 試跑引擎的 UCI 握手後立即結束，回報這台 CPU 能不能執行它。 */
export function probeEngineCpu(
  executablePath: string,
  spawnEngine: SpawnEngine = defaultSpawn,
  timeoutMs = PROBE_TIMEOUT_MS
): Promise<EngineCpuProbe> {
  return new Promise((resolve) => {
    let settled = false
    const finish = (result: EngineCpuProbe): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve(result)
    }
    let child: ChildProcess
    try {
      child = spawnEngine(executablePath)
    } catch {
      resolve('unknown')
      return
    }
    const timer = setTimeout(() => {
      child.kill()
      finish('unknown')
    }, timeoutMs)
    child.on('error', () => finish('unknown'))
    child.on('exit', (code) => {
      // Node 在 Windows 以無號整數回報 NTSTATUS；有些環境會給有號值，兩種都接受。
      if (code === ILLEGAL_INSTRUCTION_EXIT_CODE || code === ILLEGAL_INSTRUCTION_EXIT_CODE - 2 ** 32) {
        finish('unsupported_cpu')
      } else {
        finish(code === 0 ? 'ok' : 'unknown')
      }
    })
    child.stdin?.on('error', () => undefined)
    child.stdin?.end('uci\nquit\n')
  })
}

/** 內建引擎的相容版路徑（與 pikafish.exe 同目錄）。 */
export function compatibleEnginePath(bundledEnginePath: string): string {
  return join(dirname(bundledEnginePath), COMPATIBLE_ENGINE_FILE)
}
