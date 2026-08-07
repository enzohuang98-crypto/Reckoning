export class OperationBusyError extends Error {
  constructor() {
    super('Operation capacity is full.')
    this.name = 'OperationBusyError'
  }
}

/**
 * Main-process admission control for costly operations.
 * Identical keys can share one in-flight promise through run(); runExclusive()
 * rejects duplicates. Unrelated work is capped globally in both modes.
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

  runExclusive<T>(key: string, operation: () => Promise<T>): Promise<T> {
    if (this.inFlight.has(key) || this.inFlight.size >= this.maxActive) {
      return Promise.reject(new OperationBusyError())
    }
    return this.run(key, operation)
  }

  activeCount(): number {
    return this.inFlight.size
  }
}
