# CLAUDE.md — 象棋 AI 分析講解軟體 (xiangqi-analyzer)

> **目前架構來源：** 先讀 `docs/architecture/overview.md`。其中的 renderer feature 邊界、
> Task-first App Shell 與發行門檻，取代本檔較早期的單檔元件描述；核心安全與棋力規則仍以本檔為準。

本檔說明整體架構與開發規則，供後續以 Claude Code 接續開發時參考。

## 一句話定位

本機桌面應用：以 **本機象棋引擎**（Pikafish 等 UCI 引擎，或象棋小蟲/旋風/名手/烏雲等 UCCI 引擎）做棋力判斷，再由 **LLM 把結構化引擎資料翻譯成人類能懂的講解**。引擎是事實來源，AI 只負責解釋。

## 技術棧

- Electron + React + TypeScript + Vite（以 `electron-vite` 建置）
- 本機資料：`localStorage`（一般設定、錯題本）
- 機密資料：Electron `safeStorage`（API 金鑰，加密落地，永不明文）
- 目標平台：Windows 10/11 64-bit
- 內建引擎：`resources/engine/` 隨附多種 CPU 指令集的 Pikafish 執行檔與 `pikafish.nnue`
  權重（GPL v3 + 權重授權條款，見 `README.md`／`resources/engine/` 內文件）；
  首次啟動且引擎登錄為空時，`EngineRegistryService` 會自動把它加入為「Pikafish（內建）」，
  使用者仍可另外指定自備的 UCI/UCCI 引擎。
- 自動更新：`electron-updater`（`AppUpdaterService`）從 GitHub Releases
  （`enzohuang98-crypto/Reckoning`）取得更新，只在已封裝的 Windows 版啟用；
  細節見 `docs/operations/update-channel.md` 與 `docs/operations/release.md`。

## 啟動指令

```bash
npm install      # 安裝相依套件
npm run dev      # 開發模式（electron-vite dev）
npm run build    # 型別檢查 + 打包（electron-vite build）
npm run typecheck# 只跑 tsc 型別檢查（node + web 兩個 project）
```

測試（規則引擎 / PlayOK 棋譜匯入與驗收基線 / AppData / Provider・Registry / License /
Logger 遮蔽 / 資安基線 / Session 快取 / 引擎登錄 / AI Harness / 解釋品質評測集 /
renderer 架構與可存取性 / 引擎契約 e2e）：

```bash
# 先編譯假引擎（僅需一次；csc 為 Windows 內建 .NET Framework 編譯器）
C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe /nologo /out:tests\support\fake-engine.exe tests\support\FakeEngine.cs
npm test   # 完整測試套件（見下）
```

`npm test`（`package.json` 的 `test` script）**不是**一個測試執行器，而是用 `&&`
依序串起約 24 個測試檔的固定 shell 指令鏈，任何一個檔案失敗就整條中止。
沒有 `-- <pattern>` 這種篩選語法；要跑單一測試檔，直接照抄 `package.json` 裡
該檔案對應的那一段指令，依副檔名選對應的 tsconfig：

```bash
# shared / main 邏輯（Node 環境）用 tsconfig.node.json
npx tsx --tsconfig tsconfig.node.json tests/unit/shared/rules.test.ts

# renderer（React/JSX）用 tsconfig.web.json
npx tsx --tsconfig tsconfig.web.json tests/unit/renderer/liveAnalysisTable.test.tsx

# 唯一需要真正 Electron runtime 的測試（驗證 safeStorage 加解密）
npx electron tests/support/run-secret-store-test.cjs

# 資安基線可單獨跑（不必等其他測試）
npm run security:check
```

引擎端對端測試（`tests/e2e/engine.e2e.ts`）與 `run-secret-store-test.cjs` 需要
上面的假引擎編譯步驟與真正的 Windows Electron runtime，因此完整 `npm test`
以 Windows 為主要驗證環境。PlayOK 相關測試讀取 `tests/fixtures/playok/*.wxf`
與已固定的驗收／soak 基線 JSON，理論上可跨平台執行。

另有獨立的 AI 驗收／soak 工具（需要真實 API 金鑰，不在 `npm test` 之內）：

```bash
npm run acceptance:ai            # 對 tests/fixtures/playok 逐手跑真實 AI 解說
npm run test:acceptance:ai       # --self-test：離線驗證流程本身，不呼叫真正的 API
```

> 注意：本機若 `node` 不在 PATH，請先把 `C:\Program Files\nodejs` 加入 PATH。

