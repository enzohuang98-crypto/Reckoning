import { isAbsolute, relative, resolve } from 'node:path'

export const APP_SCHEME = 'xqa'
export const PRODUCTION_RENDERER_URL = `${APP_SCHEME}://app/index.html`

export function resolveRendererAssetPath(
  rendererRoot: string,
  requestUrl: string
): string | null {
  try {
    const url = new URL(requestUrl)
    if (url.protocol !== `${APP_SCHEME}:` || url.hostname !== 'app') return null
    const decodedPath = decodeURIComponent(url.pathname)
    if (decodedPath.includes('\0')) return null
    const relativePath = decodedPath.replace(/^\/+/, '') || 'index.html'
    const root = resolve(rendererRoot)
    const candidate = resolve(root, relativePath)
    const fromRoot = relative(root, candidate)
    if (fromRoot.startsWith('..') || isAbsolute(fromRoot)) return null
    return candidate
  } catch {
    return null
  }
}
