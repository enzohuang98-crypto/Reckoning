# 象棋 AI 分析講解：專案交接狀態

最後更新：2026-07-13

## 1. 專案位置與目前代碼

- 本次交付工作樹：`C:\Users\enzoh\Documents\Codex\2026-07-11\project-status-md-commit-github`
- 舊來源工作樹：`C:\Users\enzoh\Claude\象棋軟體專案\xiangqi-analyzer`（仍保留本次工作前的未提交狀態；未先核對不可直接 reset 或 pull）
- Git 分支：`main`
- GitHub：`https://github.com/enzohuang98-crypto/xiangqi-analyzer`
- 本次工作基底 commit：`4ccfc9f8a70ce590489019d244c05386e92b2549`
- 本次交付 commit：本文件所在的 `main` HEAD
- v0.3.0 Release commit／tag：`413d02d023688b40cbdea50f06500027a890cd1f`／`v0.3.0`
- GitHub Release：`https://github.com/enzohuang98-crypto/xiangqi-analyzer/releases/tag/v0.3.0`
- 本次 commit 訊息：`complete v0.3.0 release readiness and handoff`
- 前一個主要產品 commit：`2c23feb9f91fa333e776d8294669697d30c96cf1`
- 前一個主要產品 commit 訊息：`complete resilient analysis loop and product UI architecture`
- 應用程式版本：`0.3.0`

本文件與 v0.3.0 發行收尾位於同一個交付 commit。後續工作仍應先檢查 `git status` 與遠端 HEAD，避免覆蓋使用者變更。

## 2. 使用者最終目標

把「象棋 AI 分析講解」整理成可交給真實象棋老師測試的專業級 Windows 桌面 MVP，而不是只能展示的半成品。

核心標準：

1. 桌面 App 可直接開啟，不卡在「啟動中」或空白畫面。
2. 棋盤走子、擺棋、悔棋、下一步、還原原始棋盤與猜著都直覺可用。
3. 引擎分析持續即時更新，不因切換頁籤或面板中斷，並能查看深度、分數、NPS、主線與原始輸出。
4. AI 解說必須回答最佳著法的目的、使用者錯失什麼、為什麼不好、對手如何利用、後續具體後果，以及最佳著法與使用者著法的完整比較；不得只用分數或空泛標籤當理由。
5. Harness 必須是有上限的 loop engineering：生成、驗證、診斷、只重寫失敗區塊、重新驗證，超限才使用有證據的保守版。
6. 儘量把術語、規則、品質檢查與證據關聯留在本機，降低外接 AI 的 token、呼叫次數與模型能力需求，使低階模型也能產生可用解說。
7. 支援雙引擎分歧裁決，不平均分數；比較人類可控性、容錯、失控風險、王區、子力活動、陣形、部署與長期發展。
8. 支援 Anthropic、OpenAI、Gemini、DeepSeek、Kimi、xAI、Ollama、LM Studio 與其他 OpenAI Chat Completions 相容服務，維持單一 API Key 輸入欄位。
9. UI 清楚、明亮、按鈕集中，不讓工具和操作散落；每顆按鈕都必須有實際作用。
10. API Key 不可暴露；完成 typecheck、全部測試、security audit、build、packaging 與實際封裝版滑鼠操作後，才可宣告交付。
11. 所有完成變更都要 commit 並 push 到 GitHub；接近額度上限時先做 checkpoint commit/push。
12. 測試階段暫時保留授權閘門停用，方便使用者測試；不要擅自改成正式鎖定。

## 3. 已實現功能

### 桌面 App 與可靠性

- Electron Windows 桌面應用、NSIS 安裝與桌面捷徑設定。
- 單一實例鎖，避免多開造成 userData／safeStorage 狀態衝突。
- 啟動逾時與獨立無腳本錯誤頁，避免永久空白畫面。
- 自動更新服務、檢查／下載／重新啟動安裝 UI，以及 GitHub generic update channel 建置與發佈腳本。
- 自訂 App icon；目前尚未做 Windows 程式碼簽章。

### 棋盤與使用流程

- 合法走子、悔棋、下一步、還原標準棋盤。
- 擺棋、替換／清除棋子、切換輪走方、清空棋盤、保存與載入局面。
- FEN 匯入與 UCI 著法序列匯入。
- 猜著模式可點「你的著法」後直接在棋盤選起點與終點，不必手打 UCI。
- 錯題本、待理解局面、保存局面、猜著紀錄、備份與合併還原。
- 多輪 AI 追問與同局面對話紀錄。

### 引擎

