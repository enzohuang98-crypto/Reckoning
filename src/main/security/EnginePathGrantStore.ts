import { randomUUID } from 'node:crypto'

interface EnginePathGrant {
  senderId: number
  executablePath: string
  expiresAt: number
}

export class EnginePathGrantError extends Error {
  constructor() {
    super('Engine path selection is missing, expired, or already used.')
    this.name = 'EnginePathGrantError'
  }
}

/** Main-owned, sender-bound, one-time authority created by the native picker. */
export class EnginePathGrantStore {
  private readonly grants = new Map<string, EnginePathGrant>()

  constructor(
    private readonly ttlMs = 120_000,
    private readonly now: () => number = Date.now
  ) {}

  issue(senderId: number, executablePath: string): string {
    this.removeExpired()
    const token = randomUUID()
    this.grants.set(token, {
      senderId,
      executablePath,
      expiresAt: this.now() + this.ttlMs
    })
    return token
  }

  consume(senderId: number, token: string): string {
    const grant = this.grants.get(token)
    this.grants.delete(token)
    if (
      !grant ||
      grant.senderId !== senderId ||
      grant.expiresAt < this.now()
    ) {
      throw new EnginePathGrantError()
    }
    return grant.executablePath
  }

  private removeExpired(): void {
    const now = this.now()
    for (const [token, grant] of this.grants) {
      if (grant.expiresAt < now) this.grants.delete(token)
    }
  }
}