## 目錄結構與職責

```
src/
  main/                      # Electron 主行程（Node 環境）
    index.ts                 #   進入點：建視窗、註冊 IPC、解析內建引擎路徑（resourcesPath）
    logger.ts                #   共用 Logger；輸出前自動遮蔽 apiKey/Authorization/token
    engine/
      PikafishAdapter.ts     #   以子行程驅動引擎；UCI/UCCI 自動偵測；找不到二進位會回報不可用
      EngineOutputParser.ts  #   解析 UCI/UCCI info/bestmove 行（純函式）
      EngineRegistryService.ts # 引擎登錄 CRUD；空登錄時自動加入內建 Pikafish
    ai/
      AIProvider.ts          #   getAIProvider 工廠（只依名稱回傳 adapter）
      ModelRegistry.ts       #   官方 Provider 模型 id 查詢入口
      HarnessOrchestrator.ts #   AI 解釋品質迴圈（見下方專節）；main/ai 中最大的檔案
      promptBuilder.ts       #   由引擎資料組 prompt（內含護欄規則；禁用 EngineScore.raw）
      http.ts                #   Provider 共用的串流讀取／大小上限／錯誤遮蔽 fetch 包裝
      providers/
        AnthropicProvider.ts       # @anthropic-ai/sdk；真 SSE streaming
        OpenAIProvider.ts          # 內建 fetch；包裝成單一 text_delta + done
        GeminiProvider.ts          # 內建 fetch；generateContent + responseMimeType
        OpenAICompatibleProvider.ts# DeepSeek/Kimi/xAI/Ollama/LM Studio 等相容端點
    license/
      LicenseService.ts      #   買斷授權離線驗證（Ed25519；公鑰內嵌）
    security/
      IpcSecurity.ts         #   assertTrustedIpcSender；驗證 IPC 呼叫來源 frame
      InputValidation.ts     #   跨邊界輸入格式驗證（含 movesUci 等指令注入防護）
      BrowserSecurity.ts     #   BrowserWindow / webContents 安全選項與導覽限制
      RendererPath.ts        #   打包後 renderer 靜態檔路徑解析
    storage/
      StorageService.ts      #   一般 JSON 檔讀寫（userData）
      SecureJsonFile.ts      #   原子寫入＋大小限制的共用 JSON 檔工具
      SecretStore.ts         #   safeStorage 加密金鑰，獨立檔 secrets.enc.json
      AnalysisSessionStore.ts#   短期分析快取（in-memory + TTL 2h + 定時清理）
      HarnessTraceStore.ts   #   Harness trace 本機限量保存，可匯出回歸案例
    update/
      AppUpdaterService.ts   #   electron-updater 包裝；只在已封裝 Windows 版啟用
    startup/
      StartupFailurePage.ts  #   啟動失敗時顯示的最小內嵌錯誤頁
    ipc/
      engineAnalysisHandlers.ts   # engine:* 通道（事件式 + 取消）
      aiExplanationHandlers.ts    # ai:*（streaming）與 secret:* 通道
      licenseHandlers.ts          # license:* 通道
      dataHandlers.ts             # AppData 讀寫與更新狀態通道
  preload/
    index.ts                 # contextBridge 暴露型別安全的 window.api
  renderer/                  # React UI（瀏覽器環境，無 Node 權限）
    index.html
    src/
      App.tsx                # App Shell：分析 / 錯題本 / 待理解 / 設定；首啟動顯示 SetupWizard
      app/                   # AppShell / StartupScreen / ErrorBoundary / productFlags（測試期旗標）
      components/ui/         # 無業務狀態的共用 UI 與 icon
      features/
        app-data/            #   AppData 載入、遷移、排隊儲存（useAppDataStore）
        board/                #   棋盤、擺棋、FEN、PlayOK/UCI 匯入、timeline、棋子顯示
        workspace/            #   AnalysisWorkspace 版面與 AnalysisToolbar 命令列
        analysis/             #   持續引擎、AI 教練（CoachView）、猜著與局面資料檢視
        explanations/         #   跨頁面共用的 AI 解說顯示（ExplanationView）
        guessing/             #   猜著模式互動與結果
        settings/             #   分類式設定 UI（AI／引擎／解說品質／系統各 section）
      pages/                 # SettingsPage / MistakeBookPage / MisunderstoodPage /
                             #   SetupWizard / LicensePage（各為對應功能的頂層控制器）
      storage/localSettings.ts  # localStorage（一般設定 + 錯題本，不得放 API Key）
      styles/                # 依責任拆分的全域樣式；響應式覆蓋只放 responsive.css
  shared/                    # main 與 renderer 共用（純型別與純邏輯）
    types/                   # 所有核心型別（見下）
    logic/
      board/                 # FEN、走子規則、中文記譜（ChineseNotation）、PlayOK WXF 匯入、timeline
      analysis/              # MoveComparisonService（走法比較）+ DualEngineComparison（雙引擎裁決）
      ai/                    # 象棋知識庫（xiangqiKnowledge）、術語（xiangqiTerms）、解說品質評分
      validation/            # 跨邊界輸入（ValidationUtils）與 Provider/API Key 驗證
    config/model_catalog.json   # 官方 Provider 模型白名單與顯示名稱
```