- UCI／UCCI 自動偵測、握手、短搜尋測試與多引擎登錄。
- 主引擎與複核引擎可分別選擇。
- 自動即時分析先快速回傳，再以有界搜尋區段持續加深；切換右側或頂層頁面不卸載分析工作。
- AI 解說與 Live refinement 可平行執行；AI 對話固定綁定發問當下的 analysis ID、FEN 與結果快照，不會被後續 Live 結果改綁。
- Live 區段失敗會以 1、2、4、5 秒上限退避自動重試；只有使用者按「停止」、棋盤不合法或引擎不可用才停止排程。
- 即時顯示引擎角色、深度、分數、時間、NPS、中文主線與歷史動態。
- 原始引擎輸出可展開查看。
- 複核引擎失敗時保留主引擎結果並顯示降級警告。
- 雙引擎結果分開保存，不取平均；分歧時建立兩條候選線、人類可控性指標與交叉分析任務。
- 已有 Pikafish、象棋名手、象棋旋風、象棋小蟲、阿爾法貓、Px0、烏雲、象眼、佳佳、MaxQi 與自訂引擎 profile。底層仍以通用 UCI／UCCI 支援其他引擎。

### AI Provider 與金鑰

- 官方 adapter：Anthropic、OpenAI、Gemini。
- OpenAI-compatible adapter：DeepSeek、Kimi／Moonshot、xAI、Ollama、LM Studio 與自訂服務。
- 遠端 Base URL 只允許無帳密、無 query／fragment 的標準 HTTPS；HTTP 只允許本機 loopback。
- 本機 Ollama／LM Studio 可免 API Key。
- API Key 僅在 main process 使用，透過 Electron `safeStorage` 加密；renderer 無法讀回明文。
- 金鑰健康檢查可辨識「檔案存在但已無法解密」，UI 會要求重新輸入，而不是錯誤顯示已設定。
- 相容服務金鑰綁定儲存時確認的 Base URL；網址變更後必須重新確認並儲存。
- Provider JSON 回應上限 5 MB；官方格式與本次請求的精確金鑰都會從錯誤文字遮蔽。
- 單一 API Key 欄位可依前綴辨識官方服務，或配合使用者明確選擇相容服務。
- Production AI IPC 已統一經 `buildAIExplanationRequest()` 組裝金鑰、分析 session 與 prompt；多輪歷史、追問與繁中／簡中／英文設定會真正進入 Harness 寫作，不再只有 UI 保存。

### Harness / Loop Engineering

- 本機 deterministic plan，不再浪費一次 LLM 規劃呼叫。
- 一般成功路徑為「具體後果審查 + 結構化寫作」兩次模型呼叫。
- 品質評分器檢查六個必要問答、唯分數理由、空泛詞、欄位互抄、術語與主線連結。
- 核心 claim 要有原因、機制、受影響對象、對手利用與具體後果。
- `generate -> validate -> diagnose -> rewrite failed section only -> validate`，最多固定兩輪，不能無限重生整篇。
- 429、5xx 與 timeout 只額外重試一次，並向 UI 回報 provider retry。
- 等待使用者繼續有 120 秒上限；逾時後用已有引擎證據產生保守版，不讓整個請求失敗。
- 模型呼叫達上限時走 evidence-based fallback，不以分數當理由，也不虛構主線。
- 雙引擎分歧解說必須引用兩邊證據並比較可控性與長期發展；只講分數或單一引擎會被擋下。
- trace 保存 finalText、證據、警告、階段、使用者回饋；「不清楚／不正確／證據不足」可匯出成 regression cases。

### 本機象棋知識

- `xiangqiKnowledge.ts` 目前有 137 條結構化知識，涵蓋規則、棋盤位置、棋子狀態、戰術、殺法、開局、策略、殘局與記譜。
- 繁簡體與別名索引；只檢索與當前問題相關的小段，避免把整個詞庫塞進 prompt。
- 知識庫只能解釋術語，不能冒充本局引擎證據。
- 「緩手、失先、陣形變差」等評價標籤不能單獨通過具體性檢查。

### UI 架構

- Task-first App Shell：分析、錯題本、待理解、設定。
- 分析工具列集中局面工具、悔棋、下一步、分析／停止、AI 解說、棋盤尺寸、分析資料與猜著模式。
- 擺棋與匯入工具採收合式入口。
- 棋盤預設縮小並可切換尺寸；右上只保留 AI 教練與猜著，當前局面資料由頂部工具列展開，持續即時分析跨欄固定在底部。
- 引擎與 AI 工作不因切換檢視或頂層頁面而中斷。
- 設定四分類改為內容上方的水平導覽，減少左側欄與卡片同時競爭寬度的雜亂感。
- renderer 已拆成 app、feature、page、shared logic 與多個 CSS 模組，不再是單一大型樣式檔。
- 靜態測試要求每個原生按鈕都有 `onClick` 與可辨識名稱。

