# L2 資安設計基線

本文件定義本專案的「L2」為本機桌面應用的中等強度防護基線。它是專案內部的驗收等級，不代表 ISO 27001、SOC 2 或政府法規認證。

## 保護目標

- Renderer 即使遭 XSS 或 UI 套件污染，也不能直接取得 Node.js、任意 IPC、API Key 或本機檔案能力。
- 只有本應用的主 frame 可以呼叫 IPC；所有跨邊界 payload 都需要執行期驗證與大小限制。
- API Key 使用作業系統安全儲存加密，秘密與一般資料分離。
- 設定、授權、秘密與使用者資料採限制大小、拒絕符號連結及同目錄原子寫入。
- 生產版不得載入任意遠端頁面、開啟 HTTP 連結、請求瀏覽器權限或由 renderer 下載檔案。
- 打包程式限制 Electron 的 Node 啟動參數、file protocol 特權及 ASAR 替換攻擊面。

## 已實作控制

| 領域 | L2 控制 |
| --- | --- |
| Electron 隔離 | `sandbox: true`、`contextIsolation: true`、`nodeIntegration: false`、`webviewTag: false`、生產版 DevTools 關閉 |
| 內容載入 | 生產版使用 `xqa://app/` 自訂安全協定；解析後路徑必須留在 renderer 根目錄且不可為符號連結 |
| CSP | `default-src 'none'`，腳本只允許 self，物件、frame、表單與生產版網路連線全部封鎖 |
| 導覽與外連 | 封鎖非本頁導覽及 popup；只把無帳密、標準連接埠的 HTTPS URL 交給系統瀏覽器 |
| 權限與下載 | Chromium permission check/request 全拒絕；renderer 下載事件全拒絕 |
| IPC | 驗證 sender 是受信任 URL 的 main frame；分析、AI、秘密、資料、引擎路徑及授權輸入均有 allowlist、格式與長度限制 |
| 程序與 AI | 引擎路徑必須為絕對路徑；Windows 限 `.exe`；AI 串流輸出上限 1,000,000 字元；Provider 錯誤不直接回傳內部訊息 |
| 持久化 | JSON 讀取限制大小並拒絕非一般檔案；寫入採 `0600` 暫存檔、flush、rename、清除殘檔 |
| 秘密 | Electron `safeStorage` 加密；renderer 只能 set/has/delete，不能讀回明文 |
| 打包 | 關閉 RunAsNode、NODE_OPTIONS、Node CLI inspect、file protocol 額外權限；開啟 cookie 加密、ASAR 完整性及 only-load-from-ASAR |
| 驗證 | `tests/security.test.ts` 覆蓋 URL、路徑穿越、IPC payload、大小限制、原子寫入與靜態安全設定 |

## 信任與剩餘風險

- 使用者自行選擇的象棋引擎是受信任的本機可執行檔。本程式會隔離 renderer，但不會沙箱第三方引擎程序；只應使用可信來源與已驗證雜湊的引擎。
- AI 解說會把棋局與追問送到使用者選定的第三方 Provider。API Key 不會送到 renderer，但第三方服務仍受其隱私條款約束。
- 本機系統管理員、已入侵的作業系統、鍵盤側錄器與記憶體擷取不在 L2 防護範圍。
- 目前個人測試安裝檔未做發行者程式碼簽章。公開散布前必須使用可信憑證簽署安裝檔，並發布 SHA-256 雜湊；這屬於發行供應鏈控制。

## 驗收與發行檢查

1. `npm run typecheck`
2. `npm test`
3. `npm run build`
4. 確認建置後 CSP 不含 `unsafe-eval`，且 production `connect-src` 為 `none`
5. `npm audit --omit=dev --audit-level=high`
6. `npm run dist`
7. 正式公開發行時驗證安裝檔簽章與 SHA-256

任何新增 IPC、外部 URL、檔案匯入或 Provider 都必須同步更新輸入驗證與 `security.test.ts`，否則不得視為維持 L2。
