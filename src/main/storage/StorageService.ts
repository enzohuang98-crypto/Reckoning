/**
 * 一般 JSON 檔案儲存 (StorageService)
 *
 * 在 userData 下讀寫一般 JSON 檔（非機密）。
 * 注意：API 金鑰絕不經此服務儲存，請改用 SecretStore。
 */

import { app } from 'electron'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

export class StorageService {
  private readonly baseDir: string

  constructor(baseDir?: string) {
    this.baseDir = baseDir ?? app.getPath('userData')
  }

  private resolve(name: string): string {
    return join(this.baseDir, name)
  }

  /** 讀取 JSON 檔，不存在時回傳 fallback */
  read<T>(name: string, fallback: T): T {
    const path = this.resolve(name)
    if (!existsSync(path)) return fallback
    try {
      return JSON.parse(readFileSync(path, 'utf8')) as T
    } catch {
      return fallback
    }
  }

  /** 寫入 JSON 檔 */
  write<T>(name: string, data: T): void {
    const path = this.resolve(name)
    const dir = dirname(path)
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
    writeFileSync(path, JSON.stringify(data, null, 2), { encoding: 'utf8' })
  }

  /** 檔案是否存在 */
  exists(name: string): boolean {
    return existsSync(this.resolve(name))
  }
}
