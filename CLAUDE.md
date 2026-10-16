# CLAUDE.md — 象棋 AI 分析講解軟體 (xiangqi-analyzer)

本檔是給後續以 Claude Code 接續開發的**現況與規則**。renderer feature 邊界、App Shell 與發行門檻見
`docs/architecture/overview.md`；AI 對話可靠性計畫與執行紀錄見 `docs/plans/ai-chat-reliability-v2.md`；
Stage 1–10 的開發歷史已移到 `docs/history/claude-md-stages-1-10.md`（只供查歷史，不代表現況）；
已知的架構整理待辦與前置條件見 `docs/architecture/maintenance-backlog.md`。

## 一句話定位

本機桌面應用：以 **本機象棋引擎**（Pikafish 等 UCI 引擎，或象棋小蟲/旋風/名手/烏雲等 UCCI 引擎）做棋力判斷，
再由 **LLM 把程式算好的事實翻譯成人類能懂的講解**。引擎是事實來源，AI 只負責解釋。

## 技術棧

- Electron + React + TypeScript + Vite（以 `electron-vite` 建置），目標平台 Windows 10/11 64-bit。
- 一般設定：renderer `localStorage`（`xiangqi.settings`，schema v5，**不含金鑰**）；
  棋局資料：main 的 AppData JSON；機密：Electron `safeStorage`（`SecretStore`，加密落地）。
- 內建引擎：`resources/engine/` 隨附多種 CPU 指令集的 Pikafish 與 `pikafish.nnue`
  （GPL v3 + 權重授權條款，不受根目錄 MIT 涵蓋）；登錄為空時 `EngineRegistryService`
  自動加入「Pikafish（內建）」，使用者可換成自備引擎。自備 Pikafish 必須把 `pikafish.nnue`
  放在同目錄（或 `setoption name EvalFile`），否則可能過不了 `isready`。
- 自動更新：`electron-updater`（`AppUpdaterService`）只在已封裝的 Windows 版啟用；啟動 5 秒後首次檢查、
  之後每 4 小時；下載完成絕不自動安裝，必須由使用者選擇重新啟動（先持久化資料）。
  見 `docs/operations/update-channel.md`、`docs/operations/release.md`。

## 指令與測試

```bash
npm install
npm run dev          # electron-vite dev
npm run typecheck    # node + web 兩個 tsc project
npm run build        # 型別檢查 + 打包
npm test             # 完整測試鏈（Windows 為主要驗證環境）
npm run security:check   # 資安基線（可單獨跑）
npm run security:audit   # 相依弱點分層把關（政策見 docs/architecture/security-l2.md）
```

- `npm test` **不是**測試執行器，而是 `package.json` 裡用 `&&` 串起約 60 個測試檔的固定指令鏈，
  任一檔失敗即中止；沒有 `-- <pattern>`。跑單一檔就照抄那一段：shared/main 用
  `npx tsx --tsconfig tsconfig.node.json <file>`，renderer（JSX）用 `tsconfig.web.json`。
- 只能在 Windows 跑：`tests/security/security.test.ts`（含 Windows 路徑斷言）、
  `tests/unit/main/engineRegistry.test.ts`、`tests/e2e/engine.e2e.ts`（需先用 `csc` 編譯
  `tests/support/FakeEngine.cs` 成 `fake-engine.exe`）與 `npx electron tests/support/run-secret-store-test.cjs`。
- 測試檔不在任何 tsconfig 的 include 內，`npm run typecheck` 抓不到測試裡的型別錯誤，只有實際執行會。
- 新測試：`node:assert/strict`、本機 HTTP mock、失敗設 `process.exitCode = 1`，並加入 `test` 指令鏈。
- 需要真實金鑰的工具（不在 `npm test` 內，金鑰只從環境變數讀、輸出不得含金鑰）：
  - `tools/acceptance/explain-v2-live.ts`：v2 解說 10 題 live 驗收＋人工評分表（`OPENROUTER_API_KEY`，輸出到 `.local-review/`）。
  - `tools/acceptance/openrouter-smoke.ts`：OpenRouter 免費模型探測。
  - `tools/acceptance/summarize-traces.ts`：統計「匯出診斷紀錄」的失敗類別（不輸出回答原文／FEN）。
  - `npm run acceptance:ai`（`run-ai-acceptance`，綁定 v1 Harness；`npm run test:acceptance:ai` 為離線自測）。
