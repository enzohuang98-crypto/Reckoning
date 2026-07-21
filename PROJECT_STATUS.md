# 象棋 AI 分析講解：專案交接狀態

最後更新：2026-07-16

## 0. 2026-07-16 PlayOK／一鍵 AI 解說與 UI 驗收補充

本節記錄 2026-07-16 尚未提交的目前工作樹，並取代後文與分析首頁比例、局面分析顯示、產品引擎數量及 AI 模型選單有衝突的舊描述。

### 0.1 已恢復使用者指定的下一版 UI

- 以舊版 `02c8fcc` 的直接下一個 renderer 版本 `a4a6fce` 為比例依據，恢復單列頁首與中等棋盤；保留目前 PlayOK、實戰著法與 AI loop 功能，不是把整個程式回退到舊碼。
- 已用最終封裝在 `1266×853` 視窗實測：棋盤、AI 教練及底部「局面分析」同屏，整個頁面不需上下捲動；只有長內容所屬區塊可自行捲動。
- 底部「局面分析」是必要預設資訊，已保留分析找法、分數、深度、時間、NPS、節點、最佳著／候選與 PV；移除重複的 LIVE ENGINE／CURRENT RESULT、原始亂碼與無用 UI。
- 分數改為棋手可讀格式（例如 `+0.09`），不再顯示 `score cp 9` 類原始引擎字串。

### 0.2 一次點擊直接得到完整解說

- 點棋譜中的實戰著法只執行引擎比較，不會自動呼叫模型；比較完成後才顯示「產生完整 AI 解說」。使用者明確按一次後，直接顯示五段完整內容，不需再點第二次，也不會先停在短 chat log。
- 最終封裝以 `xq268887284.wxf` 第一手 `1.C2+2` 實測：引擎比較 4.356 秒完成，實戰著法為「炮二進二」、AI 首選為「兵七進一」。之後只按一次 AI 解說，16.062 秒內完成並可從「直接結論」一路捲到「實戰原則」。
- 最新實測 trace：`3fb0381e-e087-4c54-b25a-64da5368d120`，`attachedMove=h2h4`、`status=completed`、`modelCalls=1`、`engineRounds=0`。模型首答只有 390 個漢字，且第二項後果沒有逐字連回兩步真實主線；loop 正確擋下，沒有追加第二次模型呼叫，而是用同一份引擎證據交付完整安全版。
- 前一次真實回覆曾把單一主線寫成「被迫應以馬八進九」；這不是硬體問題，而是模型過度推論加上原本確定性驗證缺口。現已加入規則，禁止把單一 PV 誇大為「被迫／必然／唯一著法／只能回應」或英文 forced／only move／must reply；不合格內容不得直接交付。

### 0.3 單一產品引擎與精確 API 憑證綁定

- 本機產品 registry 現在只有一個 Pikafish 安裝項目，`verificationEngineId=null`；最終 UI 只顯示「主引擎」。驗收工具自己的 acceptance-only cross-check 是隔離的測試資產，不是使用者安裝的第二顆產品引擎，也不會出現在產品選單。
- 只有一顆引擎時，AI 進度與 prompt 現在只寫「主引擎快照」，不再虛構「主引擎與複核引擎」。只有真的加入第二顆產品引擎才會出現複核相關 UI／文案。
- 可使用的 AI 模型選單只列出能解密且具有精確憑證的 `provider + model + baseURL` 組合；金鑰不可跨模型或跨端點共用。Pro 模型本身不是錯，只有在存在該 Pro 模型自己的精確金鑰時才可選。
- 已在最終封裝實際打開選單驗收：目前只有 `Google Gemini · Gemini 3.5 Flash` 一個可使用選項，沒有未綁定的 Pro 模型。

### 0.4 PlayOK 全盤與 AI 驗收狀態

- 十盤完整 PlayOK 引擎基線已從第一手跑到最後一手：4／3／3 來源平衡、825／825 個 ply 都有引擎證據，parse error、illegal move、engine error、超過 3 秒皆為 0；平行比較 min／median／p95／max 為 486／1581／2477／2975 ms。
- 五盤逐手 AI corpus 已固定為 2／1／2 來源平衡、共 358 個 ply。離線 self-test 已通過 `fixed=6, soak=358`；soak dry-run 也通過，確認目前主引擎、隔離 cross-check、`gemini-3.5-flash` 與精確金鑰綁定，且 dry-run 沒有啟動引擎或送出網路請求。
- 六個真實固定 AI case 皆為一次使用者點擊並交付完整顯示品質；其中 2 個完成模型支援的首擊品質，4 個遇到 Gemini 免費額度 rate limit 後由安全證據版收尾。
- **尚未完成 358 次真實模型呼叫。** 先前 Gemini 免費層額度不足，不能把 358-case corpus／dry-run 說成 358 次 live API 成功；後續若要真的逐步 live soak，必須有足夠付費額度並沿用 checkpoint 續跑。

### 0.5 最終門檻與封裝

