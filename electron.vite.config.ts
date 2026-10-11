import { resolve } from 'path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'
import type { Plugin } from 'vite'
import { isolatedUpdaterProbeId } from './tools/acceptance/isolated-build-policy'

function contentSecurityPolicyPlugin(): Plugin {
  return {
    name: 'xiangqi-content-security-policy',
    transformIndexHtml(html, context) {
      const connectSrc = context.server
        ? "connect-src 'self' http://localhost:* http://127.0.0.1:* ws://localhost:* ws://127.0.0.1:*"
        : "connect-src 'none'"
      const policy = [
        "default-src 'none'",
        "base-uri 'none'",
        "object-src 'none'",
        "frame-src 'none'",
        "frame-ancestors 'none'",
        "form-action 'none'",
        "script-src 'self'",
        "style-src 'self' 'unsafe-inline'",
        "img-src 'self' data:",
        "font-src 'self'",
        connectSrc
      ].join('; ')
      return html.replace('__XQA_CSP__', policy)
    }
  }
}

export default defineConfig(({ mode }) => {
  const define = { __ISOLATED_UPDATER_PROBE_ID__: JSON.stringify(isolatedUpdaterProbeId(mode, process.env)) }
  return {
  main: {
    define,
    plugins: [externalizeDepsPlugin()],
    resolve: {
      alias: {
        '@shared': resolve('src/shared')
      }
    }
  },
  preload: {
    define,
    plugins: [externalizeDepsPlugin()],
    resolve: {
      alias: {
        '@shared': resolve('src/shared')
      }
    }
  },
  renderer: {
    define,
    resolve: {
      alias: {
        '@shared': resolve('src/shared'),
        '@renderer': resolve('src/renderer/src')
      }
    },
    plugins: [contentSecurityPolicyPlugin(), react()]
  }
  }
})
