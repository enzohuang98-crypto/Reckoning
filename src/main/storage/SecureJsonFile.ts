import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync
} from 'node:fs'
import {
  chmod,
  lstat,
  mkdir,
  readFile,
  rename,
  rm,
  writeFile
} from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { basename, dirname, join } from 'node:path'

export class SecureFileError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'SecureFileError'
  }
}

function assertRegularFile(filePath: string, maxBytes: number): void {
  const info = lstatSync(filePath)
  if (info.isSymbolicLink() || !info.isFile()) {
    throw new SecureFileError('Refusing to read a non-regular file.')
  }
  if (info.size > maxBytes) {
    throw new SecureFileError('JSON file exceeds the allowed size.')
  }
}

export function readJsonFile<T>(filePath: string, maxBytes: number): T {
  assertRegularFile(filePath, maxBytes)
  const raw = readFileSync(filePath, 'utf8')
  if (Buffer.byteLength(raw, 'utf8') > maxBytes) {
    throw new SecureFileError('JSON file exceeds the allowed size.')
  }
  return JSON.parse(raw) as T
}

export function writeJsonFileAtomic<T>(
  filePath: string,
  data: T,
  maxBytes: number
): void {
  const serialized = JSON.stringify(data, null, 2)
  if (Buffer.byteLength(serialized, 'utf8') > maxBytes) {
    throw new SecureFileError('JSON data exceeds the allowed size.')
  }

  const directory = dirname(filePath)
  mkdirSync(directory, { recursive: true, mode: 0o700 })
  if (existsSync(filePath)) {
    const info = lstatSync(filePath)
    if (info.isSymbolicLink() || !info.isFile()) {
      throw new SecureFileError('Refusing to replace a non-regular file.')
    }
  }

  const tempPath = join(
    directory,
    `.${basename(filePath)}.${process.pid}.${randomUUID()}.tmp`
  )
  try {
    writeFileSync(tempPath, serialized, {
      encoding: 'utf8',
      flag: 'wx',
      mode: 0o600,
      flush: true
    })
    renameSync(tempPath, filePath)
    chmodSync(filePath, 0o600)
  } finally {
    if (existsSync(tempPath)) rmSync(tempPath, { force: true })
  }
}

/**
 * 非同步版本（node:fs/promises）；邏輯與上面的同步版本相同。
 * main process 與瀏覽器視窗共用同一條訊息迴圈執行緒，供互動路徑
 * （例如使用者按下儲存/刪除 API Key 時）使用，避免同步磁碟 I/O
 * ——尤其是 writeFileSync 的 flush:true（fsync）——卡住整個視窗沒有回應。
 */
async function assertRegularFileAsync(
  filePath: string,
  maxBytes: number
): Promise<void> {
  const info = await lstat(filePath)
  if (info.isSymbolicLink() || !info.isFile()) {
    throw new SecureFileError('Refusing to read a non-regular file.')
  }
  if (info.size > maxBytes) {
    throw new SecureFileError('JSON file exceeds the allowed size.')
  }
}

async function existsAsync(filePath: string): Promise<boolean> {
  try {
    await lstat(filePath)
    return true
  } catch {
    return false
  }
}

export async function readJsonFileAsync<T>(
  filePath: string,
  maxBytes: number
): Promise<T> {
  await assertRegularFileAsync(filePath, maxBytes)
  const raw = await readFile(filePath, 'utf8')
  if (Buffer.byteLength(raw, 'utf8') > maxBytes) {
    throw new SecureFileError('JSON file exceeds the allowed size.')
  }
  return JSON.parse(raw) as T
}

export async function writeJsonFileAtomicAsync<T>(
  filePath: string,
  data: T,
  maxBytes: number
): Promise<void> {
  const serialized = JSON.stringify(data, null, 2)
  if (Buffer.byteLength(serialized, 'utf8') > maxBytes) {
    throw new SecureFileError('JSON data exceeds the allowed size.')
  }

  const directory = dirname(filePath)
  await mkdir(directory, { recursive: true, mode: 0o700 })
  if (await existsAsync(filePath)) {
    const info = await lstat(filePath)
    if (info.isSymbolicLink() || !info.isFile()) {
      throw new SecureFileError('Refusing to replace a non-regular file.')
    }
  }

  const tempPath = join(
    directory,
    `.${basename(filePath)}.${process.pid}.${randomUUID()}.tmp`
  )
  try {
    await writeFile(tempPath, serialized, {
      encoding: 'utf8',
      flag: 'wx',
      mode: 0o600,
      flush: true
    })
    await rename(tempPath, filePath)
    await chmod(filePath, 0o600)
  } finally {
    if (await existsAsync(tempPath)) await rm(tempPath, { force: true })
  }
}
