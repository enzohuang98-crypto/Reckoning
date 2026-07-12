# CLAUDE.md — 象棋 AI 分析講解軟體 (xiangqi-analyzer)

> **目前架構來源：** 先讀 `docs/ARCHITECTURE.md`。其中的 renderer feature 邊界、
> Task-first App Shell 與發行門檻，取代本檔較早期的單檔元件描述；核心安全與棋力規則仍以本檔為準。

本檔說明整體架構與開發規則，供後續以 Claude Code 接續開發時參考。

## 一句話定位

本機桌面應用：以 **本機象棋引擎**（Pikafish 等 UCI 引擎，或象棋小蟲/旋風/名手/烏雲等 UCCI 引擎）做棋力判斷，再由 **LLM 把結構化引擎資料翻譯成人類能懂的講解**。引擎是事實來源，AI 只負責解釋。

## 技術棧

- Electron + React + TypeScript + Vite（以 `electron-vite` 建置）
- 本機資料：`localStorage`（一般設定、錯題本）
- 機密資料：Electron `safeStorage`（API 金鑰，加密落地，永不明文）
- 目標平台：Windows 10/11 64-bit

## 啟動指令

```bash
npm install      # 安裝相依套件
npm run dev      # 開發模式（electron-vite dev）
npm run build    # 型別檢查 + 打包（electron-vite build）
npm run typecheck# 只跑 tsc 型別檢查（node + web 兩個 project）
```

測試（規則引擎 / AppData / Provider/Registry / License / Logger 遮蔽 / 資安基線 /
Session 快取 / 引擎登錄 / AI Harness / 解釋品質評測集 / 引擎契約 e2e）：

```bash
# 先編譯假引擎（僅需一次；csc 為 Windows 內建 .NET Framework 編譯器）
C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe /nologo /out:tests\fake-engine.exe tests\FakeEngine.cs
npm test   # 上述十套測試全部執行
```

> 注意：本機若 `node` 不在 PATH，請先把 `C:\Program Files\nodejs` 加入 PATH。

## 目錄結構與職責

```
src/
  main/                      # Electron 主行程（Node 環境）
    index.ts                 #   進入點：建視窗、註冊 IPC
    Logger.ts                #   共用 Logger；輸出前自動遮蔽 apiKey/Authorization/token（§2.11）
    engine/
      PikafishAdapter.ts     #   以子行程驅動引擎；UCI/UCCI 自動偵測；找不到二進位會回報不可用
      EngineOutputParser.ts  #   解析 UCI/UCCI info/bestmove 行（純函式）
    ai/
      AIProvider.ts          #   getAIProvider 工廠（§2.17.8：只依名稱回傳 adapter）
      ModelRegistry.ts       #   官方 Provider 模型 id 查詢入口（§2.19）
      promptBuilder.ts       #   由引擎資料組 prompt（內含護欄規則；禁用 EngineScore.raw）
      providers/
        AnthropicProvider.ts #   @anthropic-ai/sdk；真 SSE streaming
        OpenAIProvider.ts    #   內建 fetch；streaming 為 §2.17.1 包裝模式
        GeminiProvider.ts    #   內建 fetch；streaming 為 §2.17.1 包裝模式
    license/
      LicenseService.ts      #   買斷授權離線驗證（Ed25519；公鑰內嵌）
    storage/
      StorageService.ts      #   一般 JSON 檔讀寫（userData）
      SecretStore.ts         #   safeStorage 加密金鑰，獨立檔 secrets.enc.json
      AnalysisSessionStore.ts#   短期分析快取（in-memory + TTL 2h，§2.18）
    ipc/
      engineAnalysisHandlers.ts   # engine:* 通道（事件式 + 取消）
      aiExplanationHandlers.ts     # ai:*（streaming）與 secret:* 通道
      licenseHandlers.ts           # license:* 通道
  preload/
    index.ts                 # contextBridge 暴露型別安全的 window.api
  renderer/                  # React UI（瀏覽器環境，無 Node 權限）
    index.html
    src/
      App.tsx                # App Shell：分析 / 錯題本 / 待理解 / 設定；首啟動顯示 SetupWizard
      components/            # BoardEditor / FenInput / XiangqiBoard / AnalysisPanel / GuessModePanel
      pages/                 # SettingsPage / MistakeBookPage / SetupWizard / LicensePage
      logic/pieces.ts        # 棋子字形與調色盤
      storage/localSettings.ts  # localStorage（設定 + 錯題本）
  shared/                    # main 與 renderer 共用（純型別與純邏輯）
    types/                   # 所有核心型別（見下）
    logic/
      fen.ts                 # FEN 解析/序列化
      MoveComparisonService.ts # 錯誤分級 + 信心值
    config/model_catalog.json   # 官方 Provider 模型白名單與顯示名稱
```

