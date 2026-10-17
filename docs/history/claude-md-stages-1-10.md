# CLAUDE.md 歷史：Stage 1–10 開發紀錄（封存）

> 本檔是 2026-10 精簡前 `CLAUDE.md` 的「MVP 範圍」與「AI 解釋品質迴圈」段落，原文保留供查歷史。
> 其中授權（Stage 8）、老師測試、雙引擎、Harness 設定頁等描述已於 P4-4／P4-5 移除，**不代表現況**；
> 現行架構以 `CLAUDE.md` 與 `docs/architecture/overview.md` 為準。

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
  （規格書：`docs/specifications/SDS-v0.2.docx`，差異分析：`docs/archive/specifications/gap-analysis-v0.2.md`）。
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

- Stage 10：金鑰儲存不阻塞 UI、金鑰健康檢查、自動更新可見性（v0.3.6、v0.3.7）。
  - **`SecretStore` 全面 async**：`SecureJsonFile` 新增 `readJsonFileAsync` /
    `writeJsonFileAtomicAsync`（`node:fs/promises`）。原本的同步 fsync 寫入在 main
    的訊息迴圈上執行，儲存金鑰時會凍結整個視窗（見設計原則 §9）。
  - **`testCredential`**：`AIProvider` 介面新增；各 provider 呼叫自己的「列出模型」端點
    （Anthropic 用 SDK `models.list()`，其餘走 `/models`），共用
    `CREDENTIAL_TEST_TIMEOUT_MS` 與 `describeCredentialTestError`。
    OpenAI-compatible 對 404 明確回報「此服務不支援金鑰測試」而不是假裝成功。
  - **分數顯示**：UI 主要顯示一律用 `score.displayText`；`EngineScore.raw` 只留給
    除錯與查核，不再與 displayText 並列展示（避免同一分數出現兩種字串）。
  - **更新可見性**：`AppShell` 在 `available` / `downloaded` 時於標題列提示；
    `AppUpdaterService` 由「啟動後檢查一次」改為每 4 小時重檢查，並防止重檢查
    覆蓋已下載狀態。
