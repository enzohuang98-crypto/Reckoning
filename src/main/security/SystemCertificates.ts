/**
 * 讓主行程的 fetch 也信任作業系統的根憑證。
 *
 * Node（含 Electron 主行程）預設只信任內建的 Mozilla 根憑證清單，不讀 Windows 憑證存放區。
 * 防毒軟體（例如 Kaspersky 的 HTTPS 掃描）或公司網路會用自己安裝在 Windows 的根憑證重新簽發
 * HTTPS 連線；瀏覽器信任它，但 Node 的 fetch 會以 SELF_SIGNED_CERT_IN_CHAIN 失敗，
 * 使用者看到的就是「連不上 AI 服務」。這裡把系統根憑證加進預設清單（保留內建清單），
 * 信任範圍與瀏覽器相同。讀不到系統憑證時維持原狀，不擋啟動。
 */

import * as tls from 'node:tls'

export interface SystemCertificateResult {
  /** 實際新加入的系統根憑證數量。 */
  added: number
  /** 讀取或設定失敗時為 false（維持 Node 預設清單）。 */
  ok: boolean
}

export function trustSystemCertificates(api: Pick<typeof tls, 'getCACertificates' | 'setDefaultCACertificates'> = tls): SystemCertificateResult {
  try {
    if (typeof api.getCACertificates !== 'function' || typeof api.setDefaultCACertificates !== 'function') {
      return { added: 0, ok: false }
    }
    const current = api.getCACertificates('default')
    const known = new Set(current)
    const extra = api.getCACertificates('system').filter((cert) => !known.has(cert))
    if (extra.length === 0) return { added: 0, ok: true }
    api.setDefaultCACertificates([...current, ...extra])
    return { added: extra.length, ok: true }
  } catch {
    return { added: 0, ok: false }
  }
}
