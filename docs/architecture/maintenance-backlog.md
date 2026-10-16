# 維護待辦（架構整理）

最後更新：2026-10-16。依「對維護成本的影響 ÷ 風險」排序。已完成的整理見 PR #80 的 `chore:`／`refactor:`／`build:` commit。

## 已完成（2026-10-16）

- 刪除沒有任何呼叫者的匯出與舊 `engine-config.json` 讀取器。
- `aiExplanationHandlers.ts`（933 行）依責任拆成解說串流、憑證通道、診斷紀錄通道、錯誤對應、憑證解析五個模組。
- 新增 `tests/architecture/ipcSenderGuard.test.ts`：掃描 `src/main` 全部 IPC handler 都先驗證來源（原則 §5 從人工檢查改成自動檢查）。
- 測試檔納入 `npm run typecheck`（修掉約 150 個累積的型別錯誤；`harness.test.ts` 隨 v1 刪除前暫時排除）。
- 介面簡體字改為繁體，並以 `tests/architecture/traditionalChineseUi.test.ts` 防止再混入。
- `HarnessTraceStore` 與診斷紀錄匯出改為非同步，並以內部佇列避免 save／回饋／清除互相覆蓋。

## 1. 刪除 v1 Harness（P4-1／P4-2）— 最大一筆，**等 P3-9 live 評分通過**

可刪約 1 萬行：`HarnessOrchestrator.ts`（3,654）、`tests/integration/ai/harness.test.ts`（3,386）、
`tools/acceptance/run-ai-acceptance.ts`（3,764，型別早已壞掉）、`promptBuilder.ts`、`QuestionAnswerQuality.ts`、
`DualEngineComparison.ts`＋`types/DualEngine.ts`、`AnalysisSession` 的複核欄位、`FIXED_HARNESS_OPTIONS`、
`XQA_EXPLAIN_PIPELINE` 旗標、`ai:harness:continue` 通道與進度卡的「繼續」按鈕。

先處理這些相依，否則會連帶弄壞 v2：

| v2 仍在用的東西 | 目前位置 | 處理 |
|---|---|---|
| `scoreUsedAsReason`、`VAGUE_PHRASES` | `shared/logic/ai/ExplanationQualityScorer.ts`（751 行，其餘只供 v1） | 搬進 `AnswerCheck.ts` 或小模組，再刪評分器；`quality.test.ts` 只保留這兩者的案例 |
| 棋規捷徑 `BoardQuestionFacts` | `src/main/ai/`（純函式） | 保留，可移到 `shared/logic/board/` |
| `HarnessExplanationUnavailableError` | `explanationErrorPayload.ts` 用來對應錯誤碼 | 刪 v1 後一起移除該分支 |
| `screenExplanationText`（回饋回歸案例） | 評分器內 | 決定回歸案例改用 `checkAnswer` 或停用 |

驗收：`npm run typecheck`（屆時移除 `harness.test.ts` 的排除）、完整 `npm test`、`grep` 確認已刪符號無殘留。

## 2. 拆 `AnalysisPanel.tsx`（1,278 行；31 個 useState、21 個 useRef、14 個 useEffect）— 在 #1 之後

同一個元件同時管引擎生命週期（自動分析、精煉、截止計時）、AI 請求（串流、重試、錯誤卡、等待引擎）
與畫面組裝，是目前最難安全修改的檔案。建議拆成 `useEngineAnalysis`、`useAiExplanation` 兩個 hook，元件只負責組裝。

- 先做 #1：v1 的進度／「繼續」流程刪掉後狀態會少一截。
- 風險：`tests/architecture/rendererArchitecture.test.ts` 有 48 處直接讀原始碼做正則比對，拆檔一定要同步改寫這些斷言
  （見第 4 項）。行為由 `actualMoveFlow`、`aiRegenerationFlow`、`aiWaitForEngine`、`aiStreamingV2` 整合測試把關。

## 3. 主行程同步 I/O（原則 §9 的剩餘例外）

診斷紀錄已改為非同步。剩下 `EngineRegistryService`：新增、移除、切換主引擎時同步寫 `engine-registry.json`，
啟動時同步讀取。檔案很小、操作不頻繁，影響有限；要改需把 registry 的公開方法改成 async 並更新
`engineAnalysisHandlers` 與 Windows 專用的 `engineRegistry.test.ts`。

## 4. 原始碼正則測試偏多

`rendererArchitecture.test.ts`（766 行）與 `security.test.ts` 有許多「讀檔＋正則」斷言，
保護的是重要規則，但會把檔案位置與寫法鎖死，重構時必須逐條改。新規則優先寫成行為測試或像
`ipcSenderGuard` 這種掃描整個目錄、不綁定單一檔案的檢查；既有斷言在相關檔案重構時順手轉換。

## 5. `npm test` 是約 60 段 `&&` 串起來的指令

第一個失敗就停止，看不到其他失敗；新增測試要手改一行很長的字串。可改成讀取測試清單的小型 runner
（全部跑完再彙總，並標記 Windows 專用測試）。CI 只呼叫 `npm test`，改動範圍小。

## 6. 較低優先

- `SettingsPage.tsx`（723 行、25 個 useState）：可依設定分類拆出各自的狀態 hook。
- `PikafishAdapter.ts`（998 行）：核心且測試完整，除非要改協定處理，否則不動。
