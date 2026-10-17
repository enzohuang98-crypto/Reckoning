# 維護待辦（架構整理）

最後更新：2026-10-17。依「對維護成本的影響 ÷ 風險」排序。已完成的整理見 PR #80 的 `chore:`／`refactor:`／`build:` commit。

## 已完成（2026-10-16）

- 刪除沒有任何呼叫者的匯出與舊 `engine-config.json` 讀取器。
- `aiExplanationHandlers.ts`（933 行）依責任拆成解說串流、憑證通道、診斷紀錄通道、錯誤對應、憑證解析五個模組。
- 新增 `tests/architecture/ipcSenderGuard.test.ts`：掃描 `src/main` 全部 IPC handler 都先驗證來源（原則 §5 從人工檢查改成自動檢查）。
- 測試檔納入 `npm run typecheck`（修掉約 150 個累積的型別錯誤；`harness.test.ts` 的排除已隨 P4-1 移除）。
- 介面簡體字改為繁體，並以 `tests/architecture/traditionalChineseUi.test.ts` 防止再混入。
- `HarnessTraceStore`、診斷紀錄匯出與 `EngineRegistryService` 的寫入改為非同步依序佇列；主行程互動路徑不再有同步磁碟寫入（原則 §9）。
- `npm test` 改由 `tools/test/run-tests.mjs` 依清單執行、跑完彙總；新增清單完整性測試，並找出一個從未在 CI 執行過的測試檔（`updateInstallSafety.test.tsx`）。

## 1. 刪除 v1 Harness（P4-1）— 已完成（2026-10-17）

已刪除：`HarnessOrchestrator.ts`、`tests/integration/ai/harness.test.ts`、`tools/acceptance/run-ai-acceptance.*`
（與 `acceptance:ai` 指令、`ai-acceptance-results.json`）、`promptBuilder.ts`、`QuestionAnswerQuality.ts`、
`DualEngineComparison.ts`＋`types/DualEngine.ts`、`AnalysisSession` 的複核欄位、`FIXED_HARNESS_OPTIONS`、
`XQA_EXPLAIN_PIPELINE` 旗標（`pipelineFlag.ts`）、`ai:harness:continue` 通道與進度卡的「繼續分析」。

相依的處理方式：

| 項目 | 處理 |
|---|---|
| `scoreUsedAsReason`、`VAGUE_PHRASES` | 留在 `ExplanationQualityScorer.ts`（只剩這兩項）；其餘評分器、`xiangqiTerms`、`quality.test.ts` 中 v1 的案例刪除 |
| 棋規捷徑 `BoardQuestionFacts` | 保留，可移到 `shared/logic/board/` |
| `HarnessExplanationUnavailableError` | `explanationErrorPayload.ts` 的分支已移除 |
| `screenExplanationText`（回饋回歸案例） | 停用並刪除（含 `harness-regression-cases.json`）；回饋案例仍可從診斷紀錄匯出，需要時改寫成 `AnswerCheck` 測試 |
| `buildAIExplanationRequest` | 刪除；`secretStore.electron.test.ts` 的憑證斷言改接 `resolveExplanationCredential` |

## 2. 拆 `AnalysisPanel.tsx`（約 1,270 行；31 個 useState、21 個 useRef、14 個 useEffect）

同一個元件同時管引擎生命週期（自動分析、精煉、截止計時）、AI 請求（串流、重試、錯誤卡、等待引擎）
與畫面組裝，是目前最難安全修改的檔案。建議拆成 `useEngineAnalysis`、`useAiExplanation` 兩個 hook，元件只負責組裝。

- 風險：`tests/architecture/rendererArchitecture.test.ts` 有 48 處直接讀原始碼做正則比對，拆檔一定要同步改寫這些斷言
  （見第 3 項）。行為由 `actualMoveFlow`、`aiRegenerationFlow`、`aiWaitForEngine`、`aiStreamingV2` 整合測試把關。

## 3. 原始碼正則測試偏多

`rendererArchitecture.test.ts`（766 行）與 `security.test.ts` 有許多「讀檔＋正則」斷言，
保護的是重要規則，但會把檔案位置與寫法鎖死，重構時必須逐條改。新規則優先寫成行為測試或像
`ipcSenderGuard` 這種掃描整個目錄、不綁定單一檔案的檢查；既有斷言在相關檔案重構時順手轉換。

## 4. 較低優先

- `SettingsPage.tsx`（723 行、25 個 useState）：可依設定分類拆出各自的狀態 hook。
- `PikafishAdapter.ts`（998 行）：核心且測試完整，除非要改協定處理，否則不動。
