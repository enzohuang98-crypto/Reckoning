# 停工快照中的本機驗收工具

2026-10-11依使用者要求，一併公開原先本機使用的七份工具原始碼，供檢查實測是否經正式App服務、是否保護密鑰、哪些結果只是診斷。這些工具不是普通App bundle，沒有包含API key、密文、headers資料、私人AppData或raw玩家棋譜。

| 工具 | 實際用途及狀態變更 |
|---|---|
| local-credential-status.cjs | Electron main process經正式SecretStore讀安全provider／model狀態，並讀免費目錄；只輸出安全metadata，不輸出key |
| local-free-catalog.cjs | 讀公開模型能力／reasoning／免費metadata，供精確模型策略查核 |
| local-free-quota.cjs | main process使用saved key讀官方key endpoint，僅輸出status、model、非負免費請求計數，不輸出raw帳戶回應 |
| local-switch-free-model.cjs | 經正式OpenRouterSavedModelService探測及原子保存；成功會改目前active模型，失敗保留原選擇。額外permission診斷只記白名單分類 |
| local-openrouter-fixed-case.cjs／.ts | main process解密、正式provider／prepare execution／真Pikafish／Harness／validator；固定完整案例或完整匿名公棋譜／自對弈復盤。成功與失败都必須讀report.status，process exit0不代表PASS |
| local-playok-review.ts | 從呼叫者指定的公開WXF輸入完整重播並用正常3秒／1秒／3候選找復盤位置；輸出不保留玩家header，aiAcceptance明示not_run |

fixed-case的controlled diagnostic flags會改實際wire參數，report明示diagnosticRequestDifference及safeWireRequests，**不能當production acceptance**。disabled／1000／2000 reasoning試驗各自結果在停工報告，沒有採用為正式產品策略。文本捕捉只保存有界可見草稿，不保存隱藏推理；正式validator沒有被繞過或降低。

這些工具直接使用使用者profile的正式SecretStore；switch工具成功會持久化模型。它們是審查材料，不是自行啟動的工作。本次停工後没有再執行它們。

原始執行命令與證據位置見[停工交接](../../docs/operations/paused-review-2026-10-11/README.md)及[逐階段紀錄](../../docs/operations/v0.4.15-2026-09-23-progress.md)。輸入的raw棋譜、私人profile、原始帳戶回應及credentials都没有隨工具上傳。
