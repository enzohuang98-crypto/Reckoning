/**
 * 一般 JSON 檔案儲存 (StorageService)
 *
 * 在 userData 下讀寫一般 JSON 檔（非機密）。
 * 注意：API 金鑰絕不經此服務儲存，請改用 SecretStore。
 */

import { app } from 'electron'
import { existsSync } from 'node:fs'
import { basename, isAbsolute, resolve } from 'node:path'
import {
  EMPTY_APP_DATA,
  sanitizeAppData,
  type AppDataSnapshot
} from '@shared/types/AppData'
import {
  MAX_APP_DATA_BYTES,
  MAX_BACKUP_BYTES,
  MAX_SETTINGS_FILE_BYTES
} from '../security/InputValidation'
import { readJsonFile, writeJsonFileAtomic } from './SecureJsonFile'

export const APP_DATA_FILE = 'app-data.json'

export class StorageService {
  private readonly baseDir: string

  constructor(baseDir?: string) {
    this.baseDir = baseDir ?? app.getPath('userData')
  }

  private resolve(name: string): string {
    if (
      !name ||
      isAbsolute(name) ||
      basename(name) !== name ||
      name === '.' ||
      name === '..'
    ) {
      throw new Error('Invalid storage file name.')
    }
    return resolve(this.baseDir, name)
  }

  /** 讀取 JSON 檔，不存在時回傳 fallback */
  read<T>(name: string, fallback: T, maxBytes = MAX_SETTINGS_FILE_BYTES): T {
    const path = this.resolve(name)
    if (!existsSync(path)) return fallback
    try {
      return readJsonFile<T>(path, maxBytes)
    } catch {
      return fallback
    }
  }

  /** 寫入 JSON 檔 */
  write<T>(name: string, data: T, maxBytes = MAX_SETTINGS_FILE_BYTES): void {
    const path = this.resolve(name)
    writeJsonFileAtomic(path, data, maxBytes)
  }

  readAppData(): AppDataSnapshot {
    return sanitizeAppData(
      this.read<unknown>(APP_DATA_FILE, EMPTY_APP_DATA, MAX_APP_DATA_BYTES)
    )
  }

  writeAppData(data: AppDataSnapshot): void {
    this.write(APP_DATA_FILE, sanitizeAppData(data), MAX_APP_DATA_BYTES)
  }

  readAbsolute<T>(path: string): T {
    if (!isAbsolute(path)) throw new Error('Backup path must be absolute.')
    return readJsonFile<T>(path, MAX_BACKUP_BYTES)
  }

  writeAbsolute<T>(path: string, data: T): void {
    if (!isAbsolute(path)) throw new Error('Backup path must be absolute.')
    writeJsonFileAtomic(path, data, MAX_BACKUP_BYTES)
  }

  /** 檔案是否存在 */
  exists(name: string): boolean {
    return existsSync(this.resolve(name))
  }
}