- 本機若 `node` 不在 PATH，先把 `C:\Program Files\nodejs` 加入 PATH。

## 目錄結構與職責

```
src/
  main/                         # Electron 主行程（Node）
    index.ts                    #   建視窗、註冊 IPC、解析內建引擎路徑
    logger.ts                   #   輸出前遮蔽 apiKey/Authorization/token/舊 License Key
    engine/                     #   PikafishAdapter（UCI/UCCI 自動偵測、視角反轉）、EngineOutputParser、EngineRegistryService
    ai/
      explain/                  #   ★ v2 解說管線（預設）：ExplainPipelineV2、promptV2、repairPrompt、budget、pipelineFlag
      HarnessOrchestrator.ts    #   v1 Harness：只剩 XQA_EXPLAIN_PIPELINE=v1 回滾路徑使用
      prepareExplanationExecution.ts # 由驗證過的 payload + 權威 session 建立不可變執行（含 FIXED_HARNESS_OPTIONS）
      explanationCredential.ts  #   唯一把 API key 帶進解說的入口（resolveExplanationCredential）＋ v1 請求組裝
      promptBuilder.ts          #   v1 prompt（護欄；禁用 EngineScore.raw）
      AiPreferencesStore.ts     #   OpenRouter 備援模型（最多 2 個 :free；async 原子寫入）
      http.ts                   #   共用 fetch 包裝：大小上限、redirect: 'error'、錯誤遮蔽、429 額度判讀
      providers/                #   Anthropic / OpenAI / Gemini / OpenAI-compatible / OpenRouter（真 SSE、能力快取、推理控制）
    security/                   #   IpcSecurity（來源 frame 驗證）、InputValidation、BrowserSecurity、KeyedOperationGate
    storage/                    #   StorageService、SecureJsonFile、SecretStore（全 async）、AnalysisSessionStore（TTL 2h）、
                                #   HarnessTraceStore（async＋依序佇列）
    update/                     #   AppUpdaterService、UpdatePolicy、UpdatePreferencesStore
    ipc/                        #   aiExplanationHandlers（AI 通道單一註冊入口＋解說串流）、aiCredentialHandlers（secret:*、金鑰測試、
                                #   OpenRouter 模型與備援）、harnessTraceHandlers（診斷紀錄）、explanationErrorPayload、
                                #   engineAnalysisHandlers、dataHandlers
  preload/index.ts              # contextBridge 暴露型別安全的 window.api
  renderer/src/                 # React UI（無 Node 權限）
    App.tsx、app/               #   App Shell（分析／設定）、StartupScreen、ErrorBoundary
    features/                   #   analysis（AnalysisPanel、CoachView、AiErrorCard…）、board、workspace、guessing、
                                #   explanations、settings（AI／引擎／資料與系統三類）、app-data
    pages/                      #   SettingsPage、SetupWizard
    storage/localSettings.ts    #   一般設定（schema v5；v4→v5 遷移只丟棄已移除欄位）
  shared/                       # 純型別與純邏輯（不得引用 main 或 node:*）
    logic/analysis/             #   MoveComparisonService、ExplanationFacts（重播 PV 算事實表）、EngineScoreDisplay
    logic/ai/                   #   AnswerCheck（客觀硬錯 H1–H7／軟警告）、EngineSummary（非 AI 摘要）、aiErrorPresentation、知識庫與術語
    logic/board/                #   FEN、走子規則、中文記譜、PlayOK WXF、PV 重播
    types/                      #   核心型別；ipc.ts 是所有 IPC 通道與 window.api 形狀
```