## 4. 最終已通過的驗證

本次最終 diff 已完成：

- `npm run typecheck`：通過。
- 定向回歸：providers 43、engine registry 18、renderer architecture 18、security 55，全部通過。
- `npm test`：446 項通過、0 失敗；engine E2E 88 項實際執行，沒有跳過。
- `npm run security:audit`：0 vulnerabilities。
- `git diff --check`：通過，只有 Windows LF／CRLF 提示。
- `npm run build`：main、preload、renderer production build 通過。
- `npm run pack`：`release/win-unpacked` 成功；實體 `npm ci` 依賴樹可完整封裝 production modules。
- `npm run dist:update:github`：成功產生 v0.3.0 NSIS 安裝檔、blockmap、`latest.yml` 與 `app-update.yml`，沒有公開上傳。
- 執行檔 `ProductVersion`：`0.3.0.0`。
- 最新 renderer 已用 Electron 本機除錯通道驗證 1720、1240、980 px：無水平溢位、棋盤約 444 px、右上只有 AI 教練／猜著、底部 Live 首屏可見、頂部資料抽屜可展開、設定四分類水平排列。
- GitHub CI 與 Release workflow 已成功；Release 三項資產下載回本機後通過版本、大小、SHA-512 與公開更新站 Git blob 一致性驗證。Release 安裝檔 SHA-256：`B14D9A6FA2AA4BE54729E7E7DA7F50B3F88A36EF9FC9446ECECE31B824706D01`。
- 公開更新來源 `xiangqi-analyzer-site` commit `e26c3b9631dec241cf8c71e103c42226d339d72f`，`latest.yml` 已為 `0.3.0`。
- 桌機已由 0.2.6 升級到 Release 原檔 0.3.0；登錄與執行檔 `ProductVersion` 都是 `0.3.0`／`0.3.0.0`，啟動後有 main + 3 個 Electron child processes。
- 安裝版已同時啟動 AVX2 主引擎與 SSE4.1 複核引擎；跨 20 秒觀察窗兩邊 PID 都更新，證明 Live refinement 完成一輪後仍持續串接。
- 已設定真實 Gemini Key，但為避免未經確認產生服務商費用，本次只驗證 AI 解說入口與設定狀態，未發送付費模型請求。

## 5. 本次完成的變更

本次交付包括：

- `src/renderer/src/components/AnalysisPanel.tsx`、`features/analysis/liveAnalysis.ts`
  - 修正 AI 解說／既有 conversation 會使 Live 永久停止的生命週期缺口。
  - refinement 不再清空既有解說與思考紀錄，失敗會退避重試。
  - AI request 捕捉 analysis ID、FEN 與結果快照，避免並行 Live 更新造成 conversation 錯綁。
- `src/renderer/src/features/workspace/AnalysisWorkspace.tsx`、`AnalysisToolbar.tsx`、`AnalysisInspectorTabs.tsx`、`styles/*.css`
  - 重整為左上縮小棋盤、右上 AI 教練／猜著、底部全寬 Live；資料移至頂部工具列抽屜。
  - Tabs 補上 `aria-controls`、roving `tabIndex` 與左右方向鍵切換。
  - 設定分類改為水平導覽。
- `src/main/ipc/aiExplanationHandlers.ts`、`src/main/ai/HarnessOrchestrator.ts`
  - 把 production AI handler 接回唯一 PromptBuilder 入口。
  - 多輪歷史與目標語言真正進入 Harness writer／repair prompt。
- `tests/harness.test.ts`、`tests/rendererArchitecture.test.ts`
  - 新增多輪上下文、語言、Live 排程／重試、AI 快照與首頁資訊架構回歸測試。
- `.github/workflows/release.yml`、`tools/verify-update-artifacts.ps1`、`tests/security.test.ts`
  - metadata 驗證不再因 GitHub runner 無法載入 `Microsoft.PowerShell.Security` 而失敗；簽章政策改由 Windows SDK `signtool verify` 獨立執行。
  - 有憑證時必須驗證為有效簽章；明確允許未簽章時仍只接受 `No signature found`，其他驗證錯誤照樣阻擋 Release。

- `src/renderer/src/components/BoardEditor.tsx`
  - 收起擺棋工具時強制回到移動模式。
  - 一般走子錯誤在工具收起時也可見。