支援目錄依責任分層：`tests/unit|integration|e2e|architecture|security|support|fixtures`、
`tools/acceptance|license|release|security`、`docs/architecture|operations|specifications|releases`；
封裝圖示位於 `resources/packaging`，內建引擎二進位與 NNUE 權重在 `resources/engine/`
（GPL v3 + 權重授權條款，不受根目錄 MIT License 涵蓋），`out/` 與 `release/` 才是建置產物。

`npm run security:audit` 走 `tools/security/audit-dependencies.mjs`，對相依弱點分層把關：
執行期相依（會隨 App 散布）零容忍；建置工具相依若 `npm audit fix` 能安全修復也一律擋下；
只有「僅剩破壞性修法」的建置工具弱點才記錄追蹤。政策與現況理由見
`docs/architecture/security-l2.md` 的「相依套件弱點政策」。

## 核心型別（src/shared/types）

- `BoardState`：棋盤 10x9、輪走方、FEN、回合計數
- `EngineAnalysis` / `EngineScore`（SDS §2.6.1：cp/mate 雙型別、comparableValue、
  displayText、wasInverted、source；raw 僅 debug）/ `EngineCandidateMove`
- `MoveComparisonResult` + 六級 `MistakeLevel`（§2.6.4）+ `ConfidenceLevel`
- `AIExplanationRequest`（§2.17.9：provider/model/apiKey/prompt/metadata，只存在 main）
  / `AIExplanationResponse`（含 `groundedOnEngineData` 護欄旗標）
- `MistakeBookEntry` / `UserGuess`
- `AIProvider` 介面（單次 + `generateExplanationStream`）+ `AIProviderId`
  （`anthropic` / `openai` / `gemini` / `openai-compatible`）
- `DualEngine.ts`：`DualEngineComparison`、候選線與逐手盤面事實（雙引擎分歧比較）
- `Harness.ts`：`HarnessAnswer` / `HarnessSectionId` / `HarnessEvidence` / `HarnessClaim` /
  `CausalChain` 等 AI 解釋品質迴圈的內部契約
- `AppUpdate.ts`：`AppUpdateStatus`（electron-updater 狀態機：idle/checking/available/
  downloading/downloaded/error/unconfigured/unsupported）
- `AppSettings`（**不含金鑰**）
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
   發行私鑰絕不進版控或安裝檔（`tools/license/keys/` 已 gitignore）。
8. **`openai-compatible` 遠端服務的安全限制**：Base URL 只允許標準 HTTPS；
   HTTP 只允許 `localhost` / `127.0.0.1` / `::1`（本機服務）。禁止 URL 帶帳密、
   query 或 fragment。加密金鑰綁定使用者儲存當下確認的 Base URL，換網址必須
   重新確認並儲存，避免 renderer 遭入侵時把既有金鑰轉送到其他端點。本機
   loopback 服務可以不填金鑰；遠端服務一律要求單一加密金鑰欄位。
9. **內建引擎仍是本機二進位**：`resources/engine/` 隨附的 Pikafish 只是「預先放好
   的本機安裝」，不是雲端服務；`EngineRegistryService` 只在登錄為空時自動加入一次，
   使用者可以刪除、換成別的路徑或新增第二顆引擎，行為與使用者手動指定完全相同。

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
  - 規則測試：`tests/unit/shared/rules.test.ts`（64 條斷言，涵蓋各兵種與特殊規則）。
