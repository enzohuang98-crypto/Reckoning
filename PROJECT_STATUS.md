# 專案現況（一頁）

最後更新：2026-10-16　｜　版本：v0.4.15（PR #80 合併後發布；v0.4.14 標籤存在但未發布）

## 現在能做什麼

- 本機 Pikafish（或自備 UCI／UCCI 引擎）即時分析：MultiPV 候選、分數、深度、PV 重播；單一主引擎。
- 猜著、實戰步比較、直接提問：引擎結果一出現就能問。
- AI 解說（PR #80 起為 v2）：程式算事實表 → AI 白話講解 → 客觀檢查 → 修正一次 → 仍失敗給「引擎重點摘要（非 AI）」。
  最多 3 次模型呼叫、110 秒內一定有結果或可操作的錯誤卡；OpenRouter 免費模型可設 2 個備援並標示「由 X 回答」。
- Provider：Anthropic、OpenAI、Gemini、OpenRouter、OpenAI 相容端點（DeepSeek、Kimi、xAI、Ollama、LM Studio…）。
- 匯入：FEN、UCI 著法序列、PlayOK WXF。自動更新：GitHub Releases（只在已封裝的 Windows 版）。

## 進行中：AI 對話可靠性 v2（`docs/plans/ai-chat-reliability-v2.md`）

| 階段 | 狀態 |
|---|---|
| Phase 0–3（止血、OpenRouter 穩健化、v2 管線） | 完成，離線測試全綠 |
| P3-9 live 人工評分 | **待使用者在本機執行**（雲端環境無法連 openrouter.ai） |
| P4-4 移除 Harness 設定頁、P4-5 移除授權／老師測試／雙引擎、P4-6 文件精簡 | 完成（使用者已同意） |
| P4-1／P4-2 刪除 v1 Harness 與其測試 | **等 P3-9 達標**；在那之前 v1 保留為 `XQA_EXPLAIN_PIPELINE=v1` 回滾 |
| Phase 5 Windows 發行驗收 | 未開始 |

## 已知限制與風險

- 免費模型的講解品質尚未經 live 評分證實；評分未達門檻前不應發行 v2。
- Windows 程式碼簽章尚未取得受信任憑證；未簽章版本可能觸發 SmartScreen。
- `StorageService`／`HarnessTraceStore` 仍是同步 I/O（設計原則 §9 的已知例外）。

## 去哪裡看

- 開發規則與目錄：`CLAUDE.md`；架構：`docs/architecture/overview.md`；資安：`docs/architecture/security-l2.md`
- 架構整理待辦（依優先序）：`docs/architecture/maintenance-backlog.md`
- 發行：`docs/operations/release.md`、`docs/operations/update-channel.md`；版本說明：`docs/releases/`
- 歷史：`docs/history/`（CLAUDE.md Stage 1–10）、`docs/archive/`（v0.3.x 發行證據、老師試點、舊版本頁）