## 核心型別（src/shared/types）

- `BoardState`：棋盤 10x9、輪走方、FEN、回合計數
- `EngineAnalysis` / `EngineScore`（SDS §2.6.1：cp/mate 雙型別、comparableValue、
  displayText、wasInverted、source；raw 僅 debug）/ `EngineCandidateMove`
- `MoveComparisonResult` + 六級 `MistakeLevel`（§2.6.4）+ `ConfidenceLevel`
- `AIExplanationRequest`（§2.17.9：provider/model/apiKey/prompt/metadata，只存在 main）
  / `AIExplanationResponse`（含 `groundedOnEngineData` 護欄旗標）
- `MistakeBookEntry` / `UserGuess`
- `AIProvider` 介面（單次 + `generateExplanationStream`）+ `AIProviderId`
- `AppSettings`（§2.6.7，**不含金鑰**）
- `License.ts`：`LicenseInfo` / `LicenseStatus`（買斷授權）
- `ipc.ts`：IPC 通道常數、所有 payload 型別與 `window.api` 形狀

## 重要設計原則（務必遵守）

1. **引擎判棋力、AI 只解釋**：AnalysisSessionStore 內的 EngineAnalysis 是唯一事實來源
   （renderer 只回傳 analysisId，不得把分析資料傳回 main 當解釋依據；§2.16.1）。
   prompt（`promptBuilder.ts`）明確禁止模型發明不在引擎資料中的戰術，
   且只能用 score.displayText / comparableValue / mateIn，禁用 raw（§2.15.5）。
2. **金鑰安全**：API 金鑰只走 `SecretStore`（safeStorage 加密，獨立檔），
   **絕不**寫入 `localStorage` 一般設定；renderer 只能 set/has/delete，永遠讀不回明文。
3. **Pikafish 是本機 UCI 引擎**，不是雲端 API；文件與命名都依此。
4. **錯誤分級用 SDS §2.13 半開區間 [a, b)**（單位＝兵/卒，scoreDifference =
   evalBest − evalUser，皆為原局面行棋方視角）：
   - < 0.31：acceptable_or_tiny_inaccuracy（含負分；負分不判錯誤）
   - [0.31, 0.81)：inaccuracy　[0.81, 1.51)：mistake
   - [1.51, 3.01)：serious_mistake　≥ 3.01：major_blunder
   - null / NaN / Infinity → unknown；不得修改閾值、不得用 UI 四捨五入值分類。
   confidence 依 §2.13.6：0 reason→high、1→medium、≥2 或強制條件→low。
5. **main / renderer 嚴格分離**：`contextIsolation: true`、`nodeIntegration: false`；
   renderer 只透過 `window.api` 與 main 溝通。
6. **視角反轉只在 PikafishAdapter**：candidate_move 不取負；separate_engine_call
   必取負（`invertEngineScore`，mate 0 反轉為 +MATE_SCORE）；parser 階段禁止取負。
7. **買斷授權**：License Key 驗證/儲存只在 main（`LicenseService`）；
   發行私鑰絕不進版控或安裝檔（`tools/keys/` 已 gitignore）。

## MVP 範圍（已完成）

