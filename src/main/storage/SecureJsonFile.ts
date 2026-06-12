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
