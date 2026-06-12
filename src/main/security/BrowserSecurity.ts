import {
  net,
  protocol,
  session,
  type BrowserWindow,
  type Event
} from 'electron'
import { lstatSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { isAllowedExternalUrl } from './IpcSecurity'
import {
  APP_SCHEME,
  resolveRendererAssetPath
} from './RendererPath'

export { PRODUCTION_RENDERER_URL } from './RendererPath'

protocol.registerSchemesAsPrivileged([
  {
    scheme: APP_SCHEME,
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: false,
      stream: true,
      codeCache: true
    }
  }
])

export function registerRendererProtocol(rendererRoot: string): void {
  protocol.handle(APP_SCHEME, (request) => {
    const filePath = resolveRendererAssetPath(rendererRoot, request.url)
    if (!filePath) return new Response('Not found', { status: 404 })
    try {
      const info = lstatSync(filePath)
      if (!info.isFile() || info.isSymbolicLink()) {
        return new Response('Not found', { status: 404 })
      }
    } catch {
      return new Response('Not found', { status: 404 })
    }
    return net.fetch(pathToFileURL(filePath).toString())
  })
}

export function hardenDefaultSession(isDev: boolean): void {
  const currentSession = session.defaultSession
  currentSession.setPermissionCheckHandler(() => false)
  currentSession.setPermissionRequestHandler((_webContents, _permission, callback) => {
    callback(false)
  })
  currentSession.on('will-download', (event) => event.preventDefault())

  if (!isDev) {
    currentSession.webRequest.onBeforeRequest((details, callback) => {
      const allowed =
        details.url.startsWith(`${APP_SCHEME}://app/`) ||
        details.url.startsWith('data:') ||
        details.url.startsWith('blob:')
      callback({ cancel: !allowed })
    })
  }
}

export function lockDownWindow(
  window: BrowserWindow,
  trustedRendererUrl: string,
  openExternal: (url: string) => Promise<void>
): void {
  const guardNavigation = (event: Event, targetUrl: string): void => {
    if (targetUrl === trustedRendererUrl) return
    event.preventDefault()
    if (isAllowedExternalUrl(targetUrl)) void openExternal(targetUrl)
  }

  window.webContents.on('will-navigate', guardNavigation)
  window.webContents.on('will-redirect', guardNavigation)
  window.webContents.on('will-attach-webview', (event) => event.preventDefault())
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (isAllowedExternalUrl(url)) void openExternal(url)
    return { action: 'deny' }
  })
}