- 最新完整 `npm.cmd test` 零失敗；其中 Harness 111／111、品質評分 44／44、renderer architecture 31／31、引擎 E2E 88／88。
- `npm.cmd run typecheck`、`git diff --check`、`npm.cmd run security:audit`（0 vulnerabilities）與 `npm.cmd run pack` 均通過。
- 最終執行檔：`release\win-unpacked\象棋AI分析講解.exe`。桌面 `象棋AI分析講解.lnk` 已更新並實際從捷徑啟動成功，開到的就是此工作樹的最終封裝。

## 1. 目前工作位置與版本狀態

- 主要工作樹：`C:\Users\enzoh\Documents\Codex\2026-07-11\project-status-md-commit-github`
- 舊工作樹：`C:\Users\enzoh\Claude\象棋軟體專案\xiangqi-analyzer`（另行保留；不得直接覆蓋其未提交變更）
- Git 分支：`main`
- GitHub：`https://github.com/enzohuang98-crypto/xiangqi-analyzer`
- 本輪工作基底：`6cf40bfa34f4d434a34465008f4941f99391d10b`（`reorganize project structure without logic changes`）
- 上一個已發布版本：`v0.3.0`
- 目前已發布版本：`v0.3.1`
- v0.3.1 annotated tag 指向：`c4b7e9fd5774b12703d85773d6d4eb4612820496`
- GitHub Release：`https://github.com/enzohuang98-crypto/xiangqi-analyzer/releases/tag/v0.3.1`
- v0.3.1 release notes：`docs/releases/0.3.1.md`
- CI／Release workflow 使用目前官方 `actions/checkout@v7` 與 `actions/setup-node@v7`，不再依賴 GitHub 已棄用的 Node 20 action runtime。

本文件記錄 v0.3.1 的實際交付狀態。程式門檻、封裝、安裝、commit、push、tag、GitHub Release、公開更新來源與桌面端回讀均已完成；v0.3.1 已於 2026-07-14 正式發布為未簽章過渡版。

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

最終本機候選產物也已完成 `dist:update:github` 與 `verify:update`：安裝檔 104,213,045 bytes，距 100 MiB Git blob 上限仍有 644,555 bytes；ProductVersion `0.3.1`、App ProductVersion `0.3.1.0`、blockmap 110,229 bytes、`latest.yml` size／SHA-512 與 `app-update.yml` URL 均一致。該候選檔 SHA-256 為 `8B37A3F5DD7F1DE8B5B56FE3AC22A02225B15D5A8D43A27E7347EBB1395850CE`，Authenticode 如預期為 `NotSigned`；它只用於發布前驗證，正式安裝與公開更新使用下述 GitHub Release 產物。

本機候選安裝完成後，解除安裝登錄為 0.3.1，桌面捷徑指向 `%LOCALAPPDATA%\Programs\xiangqi-analyzer\象棋AI分析講解.exe`。實際安裝版已驗證 compact／expanded 棋盤尺寸明顯不同、棋盤／AI 教練／底部 Live 分析同時可見、資料抽屜開啟時背景退出可存取樹、Escape 關閉後焦點返回觸發按鈕，以及 AI 教練／猜著可用左右鍵來回切換。正式 Release 建立後已再用從 GitHub 下載的安裝檔覆蓋安裝，檔案版本為 `0.3.1`、ProductVersion 為 `0.3.1.0`、解除安裝登錄為 `0.3.1`；程式內「資料與系統」頁顯示 `v0.3.1`，手動更新檢查回覆「目前已是最新版本」。

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

## 4. v0.3.1 正式發布完成

1. 功能提交 `9ee178fccb79933439a807823790d37255f02ac3` 與 Actions runtime 提交 `c4b7e9fd5774b12703d85773d6d4eb4612820496` 已推到 `main`；annotated `v0.3.1` tag 指向後者。
2. `main` CI run `29322063006` 與 tag CI run `29322228300` 均完整通過，沒有 annotations；Release run `29322370380` 以明確的 `allow_unsigned=true` 通過全部門檻並建立非 draft、非 prerelease、標記為 latest 的 v0.3.1 Release。
3. GitHub Release 三項產物已下載回本機並重新驗證：`latest.yml` 361 bytes、安裝檔 103,213,881 bytes、blockmap 110,627 bytes。安裝檔 SHA-256 為 `9A2EC7C8EE33B146CA9E019CC51BD09064CCCC61DF451AFDA859A0DE03F1C24D`，低於 100 MiB Git blob 上限。
4. 同一組產物已發布到 `xiangqi-analyzer-site` commit `891b835505440067e9c092a24eb18a45aade46de`；三個遠端 Git blob 與本機檔案逐一相符。公開 `latest.yml` 回傳 `version: 0.3.1`、`path: xiangqi-analyzer-0.3.1-setup.exe`、`size: 103213881`。
5. 桌機已用 GitHub Release 的安裝檔覆蓋安裝並啟動一次；桌面捷徑、檔案版本、解除安裝登錄與程式內更新頁均回讀為 v0.3.1／0.3.1.0，手動更新檢查確認目前為最新版。

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