- Stage 1：CLAUDE.md、全部核心型別、`npm run build` 可通過。
- Stage 2：BoardEditor（手動擺棋）、FenInput（FEN 驗證渲染）、SettingsPage（金鑰安全儲存）、
  10x9 棋盤渲染、Electron IPC main/renderer 分離。
- Stage 3：Pikafish UCI 整合。`PikafishAdapter` 採分段握手
  （`uci`→`uciok`→`setoption MultiPV`+`isready`→`readyok`→`position`+`go`），
  `EngineOutputParser` 解析 multipv/cp/mate（已含單元驗證），`engine:analyze` / `engine:status` IPC，
  AnalysisPanel 顯示候選線。**引擎路徑**可於 SettingsPage 指定（含原生檔案選擇器），
  經引擎 Registry IPC 存入 main 的 `StorageService`（`engine-registry.json`），啟動時讀回注入 adapter；
  舊版 `engine-config.json` 僅供首次遷移。
- Stage 4：AI 解釋流程。`AnthropicProvider` 真實呼叫 `@anthropic-ai/sdk`，
  `promptBuilder` 組裝引擎資料（含護欄），`ai:explain` IPC 自 `SecretStore` 取金鑰，
    AnalysisPanel 顯示解說與 token 用量。
- Stage 5：UCCI 引擎支援 + 初始設定嚮導 + 猜著模式精確 loss + 錯題本一鍵加入。
  - **UCI/UCCI 雙協定**（`PikafishAdapter`）：握手時自動偵測——先送 `uci` 等 `uciok`，
    2 秒逾時改送 `ucci` 等 `ucciok`；若引擎在偵測期間直接結束行程，以剩餘協定重啟再試。
    偵測結果持久化於 `engine-registry.json` 對應 installation 的 `protocol` 欄位，
    下次直接以已知協定握手。
  - **UCCI 與 UCI 的差異處理**：`setoption <選項> <值>`（無 name/value 關鍵字）、
    握手後送 `setoption usemillisec true`（否則 `go time` 單位是秒）、
    限時搜尋用 `go time <ms>`（UCCI 無 `go movetime`）、`nobestmove` 表示無著法、
    `info` 行的 `score <n>` 為裸數值（`EngineOutputParser` 兩種格式都解析）。
  - **連線測試**（`engine:test` IPC）：實際啟動引擎完成握手後關閉，
    回傳 `EngineTestResult`（協定 + `id name` 版本名），供設定嚮導「測試引擎」使用。
  - **初始設定嚮導**（`SetupWizard.tsx`）：localStorage `setup_completed` 旗標非 `'1'`
    且引擎路徑與所有 API 金鑰皆未設定時，取代主介面顯示；引擎路徑與金鑰皆可留空跳過。
    完成後寫入旗標，之後不再顯示（升級用戶若已有任一設定，啟動時自動補旗標跳過）。
  - **猜著模式精確 loss**（`engine:evaluateMove` IPC）：對「走完猜測著法後的局面」
    單獨搜尋（同深度、multiPv=1），引擎分數為對手視角，`negateScore` 取負還原。
    `position fen <fen> moves <m>` 兩協定皆支援；movesUci 經格式驗證防指令注入。
    走完即無合法著法（`bestmove (none)` / `nobestmove`）視為 mate in 1
    （象棋將死與困斃皆對手輸），analyze 對此以 `EngineNoLegalMovesError` 立即拒絕
    而非等逾時。猜測著法經 `shared/logic/moves.ts` 的 `legalMoveCheck` 完整驗證，
    非法著法不會送入引擎。
  - **錯題本一鍵加入**：猜著結果非 OK 時顯示「加入錯題本」按鈕，寫入 localStorage。
  - **測試基建**（`tests/`）：`FakeEngine.cs`（csc 編譯）模擬 UCI/UCCI/收指令即退/
    無著法四種引擎行為，`engine.e2e.ts` 以 tsx 直接驅動 PikafishAdapter 做端對端驗證。
