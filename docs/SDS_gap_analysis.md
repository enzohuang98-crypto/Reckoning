# SDS v0.2 Gap Analysis — 規格 vs 實作（Stage 5–7 之後）

對照文件：`docs/SDS_v0_2.docx`（軟體設計規格書 v0.2，2026-06-08）
對照基準：commit `d27ad8f`（Stage 7 完成）＋本次補齊工作
分析日期：2026-06-11

## 結論摘要

Stage 5–7 的實作在「引擎驅動、規則引擎、Provider 呼叫、打包」上已達 MVP，
但與 SDS v0.2 的**資料契約與 IPC 架構**有系統性落差（v0.2 是在 Stage 5–7
開發期間定稿的，舊實作對齊的是 v0.1 草稿）。本次已將下列所有落差補齊，
全部 181 條測試通過（rules 49 + providers/registry 37 + license 18 + engine 77）。

## 逐項差異與處置

| # | SDS 章節 | 規格要求 | Stage 7 時的實作 | 處置 |
|---|---------|---------|----------------|------|
| 1 | §2.6.1 EngineScore | cp/mate 雙型別、comparableValue、displayText、wasInverted、source、raw 僅 debug | 舊型別 `{kind, value}` 裸分數 | ✅ 已重構為規格型別（前次 session 完成、本次驗證） |
| 2 | §2.6.4 MistakeLevel | unknown/acceptable…/major_blunder 六級全系統共用 | 舊四級 Blunder/Mistake/Inaccuracy/OK（cp 單位） | ✅ 已改半開區間 [0.31/0.81/1.51/3.01)（兵卒單位）＋ §2.13.6 confidence 規則 |
| 3 | §2.13.5/2.13.7 | classifyMistakeLevel 純函式、null/NaN/Infinity → unknown、負分不判錯 | 部分規則缺失 | ✅ 已實作並以邊界值測試覆蓋 |
| 4 | §2.14 EngineOutputParser | convertCpScore/convertMateScore、mate 0 terminal case、不讓 Infinity 進 EngineScore | 舊 parser 無 EngineScore 語義 | ✅ 已重構；§2.14.6 必要單元測試全數補上 |
| 5 | §2.15 雙階段分析 | userMove 在候選不取負；二次分析必取負（invertEngineScore）；mate 0 反轉為 +MATE_SCORE「殺棋（終局）」；二次失敗降級 unavailable 不補 0 | 舊 evaluateMove 有取負但無 EngineScore 語義與來源標示 | ✅ 已重構；e2e 覆蓋候選 fast path / 二次取負 / 二次殺棋 / 失敗降級 |
| 6 | §2.16 Engine IPC | 事件式 start/result/error/cancel、analysisId 由 main 生成、先 save 後 reply、session_store_failed、AbortController + UCI stop + 寬限 kill | 舊為單次 invoke `engine:analyze`，無取消 | ✅ 已重構；取消機制以 slow 假引擎 e2e 驗證 |
| 7 | §2.17 AI streaming IPC | **必須** chunk/done/error/cancel streaming；禁止單次 ipcMain.handle 作最終設計 | 單次 invoke `ai:explain`（標註「過渡」） | ✅ **本次補齊**：五通道 streaming、§2.17.5 最終版 loop（accumulatedText/completedNormally/abort 順序/finally 清理）、renderer 逐段顯示＋取消＋partial text 保留 |
| 8 | §2.17.4 Provider 介面 | generateExplanationStream(request, signal) | 只有單次 generateExplanation | ✅ **本次補齊**：Anthropic 真 SSE streaming；OpenAI/Gemini 依 §2.17.1 包裝模式（單一 text_delta + done） |
| 9 | §2.17.9 buildAIExplanationRequest | 集中銜接 SecretStore/PromptBuilder/ModelRegistry/SessionStore；MissingApiKeyError 等專屬錯誤 | prompt 組裝散在 IPC handler 內、錯誤用字串 throw | ✅ **本次補齊**：獨立函式＋錯誤類別＋ §2.17.6 八種 error code 對應 |
| 10 | §2.18 AnalysisSessionStore | in-memory Map、TTL 2h、save 前清理＋10 分鐘定時 | 已實作 | ✅ 驗證符合（前次 session 完成） |
| 11 | §2.19 ModelRegistry | getModel/hasModel/listModels/getDefaultModel、UnsupportedModelError、與 TokenCostEstimator 共用 model_pricing.json | **完全缺失**；pricing json 為自創 schema、只有 4 個模型（含 SDS 未列的 gpt-4o/gemini-2.5-flash） | ✅ **本次補齊**：ModelRegistry 模組＋ model_pricing.json 改為 §2.19.3 schema、補齊 §2.19.2 全部 11 個模型（含 gemini-3.1-pro 分層定價 contextNote）；cost.ts 改讀同一來源 |
| 12 | §2.6.7 AppSettings | rootAnalysisMovetimeMs/userMoveEvalMovetimeMs/multiPv/aiProvider/aiModel/userLevel | 舊欄位名 activeProvider 等 | ✅ 已改名；本次修復 SetupWizard 殘留的 activeProvider 引用（typecheck 失敗點） |
| 13 | Q5 買斷授權 License Key | 「是」——需要 License Key | **完全缺失** | ✅ **本次補齊**：離線 Ed25519 簽章驗證（XQA1.payload.sig）、LicenseService（main process）、license:* IPC、啟用頁鎖主介面、設定頁狀態/解除、tools/license-keygen.ts 發行工具、18 條測試 |
| 14 | §2.14.6/§2.13 必要單元測試 | parser 對照表、分級邊界、confidence 映射 | 測試對齊舊契約 | ✅ **本次補齊**：providers/engine 兩套測試全面重寫＋license 新測試 |

## 已知的文件化偏差（保留，不視為 gap）

- `EngineAnalysis.engineName`：SDS 為字面值 `"Pikafish"`；實作放寬為 `string`
  以保留 UCCI 引擎（小蟲/旋風/名手/烏雲）回報的 `id name`（CLAUDE.md 已記載）。
- `compareMove` 視角：§2.13.2 的 normalizeScore 假設紅方視角輸入，但 §2.15.8/附錄 A.3
  規定 adapter 輸出已統一為「原局面行棋方視角」。實作採後者直接相減；
  normalizeScore 仍依規格實作並匯出供紅方視角呼叫端使用。
- `language` 欄位：SDS 未定義解說語言；本專案在 payload 與 AppSettings 擴充 `language`。
- License Key 細節：SDS 只確認「需要」（Q5），未定格式；本實作選擇離線
  Ed25519 簽章（不需 license server，符合附錄 B 對離線/低成本的考量）。

## SDS 列為待確認/後續、本次未實作（與 SDS 一致）

- 多輪追問（ai_conversations）context 策略 — SDS 明列「下一個待補規格」。
- 看不懂局面（MisunderstoodPosition）頁 — §2.5 提及，SDS 階段表將其與錯題本
  並列 Stage 3 範圍，目前以錯題本涵蓋；獨立收藏清單列入後續。
- SQLite 遷移（Q2 暫定 localStorage）— 維持 localStorage。
- 自動更新、安裝檔簽章 — SDS 附錄 B 待確認項。
