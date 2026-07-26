export class OperationBusyError extends Error {
  constructor() {
    super('Operation capacity is full.')
    this.name = 'OperationBusyError'
  }
}

/**
 * Main-process admission control for costly operations.
 * Identical keys share one in-flight promise; unrelated work is capped globally.
 */
export class KeyedOperationGate {
  private readonly inFlight = new Map<string, Promise<unknown>>()

  constructor(private readonly maxActive: number) {
    if (!Number.isSafeInteger(maxActive) || maxActive < 1) {
      throw new RangeError('maxActive must be a positive integer.')
    }
  }

  run<T>(key: string, operation: () => Promise<T>): Promise<T> {
    const existing = this.inFlight.get(key)
    if (existing) return existing as Promise<T>
    if (this.inFlight.size >= this.maxActive) {
      return Promise.reject(new OperationBusyError())
    }

    const promise = operation().finally(() => {
      if (this.inFlight.get(key) === promise) this.inFlight.delete(key)
    })
    this.inFlight.set(key, promise)
    return promise
  }

  activeCount(): number {
    return this.inFlight.size
  }
}
