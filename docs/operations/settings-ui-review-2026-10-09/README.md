# 設定頁變更前後：2026-10-09

這四張圖來自隔離 Electron 的實際 React／CSS fixture，使用合成 SecretStatus 與模型目錄，API key 欄位為空，所有網路請求被封鎖。它們只證明來源 UI 的提示與導覽差異，不是 provider、已安裝 App、正式候選或 Windows 更新驗收。

固定對照僅替換 `AiSettingsSection.tsx`、`SettingsNavigation.tsx`、`SettingsPage.tsx` 三檔：before 為 `62e0da16732a5888b3480cec7f68c0f60fe1d49c`，after 為 `8cbc5d4c21d82965115f4e2f738af76e0f6cb9cb`。其他 fixture／CSS 使用 after 來源；viewport 1008×900、zoom 100%。每張圖的來源、大小與 SHA-256 在 [manifest.json](manifest.json)。

| 狀態 | 變更前 | 變更後 |
|---|---|---|
| 尚未讀取免費目錄 | [錯誤地宣稱模型已不在清單](before-unknown-catalog.png) | [保留未知狀態，不宣稱下架](after-unknown-catalog.png) |
| 已讀取目錄且仍選目前模型 | [錯誤地宣稱尚未儲存](before-loaded-current-model.png) | [顯示已啟用](after-loaded-current-model.png) |

兩組圖也顯示本機引擎導覽由「複核與分析時間」改為「引擎安裝與連線驗證」。四圖已逐一視覺檢閱。產生器初次因隱藏視窗關閉造成提早退出，沒有完整 manifest；第一次完成捕捉又含前一個未刷新畫面。這兩個產物不作驗收，修正生命週期與 settled capture 後重新產生目前四圖及 manifest，命令 `node node_modules/electron/cli.js ../oct09-settings-review.cjs` exit 0 且明確輸出四圖 PASS。產生器與 log 位於工作區上一層，未放入產品 bundle。
