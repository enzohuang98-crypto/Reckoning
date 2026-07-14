# 象棋 AI 分析講解：專案交接狀態

最後更新：2026-07-14

## 1. 目前工作位置與版本狀態

- 主要工作樹：`C:\Users\enzoh\Documents\Codex\2026-07-11\project-status-md-commit-github`
- 舊工作樹：`C:\Users\enzoh\Claude\象棋軟體專案\xiangqi-analyzer`（另行保留；不得直接覆蓋其未提交變更）
- Git 分支：`main`
- GitHub：`https://github.com/enzohuang98-crypto/xiangqi-analyzer`
- 本輪工作基底：`6cf40bfa34f4d434a34465008f4941f99391d10b`（`reorganize project structure without logic changes`）
- 已發布基線：`v0.3.0`
- 本輪目標版本：`v0.3.1`
- v0.3.1 release notes：`docs/releases/0.3.1.md`
- CI／Release workflow 使用目前官方 `actions/checkout@v7` 與 `actions/setup-node@v7`，不再依賴 GitHub 已棄用的 Node 20 action runtime。

本文件記錄 v0.3.1 候選版的實際狀態。程式變更目前仍須完成最後全套門檻、封裝、安裝、commit、push、tag、GitHub Release 與公開更新來源回讀後，才能宣告 v0.3.1 已正式交付。

## 2. 本輪已實作的修正

### 2.1 不需捲動整個頁面的分析工作區

- 分析頁改為「工具列／棋盤與 AI 工作區／底部即時分析」三列固定配置，頁面本身不再上下捲動。
- 棋盤依可用高度等比例縮放；展開擺棋工具或內容過長時，只讓所屬區塊內部捲動。
- 「放大／縮小棋盤」使用高度與寬度的雙重限制；在 1024×700 等低高度視窗也會產生可辨識的實際尺寸差異。
- 即時分析固定在視窗底部並填滿分配高度；主引擎只保留最新主線、結果區使用 compact 雙引擎摘要，兩側皆不再出現捲軸。
- compact 結果會把多個引擎警告合併成單一兩行摘要，避免最小視窗裁掉雙引擎方向；完整警告仍保留在分析資料抽屜。
- 完整候選著法、雙引擎比較、主／複核引擎原始資料保留在上方「分析資料」抽屜，不會因 compact 首屏而遺失。
- AI 教練與猜著保留在右上工作區；分析資料使用上方抽屜，不會把底部引擎分析推到首屏之外。
- 矮視窗會縮短頁首、工具列、面板標題與間距；空白狀態不再因固定最小高度出現無意義的內部捲軸。
- 非 compact 棋盤欄最低寬度由 560 px 調整為 520 px，避免 1024 px 寬視窗裁切右側 inspector。

### 2.2 持續引擎分析與可控的 AI 工作

- 主引擎與複核引擎 Live refinement 持續排程，不因切換頁籤、資料抽屜或 AI 教練而卸載。
- AI 解說固定使用送出當下的 FEN、analysis ID、主／複核引擎結果與對話歷史，後續 Live 更新不會改綁已送出的問題。
- 自動 AI 解說以局面／猜著為目標只嘗試一次，避免持續產生的新引擎結果觸發無限重跑。
- 使用者按停止或取消後，後續 Live 結果不會擅自重啟同一個 AI 請求。
- 未提供使用者著法時，prompt、審查、驗證與 fallback 都改為「當前局面分析」，不得虛構或批評不存在的使用者著法。
- 繁體中文、簡體中文與英文的具體棋理、因果、主線與證據不足判定使用各自可辨識的語言規則。

### 2.3 Gemini 與 Harness

- Gemini adapter 已使用 `generateContent` 端點實際接受的 `responseMimeType: application/json`，並使用低思考層級與不回傳 thought 的設定；解析時只組合非 thought 的最終文字部分。
- `thinkingLevel` 只送給 Gemini 3.x；token 紀錄會把 `thoughtsTokenCount` 納入輸出用量，非 2xx 回應本文讀取中的取消訊號也不會被錯誤訊息吞掉。
- 共用 AI request type 已能標示 text／JSON 回應格式，供 Harness 的結構化審查與寫作請求使用。
- 目前局面初次解說只做審查與寫作兩次模型呼叫，不再重跑持續引擎已有的研究；審查 JSON 無效時立即收尾，確定性 fallback 不再觸發修復模型。
- 同一 conversation 的追問改為一次模型呼叫、1,200 token 上限與零額外引擎輪次；會保留原問題並遵守句數／格式，無效 JSON 直接收斂到精簡引擎快照回答。
- 英文 `one`～`five sentences` 與數字句數要求都會被辨識、正規化並以實際句界驗證。
- JSON parser 可安全接受 fenced、雙重編碼與單一物件陣列，但所有結果仍須通過證據、著法、語言與 no-user hallucination 驗證。
- 對話記錄保存 provider、model、局面與引擎快照，並避免非同步回傳覆蓋較新的狀態。

