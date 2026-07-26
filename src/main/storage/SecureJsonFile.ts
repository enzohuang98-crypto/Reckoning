import {
  chmodSync,
  closeSync,
  constants,
  existsSync,
  fstatSync,
  lstatSync,
  mkdirSync,
  openSync,
  readSync,
  renameSync,
  rmSync,
  writeFileSync
} from 'node:fs'
import type { Stats } from 'node:fs'
import {
  chmod,
  lstat,
  mkdir,
  open,
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

const MAX_READ_CHUNK_BYTES = 64 * 1024
const READ_ONLY_NO_FOLLOW =
  constants.O_RDONLY |
  (typeof constants.O_NOFOLLOW === 'number' ? constants.O_NOFOLLOW : 0)

function assertPathCandidate(filePath: string, maxBytes: number): Stats {
  const info = lstatSync(filePath)
  if (info.isSymbolicLink() || !info.isFile()) {
    throw new SecureFileError('Refusing to read a non-regular file.')
  }
  if (info.size > maxBytes) {
    throw new SecureFileError('JSON file exceeds the allowed size.')
  }
  return info
}

function assertOpenedFile(
  checked: Stats,
  opened: Stats,
  maxBytes: number
): void {
  if (!opened.isFile()) {
    throw new SecureFileError('Refusing to read a non-regular file.')
  }
  if (opened.size > maxBytes) {
    throw new SecureFileError('JSON file exceeds the allowed size.')
  }
  if (
    checked.dev !== 0 &&
    checked.ino !== 0 &&
    (checked.dev !== opened.dev || checked.ino !== opened.ino)
  ) {
    throw new SecureFileError('JSON file changed while it was being opened.')
  }
}

function readBoundedSync(fd: number, maxBytes: number): Buffer {
  const chunks: Buffer[] = []
  let total = 0
  while (total <= maxBytes) {
    const capacity = Math.min(MAX_READ_CHUNK_BYTES, maxBytes + 1 - total)
    const chunk = Buffer.allocUnsafe(capacity)
    const bytesRead = readSync(fd, chunk, 0, capacity, null)
    if (bytesRead === 0) break
    total += bytesRead
    if (total > maxBytes) {
      throw new SecureFileError('JSON file exceeds the allowed size.')
    }
    chunks.push(chunk.subarray(0, bytesRead))
  }
  return Buffer.concat(chunks, total)
}

export function readJsonFile<T>(filePath: string, maxBytes: number): T {
  const checked = assertPathCandidate(filePath, maxBytes)
  let fd: number | null = null
  try {
    fd = openSync(filePath, READ_ONLY_NO_FOLLOW)
    assertOpenedFile(checked, fstatSync(fd), maxBytes)
    return JSON.parse(readBoundedSync(fd, maxBytes).toString('utf8')) as T
  } finally {
    if (fd !== null) closeSync(fd)
  }
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
async function assertPathCandidateAsync(
  filePath: string,
  maxBytes: number
): Promise<Stats> {
  const info = await lstat(filePath)
  if (info.isSymbolicLink() || !info.isFile()) {
    throw new SecureFileError('Refusing to read a non-regular file.')
  }
  if (info.size > maxBytes) {
    throw new SecureFileError('JSON file exceeds the allowed size.')
  }
  return info
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
  const checked = await assertPathCandidateAsync(filePath, maxBytes)
  const handle = await open(filePath, READ_ONLY_NO_FOLLOW)
  try {
    const opened = await handle.stat()
    assertOpenedFile(checked, opened, maxBytes)
    const chunks: Buffer[] = []
    let total = 0
    while (total <= maxBytes) {
      const capacity = Math.min(
        MAX_READ_CHUNK_BYTES,
        maxBytes + 1 - total
      )
      const chunk = Buffer.allocUnsafe(capacity)
      const { bytesRead } = await handle.read(chunk, 0, capacity, null)
      if (bytesRead === 0) break
      total += bytesRead
      if (total > maxBytes) {
        throw new SecureFileError('JSON file exceeds the allowed size.')
      }
      chunks.push(chunk.subarray(0, bytesRead))
    }
    return JSON.parse(Buffer.concat(chunks, total).toString('utf8')) as T
  } finally {
    await handle.close()
  }
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