- Stage 6：走子合法性驗證 + 棋譜匯入。
  - **完整規則引擎**（`shared/logic/moves.ts`）：三層驗證——基本檢查
    （起點輪走方、終點非己方、不可吃將）→ 兵種走法（蹩馬腿、塞象眼、炮架、
    過河兵橫走、九宮限制、象不過河）→ 走後狀態（送將、王不見王）。
    `legalMoveCheck` 驗證、`applyUciMove` 驗證並套用（回傳新 BoardState，
    含 halfmove/fullmove 計數與重算 FEN）。猜著模式已改用完整驗證，
    非法著法不會送進引擎（引擎會默默忽略非法著法導致錯誤評估）。
  - **棋譜匯入**（`GameImportPanel.tsx`）：貼上 UCI 著法序列，從開局或目前局面
    逐手驗證匯入（任一手非法即整批拒絕並指出第幾手與原因），
    匯入後以 ⏮◀▶⏭ 或點擊著法 chip 逐步檢視，棋盤即時同步，任一步皆可再分析。
  - 規則測試：`tests/rules.test.ts`（64 條斷言，涵蓋各兵種與特殊規則）。
- Stage 7：OpenAI / Gemini Provider 真實實作 + electron-builder 打包。
  - **OpenAI / Gemini**：以內建 fetch 呼叫 REST API（不引入 SDK）。
    OpenAI 走 `/v1/chat/completions`（Bearer 認證）；Gemini 走
    `v1beta/models/<model>:generateContent`（金鑰走 `x-goog-api-key` header，
    不放 URL query）。兩者皆套用 promptBuilder 護欄與 `AIProviderConfig.baseUrl`
    覆寫（測試時指向本機 mock server）。預設模型：gpt-5.4 / gemini-3.5-flash
    （模型目錄不維護價格，UI 只顯示 token 用量，不估算成本）。
  - **打包**（`electron-builder.yml`）：`npm run pack` 產出未打包目錄驗證、
    `npm run dist` 產出 NSIS 安裝檔（`release/`，已 gitignore）。
    引擎二進位不隨包散布，使用者安裝後自行指定。已有自訂 icon，尚未簽章。
  - Provider 測試：`tests/providers.test.ts`（43 條斷言，本機 HTTP mock 驗證
    請求形狀、回應解析、大小上限、金鑰遮蔽與 UI／catalog 模型一致性）。
    `npm test` 依序執行全部 14 個測試檔。
- Stage 8：SDS v0.2 全面對齊 + 買斷授權 License Key
  （規格書：`docs/SDS_v0_2.docx`，差異分析：`docs/SDS_gap_analysis.md`）。
  - **資料契約對齊 SDS v0.2**：`EngineScore`（cp/mate、comparableValue、displayText、
    wasInverted、source；raw 僅 debug）、六級 `MistakeLevel` 半開區間 + §2.13.6
    confidence、雙階段分析與 `invertEngineScore`（mate 0 反轉為 +MATE_SCORE
    「殺棋（終局）」）、AppSettings 改 §2.6.7 形狀。
  - **事件式引擎 IPC**（§2.16）：`engine:analyze-position:start/result/error/cancel`，
    analysisId 由 main 生成、先存 `AnalysisSessionStore`（TTL 2h + 10 分鐘定時清理）
    再 reply；取消 = AbortController + UCI `stop` + 500ms 寬限 kill。
  - **AI 解釋 streaming IPC**（§2.17）：`ai:generate-explanation:start/chunk/done/error/cancel`。
    Anthropic 真 SSE streaming；OpenAI/Gemini 為 §2.17.1 包裝模式（單一 text_delta + done）。
    `buildAIExplanationRequest()` 是唯一組 prompt / 注入金鑰入口；
    錯誤對應 §2.17.6 八種 code。renderer 逐段 append、可取消、錯誤保留 partial text。
  - **ModelRegistry**（§2.19）：`model_catalog.json` 保存 Anthropic、OpenAI、Gemini
    共 13 個官方模型；設定頁清單與 catalog 有 parity regression test 防止漂移。
    未知官方模型丟 `UnsupportedModelError`，OpenAI-compatible 則接受通過格式驗證的自訂 id。
  - **買斷授權 License Key**（SDS Q5）：離線 Ed25519 簽章驗證，key 格式
    `XQA1.<base64url(payload)>.<base64url(sig)>`；公鑰內嵌 `LicenseService`，
    私鑰只在發行者本機（`tools/keys/`，gitignore）。`license:status/activate/deactivate`
    IPC；授權頁與鎖定流程已實作，但測試版目前以 `LICENSE_GATE_DISABLED = true` 停用閘門；
    正式商業發行改為 `false` 後，未啟用時才由 `LicensePage` 鎖定主介面。設定頁可查狀態/解除。
    已啟用 key 存 userData/`license.json`，每次啟動重新驗簽防手改。
    發行：`npx tsx --tsconfig tsconfig.node.json tools/license-keygen.ts init`（一次性產鑰）、
    `... issue --licensee "名字"`（簽發）。
  - 測試共 **434 條**（`npm test`）：rules 64 + appData 8 + providers 43 + knowledge 17 +
    dual-engine 8 + license 18 + logger 9 + security 50 + session 3 + engine registry 18 +
    harness 57 + quality 38 + renderer 13 + engine E2E 88。E2E 前須先編譯 `FakeEngine.cs`。

