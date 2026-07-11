import type { EngineRegistrySnapshot } from '@shared/types/EngineRegistry'

export function hasVerifiedActiveEngine(registry: EngineRegistrySnapshot): boolean {
  return registry.installations.some(
    (installation) =>
      installation.id === registry.activeEngineId && installation.verified
  )
}

export async function retryOnce<T>(
  operation: () => Promise<T>,
  succeeded: (result: T) => boolean,
  delayMs: number,
  wait: (delayMs: number) => Promise<void> = (delay) =>
    new Promise((resolve) => setTimeout(resolve, delay))
): Promise<T> {
  const first = await operation()
  if (succeeded(first)) return first
  await wait(delayMs)
  return operation()
}