- Stage 7：OpenAI / Gemini Provider 真實實作 + electron-builder 打包。
  - **OpenAI / Gemini**：以內建 fetch 呼叫 REST API（不引入 SDK）。
    OpenAI 走 `/v1/chat/completions`（Bearer 認證）；Gemini 走
    `v1beta/models/<model>:generateContent`（金鑰走 `x-goog-api-key` header，
    不放 URL query）。兩者皆套用 promptBuilder 護欄與 `AIProviderConfig.baseUrl`
    覆寫（測試時指向本機 mock server）。預設模型：gpt-5.4 / gemini-3.5-flash
    （模型目錄不維護價格，UI 只顯示 token 用量，不估算成本）。
  - **打包**（`electron-builder.yml`）：`npm run pack` 產出未打包目錄驗證、
    `npm run dist` 產出 NSIS 安裝檔（`release/`，已 gitignore）。
    當時引擎二進位不隨包散布，使用者安裝後自行指定；**此描述已由 Stage 9 的
    內建 Pikafish 取代**，見下方「內建 Pikafish」。已有自訂 icon，尚未簽章。
  - Provider 測試：`tests/unit/main/providers.test.ts`（43 條斷言，本機 HTTP mock 驗證
    請求形狀、回應解析、大小上限、金鑰遮蔽與 UI／catalog 模型一致性）。
    當時 `npm test` 依序執行全部 14 個測試檔（現已增至約 24 個，見上方「啟動指令」）。
- Stage 8：SDS v0.2 全面對齊 + 買斷授權 License Key
  （規格書：`docs/specifications/SDS-v0.2.docx`，差異分析：`docs/specifications/gap-analysis-v0.2.md`）。
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
    私鑰只在發行者本機（`tools/license/keys/`，gitignore）。`license:status/activate/deactivate`
    IPC；授權頁與鎖定流程已實作，但測試版目前以 `LICENSE_GATE_DISABLED = true` 停用閘門；
    正式商業發行改為 `false` 後，未啟用時才由 `LicensePage` 鎖定主介面。設定頁可查狀態/解除。
    已啟用 key 存 userData/`license.json`，每次啟動重新驗簽防手改。
    發行：`npx tsx --tsconfig tsconfig.node.json tools/license/license-keygen.ts init`（一次性產鑰）、
    `... issue --licensee "名字"`（簽發）。
  - 測試套件持續成長，精確斷言數請勿寫死在文件裡（極易與實際程式碼漂移）；
    以 `npm test`（`package.json` 的 `test` script）目前串起的檔案清單為準，
    見上方「啟動指令」一節。E2E 前須先編譯 `FakeEngine.cs`。
- Stage 9：內建引擎、PlayOK 匯入、OpenAI-compatible provider、GitHub Release 自動更新、
  Harness 解說契約強化（licenses/發行相關細節持續記錄於 `docs/releases/` 各版本說明）。
  - **內建 Pikafish**：`resources/engine/` 隨附多種 CPU 指令集變體執行檔
    （avx2/avx512/avx512icl/avxvnni/bmi2/sse41-popcnt/vnni512）與 `pikafish.nnue`；
    `EngineRegistryService` 建構時若登錄為空，會以 `resourcesPath` 下的
    `engine/pikafish.exe` 自動加入一筆「Pikafish（內建）」安裝，使用者仍可換成
    自備的其他 UCI/UCCI 引擎（見設計原則 §9）。
  - **PlayOK WXF 棋譜匯入**（`shared/logic/board/PlayOkWxf.ts`）：解析 PlayOK 匯出的
    `.wxf` 對局檔；`tests/fixtures/playok/*.wxf` 搭配固定的引擎與 AI 驗收基線 JSON
    （`tests/fixtures/playok/*.json`），由 `playOkWxf` / `playOkSources` /
    `playOkAcceptanceArtifacts` / `playOkSoakArtifacts` 幾個測試檔驗證匯入與基線一致。
  - **AI 驗收／soak 工具**（`tools/acceptance/`）：`generate-playok-cases.ts` /
    `generate-playok-soak.ts` 產生案例與基線，`run-ai-acceptance.cjs`（`npm run acceptance:ai`）
    以真實 API 金鑰逐手驗收 AI 解說品質；`--self-test`（`npm run test:acceptance:ai`）
    離線驗證流程本身，不對外送出真正的 API 請求。
  - **`openai-compatible` Provider**（`OpenAICompatibleProvider.ts`）：支援
    DeepSeek、Kimi/Moonshot、xAI、Ollama（本機）、LM Studio（本機）與自訂
    Chat Completions 相容端點；安全限制見設計原則 §8。
  - **自動更新**（`AppUpdaterService` + `electron-updater`）：只在 `app.isPackaged`
    且 Windows 平台且找得到打包時產生的 `app-update.yml` 才會啟用；狀態機透過
    `app:update:*` IPC 廣播給 renderer，發布流程見 `docs/operations/update-channel.md`
    與 `docs/operations/release.md`。
  - **Harness 解說契約強化**：點擊實戰著法後的一鍵完整解說改為固定 5 個 section id
    的嚴格契約（含最低漢字數門檻），且明確禁止把單一 PV 誇大為「被迫／必然／唯一
    著法」（含對應英文 forced/only move/must reply）；驗證與修正邏輯依 `language`
    （`zh-TW`／`zh-CN`／`en`）分別套用具體詞彙與因果連接詞規則。詳見
    `src/main/ai/HarnessOrchestrator.ts` 的 `validateAnswer` / `validateConsequenceAudit`
    ——這裡的門檻與正則會持續調整，請勿只憑本檔的舊描述判斷目前規則，以原始碼為準。