`tests/unit|integration|e2e|architecture|security|support|fixtures`、`tools/acceptance|release|security`、
`docs/architecture|operations|plans|releases|specifications|history|archive`（archive 只放歷史證據）。

## AI 解說（v2，預設）

`aiExplanationHandlers` 以 `selectExplainPipeline` 分流：預設 v2；設環境變數 `XQA_EXPLAIN_PIPELINE=v1` 整體回滾到 v1 Harness。

1. **事實表**（`ExplanationFacts`）：程式逐手重播首選線與實戰線，算出吃子、將軍、新威脅（含保護）、
   將死／困斃（象棋困斃判負）與兩線差異；模型不用自己推棋盤。
2. **Prompt v2**：system＋user 純文字，先直接回答、不湊字；只能用事實表裡的著法與事實。
3. **AnswerCheck**：只查客觀錯誤（不存在的著法、吃子／將軍與事實矛盾、座標或內部格式外洩、
   輪走方錯誤、截斷等）；有硬錯就把錯誤清單送回同一模型**修正一次**。
4. **退路**：主模型 → 一次恢復（空白／截斷）→ 使用者核可的備援 `:free` 模型 → 修正 → 仍失敗交付
   「引擎重點摘要（非 AI 生成）」＋原因。網路、金鑰、帳務、每日額度用完則顯示錯誤卡。
5. **預算**（`explain/budget.ts`）：最多 3 次模型呼叫、每次 60 秒、總計 110 秒、串流閒置 30 秒；renderer 120 秒截止。
6. 棋規問題（如「這步合法嗎」）走規則引擎捷徑，不呼叫模型。
7. UI：真串流；修正時顯示「正在檢查並修正…」；「由 X 回答（Y 暫時無法使用：原因）」；摘要橫幅附「重試 AI」。

Harness 模式與預算不是使用者設定：`FIXED_HARNESS_OPTIONS`（main 常數）只影響 v1 回滾路徑。

## 重要設計原則（務必遵守）

1. **引擎判棋力、AI 只解釋**：AnalysisSessionStore 內的 EngineAnalysis 是唯一事實來源
   （renderer 只回傳 analysisId，不得把分析資料傳回 main 當解釋依據；§2.16.1）。
   prompt 明確禁止模型發明不在引擎資料／事實表中的戰術，且只能用 score.displayText / comparableValue / mateIn，
   禁用 raw（§2.15.5）。
2. **金鑰安全**：API 金鑰只走 `SecretStore`（safeStorage 加密，獨立檔），**絕不**寫入 `localStorage` 一般設定；
   renderer 只能 set/has/delete/test，永遠讀不回明文。`ai:test-credential` 可測試「尚未儲存的草稿金鑰」，
   該金鑰只在那一次請求中使用、不落地；回傳只有 `{ ok, message }`，不得回送金鑰本身或服務回應原文。
   `detectApiKeyProvider` 即使收到 `preferredProvider` 也必須做前綴格式檢查。
   金鑰、prompt、服務回應原文不得出現在錯誤訊息、紀錄、測試、commit 或 PR。
3. **Pikafish 是本機 UCI 引擎**，不是雲端 API；文件與命名都依此。
4. **錯誤分級用 SDS §2.13 半開區間 [a, b)**（單位＝兵/卒，scoreDifference = evalBest − evalUser，
   皆為原局面行棋方視角）：
   - < 0.31：acceptable_or_tiny_inaccuracy（含負分；負分不判錯誤）
   - [0.31, 0.81)：inaccuracy　[0.81, 1.51)：mistake
   - [1.51, 3.01)：serious_mistake　≥ 3.01：major_blunder
   - null / NaN / Infinity → unknown；不得修改閾值、不得用 UI 四捨五入值分類。
   confidence 依 §2.13.6：0 reason→high、1→medium、≥2 或強制條件→low。