### 2.4 本機資料安全與錯誤回復

- 只有資料檔不存在時才建立空白資料；損壞、過大或暫時讀不到的檔案會回報錯誤並保留原檔。
- renderer 在讀取失敗後立即封鎖資料寫入與記憶體更新，避免使用者看似成功操作、重啟後卻全部消失，或以空白資料覆蓋原檔。
- 畫面提供重試讀取；成功讀回或明確匯入有效備份後才解除封鎖。
- 持久化資料會正規化 conversation 的 provider／model，並移除無效 optional 欄位，避免舊資料使 React 畫面崩潰。
- 儲存失敗與資料回復阻塞使用不同訊息，避免一個錯誤狀態掩蓋另一個問題。

### 2.5 鍵盤、可理解性與安全操作

- 10×9 象棋盤改為可存取的 grid；方向鍵移動焦點，Enter／空白鍵操作格子，並提供格子座標、棋子與選取狀態標籤。
- 焦點使用 roving `tabIndex`，不會讓 Tab 鍵逐一停在 90 個格子。
- AI 教練／猜著分頁支援方向鍵、Home／End 並同步移動焦點；分析資料抽屜開啟時會把後方 workspace 設為 inert，可用 Escape 關閉並返回觸發按鈕。
- Live 引擎移除整區每秒觸發的 `aria-live`；只播報穩定階段，錯誤與一般通知分別使用 alert／status。
- 清空、刪除等破壞性操作加入確認，減少誤觸造成資料或局面遺失。
- 設定頁與空白狀態文字改得更直接；支援的新 Gemini model ID 與 provider 顯示同步更新。

## 3. 已完成的實際驗證

### 3.1 視窗比例與消費者操作檢查

使用獨立 Electron 視窗檢查：

- `1024×700`：預設與展開棋盤工具兩種狀態下，document、main 與分析頁都不需要捲動；工作區可用寬度與實際寬度皆為 984 px，右側 inspector 完整位於頁面內。
- `1024×700` 空白狀態：inspector 與 Live result 都不產生無意義的內部捲動。
- `1366×768`：棋盤、AI 教練與底部 Live 分析同時可見，空白狀態無多餘捲軸。
- `1920×1080`：核心功能同時可見；長引擎輸出仍只在自己的面板內捲動。

### 3.2 自動回歸狀態

- 版面、資料回復與自動 AI 排程修正後，`typecheck:web` 通過。
- app-data 定向測試：20／20 通過。
- renderer architecture 定向測試：25／25 通過。
- Provider 定向測試：47／47 通過，含 Gemini 3.x／2.5 thinking 欄位邊界、thought token 與錯誤本文取消競態。
- Harness 定向測試：89／89 通過，涵蓋繁中／簡中／英文、no-user 幻覺、fenced／陣列 JSON 格式邊界、單次追問與句數 fallback。
- `git diff --check` 通過；Windows 工作樹只出現既有 LF／CRLF 轉換提示。
- 本輪新增棋盤鍵盤操作與可存取性架構測試。

最後一輪 `npm.cmd run typecheck`、完整 `npm.cmd test`、`npm.cmd run security:audit`、`git diff --check` 與 `npm.cmd run build` 已全部通過。安全測試為 56／56；雙引擎假程序 E2E 為 88／88，完整測試命令零失敗。

最終本機候選產物也已完成 `dist:update:github` 與 `verify:update`：安裝檔 104,213,045 bytes，距 100 MiB Git blob 上限仍有 644,555 bytes；ProductVersion `0.3.1`、App ProductVersion `0.3.1.0`、blockmap 110,229 bytes、`latest.yml` size／SHA-512 與 `app-update.yml` URL 均一致。SHA-256 為 `8B37A3F5DD7F1DE8B5B56FE3AC22A02225B15D5A8D43A27E7347EBB1395850CE`，Authenticode 如預期為 `NotSigned`。

本機候選安裝完成後，解除安裝登錄為 0.3.1，桌面捷徑指向 `%LOCALAPPDATA%\Programs\xiangqi-analyzer\象棋AI分析講解.exe`。實際安裝版已驗證 compact／expanded 棋盤尺寸明顯不同、棋盤／AI 教練／底部 Live 分析同時可見、資料抽屜開啟時背景退出可存取樹、Escape 關閉後焦點返回觸發按鈕，以及 AI 教練／猜著可用左右鍵來回切換。

### 3.3 真實 Gemini 與雙引擎基線

已使用桌機現有 Gemini API Key 執行一次真實端到端請求，並讓主／複核引擎在 AI 工作期間持續更新：