### 引擎執行前置

- 內建引擎已含 `pikafish.exe` 與對應 `pikafish.nnue`，開箱即可用；若改用者自備
  的其他 UCI/UCCI 引擎，Pikafish 為 NNUE 引擎，**必須把 `pikafish.nnue` 評估檔放在
  同目錄**（或以 `setoption name EvalFile` 指定），缺檔時引擎可能無法通過 `isready`。

## AI 解釋品質迴圈（loop engineering）

Harness 不是一次性 pipeline，而是 generate → validate → diagnose → **只重寫失敗區塊** →
re-validate 的品質迴圈（`HarnessOrchestrator.runExplanationHarness`）：

- **品質評分器**（`shared/logic/ExplanationQualityScorer.ts`，純函式）：八項準則——
  最佳著法目的／錯失什麼／為什麼不好／對手如何利用／後續具體後果／完整比較／
  不以分數當理由／不用空泛詞。逐區塊回報失敗原因（`QualityReport.failedSections`）。
- **因果鏈驗證**：核心區塊（錯失／對手利用／後果／比較）每個 claim 需附 `causal`
  五段結構（cause 逐字含主線著法 → mechanism → affected → opponentUse → consequence）；
  正文自帶「著法＋機制詞＋因果連接」或誠實承認證據不足者可免。
- **修正迴圈**：最多 `MAX_SECTION_REWRITES` 輪（目前為 1；請直接查
  `HarnessOrchestrator.ts` 的常數，不要照抄本檔數字——這個值先前從 2 調整過，
  很容易再變動），每輪只把失敗區塊與其診斷送回模型重寫並依 heading 合併；
  超限才走 `buildFallbackAnswer` 保守版。進度以 `quality_check`／`repairing`
  phase 回報（「發現解釋太空泛，正在重寫…」「已通過品質檢查」）。
  一鍵完整解說另有更嚴格的固定 5-section 契約與最低漢字數要求，見 Stage 9。
- **評測集**（`tests/unit/shared/quality.test.ts`）：空泛／唯分數／有術語無因果 必擋，具體必過；
  八大錯誤類型好壞對照；PV 不足須誠實承認；使用者著法不在候選仍可比較。
- **回饋回歸**：使用者按「不清楚／不正確／證據不足」後，trace 匯出檔會含
  `regressionCases`（`HarnessTraceStore.listRegressionCases`，自包含 finalText +
  availableMoves）；貼入 `tests/fixtures/harness-regression-cases.json` 即成回歸案例，
  由 `screenExplanationText`（評分器的文字級子集）在 CI 擋下同類問題。

## 尚未完成 / 後續

- PGN／中文記譜（炮二平五）格式匯入（目前支援 FEN、UCI 著法序列與 PlayOK WXF）。
- 官方與相容服務的 model id 需在發行前依各服務商目前模型頁重新核對。
- Windows 程式碼簽章：目前沒有受信任 CA 核發的憑證，`allow_unsigned` 過渡版可能
  觸發 SmartScreen；正式公開販售前必須取得 PFX 並設定
  `WINDOWS_CSC_LINK`／`WINDOWS_CSC_KEY_PASSWORD`（見 `docs/operations/release.md`）。
- 買斷授權閘門依使用者要求以 `LICENSE_GATE_DISABLED = true` 維持測試停用
  （`src/renderer/src/app/productFlags.ts`）；這不代表商業授權與付費流程已可公開販售。
