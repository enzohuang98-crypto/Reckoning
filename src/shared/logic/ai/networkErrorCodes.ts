/**
 * 連線錯誤代碼的判讀（純函式，main 與 renderer 共用）。
 *
 * 憑證類代碼代表 HTTPS 憑證驗證失敗，最常見的原因是防毒軟體的 HTTPS 掃描或公司網路
 * 用自己的根憑證攔截連線。這類錯誤重試或換模型都不會好，處理方式也和一般斷線不同。
 */

const CERTIFICATE_CODE = /CERT|SELF_SIGNED|UNABLE_TO_(GET_ISSUER|VERIFY)|HOSTNAME_MISMATCH/

export function isCertificateErrorCode(code: string | undefined): boolean {
  return typeof code === 'string' && CERTIFICATE_CODE.test(code)
}

export const CERTIFICATE_ERROR_MESSAGE =
  'HTTPS 憑證驗證失敗：防毒軟體的 HTTPS 掃描或公司網路可能攔截了連線。請把 AI 服務網址加入防毒軟體的排除清單，或暫時關閉 HTTPS 掃描後重試。'