- model：`gemini-3.5-flash`
- trace ID：`3e50fc3d-21b3-48f6-ad6d-52af0680ed77`
- request ID：`b55c69a9-da15-417b-bac4-df296f9814a0`
- 狀態：completed
- 耗時：422,484 ms
- token：input 33,354／output 1,096
- 未提供使用者著法時，最終答案沒有虛構使用者走法。
- 主／複核引擎在 AI 請求期間仍持續更新，證明兩條工作管線可並行。

這次基線也揭露消費者不可接受的等待時間：模型多次回傳無效 JSON，觸發三輪審查、額外引擎研究、writer 與 repair，最後才使用保守 fallback。

最佳化後已再次執行真實 Gemini 與持續雙引擎：

- 初次完整解說 trace `cc834e83-2df2-4cb1-ac84-0881929a3020`：34,478 ms、2 次模型呼叫、0 額外引擎輪次、input 8,149／output 1,539 tokens、0 validation error。
- 同一 conversation 的「請用三句話」追問 trace `6d4b7eb4-6960-4d04-9780-7736d3daf242`：11,945 ms、1 次模型呼叫、0 額外引擎輪次、input 4,271／output 528 tokens、0 validation error。
- 初次解說沒有虛構使用者著法；追問保留原問題並依三個重點回答，後續再加上確定性句數正規化。
- 執行中按停止後同時顯示「已取消生成；追問內容仍保留」與引擎取消狀態；等待後 AI 沒有自動重啟，使用者可手動恢復持續分析。
- 實際 API 曾以 HTTP 400 拒絕較新的 `responseFormat.text.mimeType` 形狀；改用同一 `generateContent` 端點實際接受的 `responseMimeType` 後成功，避免把尚未全面佈署的文件形狀當成已驗收能力。
- `gemini-3.1-flash-lite` 已以桌面 UI 完成真實結構化解說；`gemini-3.1-pro-preview` 的真實請求與一次自動重試都被免費額度 rate limit 拒絕，因此只能確認錯誤處理正常，不能宣稱該模型已完成成功端到端驗收。設定已還原為預設 `gemini-3.5-flash`。

## 4. v0.3.1 發布前尚待完成

1. commit 並 push `main`，等待 CI 通過；建立並 push annotated `v0.3.1` tag。
2. 執行 Release workflow；若仍無受信任憑證，只能明確使用過渡版 `allow_unsigned=true`，且 Release notes 必須保留未簽章警告。
3. 從 GitHub Release 下載同一組三項產物回本機驗證，再發布到 `xiangqi-analyzer-site/downloads/`。
4. 使用 Release 下載的安裝檔再次覆蓋安裝，回讀 GitHub Release、公開 `latest.yml` 與桌機 ProductVersion；三者都必須是 v0.3.1／0.3.1。

## 5. 唯一外部發行阻塞：受信任 Windows 簽章

目前 CurrentUser 憑證存放區沒有可用的程式碼簽章憑證，GitHub Actions 也沒有 `WINDOWS_CSC_LINK`／`WINDOWS_CSC_KEY_PASSWORD` secrets。沒有受信任 CA 核發的憑證，就不能讓 Windows 對公開下載的安裝檔建立可信發行者身分。

因此：

- 可以發行明確標示風險的未簽章過渡版 v0.3.1。
- 不可用自簽憑證宣稱已完成正式簽章，也不可保證 SmartScreen 不警告。
- 正式公開販售前，必須取得受信任 CA 的 PFX、設定 GitHub secrets，保持 `allow_unsigned=false` 重新封裝，並重新驗證簽章、安裝與自動更新。

## 6. 其他已知產品限制

- App 不包含第三方象棋引擎二進位或 NNUE 權重；使用者須自行合法取得並在設定頁加入。
- 尚未支援 PGN 或中文著法棋譜匯入；目前支援 FEN 與 UCI 著法序列。
- 本機雙引擎實測使用兩個不同 Pikafish 執行檔，可證明雙程序、不中斷 Live 與 AI 證據整合管線，但不等同兩個獨立棋力家族的分歧裁決品質驗收。
- 授權閘門依使用者要求維持測試停用；這不代表商業授權與付費流程已可公開販售。

## 7. 發布與維護原則

- 不可用分數高低代替象棋因果解釋，術語也不能冒充本局證據。
- 不可平均主引擎與複核引擎分數；分歧時必須保留兩邊證據。
- API Key 不可進入 renderer、log、trace、Git 或安裝產物。
- Harness 必須有呼叫、token、研究輪次與重寫輪次上限，不可無限重試。
- 不可因切換 UI 檢視而取消引擎或 AI 工作；使用者明確停止時也不可自動重啟。
- 資料讀取失敗時不可用空白資料覆蓋原檔。
- 不可只看 source code 宣告桌面 App 可用；必須驗證封裝版、安裝版與實際桌面操作。
- 發布失敗時保留 tag、Release 與產物證據，另建修正版號，不覆寫既有版本。
- 不可遺失使用者或其他代理留下的工作樹變更；任何同步前先檢查 `git status` 與遠端 HEAD。