- `src/shared/types/EngineRegistry.ts`
  - 加入 Px0、烏雲、象眼、佳佳、MaxQi profile。
  - 修正 `getEngineProfile` 不可依固定陣列索引尋找 custom fallback。
  - 建立共用 `isEngineProfileId`，讓 renderer、IPC 與持久化使用同一份精確白名單。
- `src/main/ipc/engineAnalysisHandlers.ts`、`src/main/engine/EngineRegistryService.ts`
  - 修正新 profile 在 UI 可選、但 IPC 拒絕或重啟後退回 `custom` 的跨邊界回歸。
- `src/shared/types/AIProviderTypes.ts`
  - 加入 `claude-fable-5`、`claude-sonnet-5`。
- `src/shared/config/model_catalog.json`
  - 加入上述 Anthropic 模型。
- `src/renderer/src/features/settings/AiSettingsSection.tsx`
  - 明示 API 用量由服務商另行計費，本軟體不含額度。
  - 更新 xAI placeholder 為 `grok-4.5`。
- `tests/providers.test.ts`
  - 新模型、模型總數與 UI／main catalog 完全一致測試。
- `tests/engineRegistry.test.ts`
  - 常見引擎 profile、main 邊界、持久化 round-trip 與 custom fallback 測試。
- `tests/rendererArchitecture.test.ts`
  - 收起擺棋工具必須退出替換／清除模式的回歸測試。
- `CLAUDE.md`
  - 移除已完成卻被錯列為未完成的猜著、多輪追問、待理解頁與 icon 項目。
- `docs/ARCHITECTURE.md`
  - 補上相容端點金鑰綁定與 5 MB Provider JSON 回應限制。
- `tools/build-github-update.ps1`、`tests/security.test.ts`
  - 修正 auto-update wrapper 吞掉內層 build 失敗、誤把舊產物當成功的問題。
  - 現在會傳遞非零 exit code，並要求當前版本三項產物存在、非空且為本次新建。
- `PROJECT_STATUS.md`
  - 本交接檔案。

## 6. 交付風險

### 本次已關閉

1. 最新 UI／profile／模型變更已完成 typecheck、定向測試、446 項完整測試與 diff check。
2. AI 多輪上下文、目標語言、Live 排程／退避與快照一致性均有回歸測試。
3. build、pack 與 auto-update packaging 已完成並驗證產物。
4. 封裝版核心滑鼠流程已實測；發現的 dependency-junction 封裝缺模組問題已改用實體 `npm ci` 排除。
5. auto-update wrapper 已不再吞掉 build 失敗或接受舊產物。

### 已知交付限制，不應偽裝成 Bug 已解決

- App 不內含第三方引擎二進位與 NNUE 權重；使用者仍需自行合法取得並在設定頁加入。
- 尚未支援 PGN 或中文著法棋譜匯入；目前支援 FEN 與 UCI 著法序列。
- Windows 安裝檔尚未程式碼簽章，可能出現 SmartScreen 警告。
- 真實外接 AI 呼叫需要使用者自己的 API Key 並由服務商計費；目前仍等待使用者在執行當下明確回覆「同意付費測試」。
- 雙引擎真實運行需要本機安裝兩個可用引擎；只有一個引擎時會使用單引擎流程。
- 授權閘門目前按使用者要求維持測試停用狀態，不代表商業授權流程已準備公開發售。
- 本機已驗證兩個不同 Pikafish 執行檔可同時作為主／複核引擎；尚未做真實付費模型參與的完整雙引擎解說品質驗收。

## 7. 後續建議

1. 正式公開發售前取得受信任 CA Windows 程式碼簽章憑證，設定 `WINDOWS_CSC_LINK`／`WINDOWS_CSC_KEY_PASSWORD`，再重新驗證 SmartScreen、安裝與更新流程。
2. 若要做真實 AI 端到端品質驗收，先在執行當下明確同意服務商費用，再使用目前設定的 Key 執行代表性回歸題組。
3. 用兩個不同家族／不同評估風格的合法引擎補做分歧局面裁決；目前兩個實體執行檔皆為 Pikafish build，能驗證雙程序管線但不等於獨立棋力來源。

## 8. 不可遺忘的實作原則

- 不可用分數高低代替象棋因果解釋。
- 不可讓術語本身冒充證據。
- 不可平均雙引擎分數。
- 不可在 renderer 暴露 API Key 或 Node／Electron 權限。
- 不可讓 loop 無限重試或整篇反覆重生。
- 不可因切換 UI 檢視而取消引擎或 AI 工作。
- 不可只看 source code 就宣告桌面 App 可用；必須驗證封裝版與桌面操作。
- 不可遺失使用者／前一代理留下的既有變更。
- 接近模型額度上限時，先 checkpoint commit 並 push，再繼續長時間驗證。
