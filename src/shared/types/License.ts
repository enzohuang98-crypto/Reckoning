/**
 * 買斷授權型別 (License types) — SDS Q5（買斷授權需要 License Key）
 *
 * 離線驗證設計：License Key 內含簽章過的授權資料（Ed25519），
 * 驗證只需內嵌的公開金鑰，不需要 license server，符合「本機優先、
 * 不建置自有後端」的整體架構（SDS §2.1.1、附錄 B）。
 *
 * Key 格式：XQA1.<base64url(payload JSON)>.<base64url(Ed25519 簽章)>
 * 私鑰只存在於發行者手上（tools/license/license-keygen.ts），絕不進入程式碼或安裝檔。
 */

/** 簽章內的授權資料（payload） */
export interface LicenseInfo {
  /** 授權編號（發行時生成） */
  licenseId: string
  /** 被授權人（顯示用） */
  licensee: string
  /** 產品識別碼；必須等於 "xiangqi-analyzer" */
  product: string
  /** 授權型態；第一版僅買斷 */
  edition: 'perpetual'
  /** 發行時間 (ISO) */
  issuedAt: string
}

/** 授權狀態（renderer 可見；不含完整 key） */
export interface LicenseStatus {
  activated: boolean
  /** 已啟用時的授權資料 */
  info?: LicenseInfo
  /** 啟用時間 (ISO) */
  activatedAt?: string
  /** 未啟用/驗證失敗的原因（人話） */
  message?: string
}