### 引擎執行前置（使用者需自備）

- Pikafish 為 NNUE 引擎：除 `pikafish.exe` 外，**還需把 `pikafish.nnue` 評估檔放在同目錄**
  （或以 `setoption name EvalFile` 指定）。缺檔時引擎可能無法通過 `isready`。
  本軟體只負責驅動 UCI，不內含二進位與評估檔。

## AI 解釋品質迴圈（loop engineering）

Harness 不是一次性 pipeline，而是 generate → validate → diagnose → **只重寫失敗區塊** →
re-validate 的品質迴圈（`HarnessOrchestrator.runExplanationHarness`）：

- **品質評分器**（`shared/logic/ExplanationQualityScorer.ts`，純函式）：八項準則——
  最佳著法目的／錯失什麼／為什麼不好／對手如何利用／後續具體後果／完整比較／
  不以分數當理由／不用空泛詞。逐區塊回報失敗原因（`QualityReport.failedSections`）。
- **因果鏈驗證**：核心區塊（錯失／對手利用／後果／比較）每個 claim 需附 `causal`
  五段結構（cause 逐字含主線著法 → mechanism → affected → opponentUse → consequence）；
  正文自帶「著法＋機制詞＋因果連接」或誠實承認證據不足者可免。
- **修正迴圈**：最多 `MAX_SECTION_REWRITES`（2）輪，每輪只把失敗區塊與其診斷送回模型
  重寫並依 heading 合併；超限才走 `buildFallbackAnswer` 保守版。進度以
  `quality_check`／`repairing` phase 回報（「發現解釋太空泛，正在重寫…」「已通過品質檢查」）。
- **評測集**（`tests/quality.test.ts`）：空泛／唯分數／有術語無因果 必擋，具體必過；
  八大錯誤類型好壞對照；PV 不足須誠實承認；使用者著法不在候選仍可比較。
- **回饋回歸**：使用者按「不清楚／不正確／證據不足」後，trace 匯出檔會含
  `regressionCases`（`HarnessTraceStore.listRegressionCases`，自包含 finalText +
  availableMoves）；貼入 `tests/fixtures/harness-regression-cases.json` 即成回歸案例，
  由 `screenExplanationText`（評分器的文字級子集）在 CI 擋下同類問題。

## 尚未完成 / 後續

- 內含或自動下載 Pikafish 二進位與 `pikafish.nnue`（目前需使用者自備並於設定頁指定）。
- PGN／中文記譜（炮二平五）格式匯入（目前支援 UCI 著法序列）。
- 官方與相容服務的 model id 需在發行前依各服務商目前模型頁重新核對。
- Windows 程式碼簽章（目前已有自訂 icon，但個人測試版尚未簽章）。
