import type { IpcMainEvent, IpcMainInvokeEvent } from 'electron'

let trustedRendererUrl: string | null = null

function comparableUrl(rawUrl: string): string | null {
  try {
    const url = new URL(rawUrl)
    url.hash = ''
    return url.toString()
  } catch {
    return null
  }
}

export function configureTrustedRendererUrl(rawUrl: string): void {
  const normalized = comparableUrl(rawUrl)
  if (!normalized) throw new Error('Trusted renderer URL is invalid.')
  trustedRendererUrl = normalized
}

export function isTrustedRendererUrl(actualUrl: string, expectedUrl: string): boolean {
  const actual = comparableUrl(actualUrl)
  const expected = comparableUrl(expectedUrl)
  return actual !== null && expected !== null && actual === expected
}

export function assertTrustedIpcSender(
  event: IpcMainEvent | IpcMainInvokeEvent
): void {
  if (!trustedRendererUrl) {
    throw new Error('Trusted renderer URL has not been configured.')
  }
  const senderFrame = event.senderFrame
  if (
    !senderFrame ||
    senderFrame !== event.sender.mainFrame ||
    !isTrustedRendererUrl(senderFrame.url, trustedRendererUrl)
  ) {
    throw new Error('Rejected IPC call from an untrusted renderer.')
  }
}

export function isAllowedExternalUrl(rawUrl: string): boolean {
  try {
    const url = new URL(rawUrl)
    return (
      url.protocol === 'https:' &&
      url.username === '' &&
      url.password === '' &&
      (url.port === '' || url.port === '443')
    )
  } catch {
    return false
  }
}