5. **main / renderer 嚴格分離**：`contextIsolation: true`、`nodeIntegration: false`；renderer 只透過
   `window.api` 與 main 溝通；每個 `ipcMain.handle`／`ipcMain.on` 先 `assertTrustedIpcSender`
   （`tests/architecture/ipcSenderGuard.test.ts` 會掃描 `src/main` 全部 handler）。
6. **視角反轉只在 PikafishAdapter**：candidate_move 不取負；separate_engine_call 必取負
   （`invertEngineScore`，mate 0 反轉為 +MATE_SCORE）；parser 階段禁止取負。
7. （已移除：買斷授權已於 P4-5 刪除。保留編號，避免其他文件引用的條號錯位。）
8. **`openai-compatible` 遠端服務的安全限制**：Base URL 只允許標準 HTTPS；HTTP 只允許
   `localhost` / `127.0.0.1` / `::1`。禁止 URL 帶帳密、query 或 fragment。加密金鑰綁定使用者儲存當下
   確認的 Base URL，換網址必須重新確認並儲存。本機 loopback 服務可以不填金鑰；遠端服務一律要求單一加密金鑰。
9. **main process 絕不可做同步阻塞 I/O**：main 與視窗共用同一條訊息迴圈，同步磁碟 I/O（尤其強制 fsync）
   會讓**整個視窗**失去回應。使用者互動路徑上的儲存一律走 `readJsonFileAsync` / `writeJsonFileAtomicAsync`；
   對應的 `ipcMain.handle` 必須 async 並 `await`；renderer 以 `withTimeout` 包住，逾時顯示錯誤。
   （`StorageService` 的同步 `read`／`write` 只剩啟動期與 `EngineRegistryService` 使用；新增引擎、切換主引擎
   仍是同步寫入，屬已知例外，見 `docs/architecture/maintenance-backlog.md`。新程式一律用 `readAsync`／`writeAsync`。）
10. **內建引擎仍是本機二進位**：`EngineRegistryService` 只在登錄為空時自動加入一次內建 Pikafish，
    使用者可以刪除、換路徑或新增其他引擎，行為與手動指定完全相同。分析只用一個主引擎（雙引擎複核已移除）。
11. **UI 文字用繁體中文**；`src/shared/logic/**` 保持純函式；renderer 不得引用 main 或 `node:*`。

## 已移除的子系統（P4-4／P4-5）

- 買斷授權（LicenseService、license:* IPC、LicensePage、`tools/license`）。`logger` 仍遮蔽舊 `XQA1.*` key，
  備份匯入仍剔除 `licenseKey`，`.gitignore` 仍保護 `tools/license/keys/`。
- 老師測試（teacher-test run／凍結案例／prelude）。`release.yml` 的 `teacher-candidate` 發行模式仍保留（發行通道，非 App 程式）。
- 雙引擎複核。v1 Harness 內仍有不會執行的唯讀複核分支與 `DualEngineComparison.ts`，P4-1 刪除 v1 時一併刪除。
- 「解說品質」Harness 參數設定頁（改為 main 常數）；診斷紀錄匯出／清除移到「資料與系統」。

## 尚未完成 / 後續

- **P3-9 live 評分**（使用者本機）決定 v2 能否上線；通過後才做 P4-1（刪除 v1 Harness、v1 契約測試、
  `run-ai-acceptance` 改接 v2 或由 P3-9 取代）。見 `docs/plans/ai-chat-reliability-v2.md`。
- Phase 5：Windows CI 全套＋安裝版 10 步手動驗收。
- PGN／中文記譜（炮二平五）匯入（目前支援 FEN、UCI 著法序列與 PlayOK WXF）。
- 官方與相容服務的 model id 需在發行前依各服務商目前模型頁重新核對。
- Windows 程式碼簽章：尚無受信任 CA 憑證，`allow_unsigned` 過渡版可能觸發 SmartScreen；
  正式公開發行前必須設定 `WINDOWS_CSC_LINK`／`WINDOWS_CSC_KEY_PASSWORD`（見 `docs/operations/release.md`）。
