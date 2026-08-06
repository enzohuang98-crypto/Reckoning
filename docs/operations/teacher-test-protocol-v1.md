# Reckoning teacher-test protocol v1

這份 protocol 是 v0.3.8 teacher candidate 的雙機實測操作契約。它定義要重播的題目、要留下的匿名證據與停止條件；它不替代老師的實際評分，也不把本機自測誤稱為老師驗收。

## 固定輸入

- 六個 frozen cases 以 [teacher-test-cases-v1.json](teacher-test-cases-v1.json) 為唯一題目來源。每個 case 的 `positionFen`、side-to-move、attached move、question 與 mode 必須原樣送入 App。
- 原始題目取自 `tests/fixtures/playok/acceptance-cases.json`，其 SHA-256 已寫在 JSON。`historicalFixture` 只代表既有工程 fixture 的背景，不是這次老師分數的預設答案或通過門檻。
- App、Release tag、product source commit、installer 檔名與 installer SHA-256 必須先由 Settings 的 `TEACHER PILOT EVIDENCE` run manifest 核對。沒有完整 artifactClaim 就停止，不進入題目測試。
- 兩台電腦必須使用同一個公開 GitHub teacher-candidate Release asset。每台各自建立一個 `testRunId`；不可把一台電腦的 trace 併入另一台的 run。

## 每台電腦的操作

1. 從指定 GitHub Release 下載安裝檔，先核對 `SHA256SUMS.txt`，記錄 Windows SmartScreen／未簽章警告與檔案 SHA-256。teacher candidate 是刻意未簽章版本，只在受控測試環境使用。
2. 安裝並啟動 App，在 Settings 開始 teacher-test run，選取同一份 `.exe`。確認畫面上的 `testRunId`、release tag、source commit、installer filename／SHA-256 與 Windows runtime。
3. 使用同一個已核准的暫時 API key 完成六題。API key 只在測試機的 main-process SecretStore 或本次測試流程中使用，不貼到聊天、issue、PR、screenshot 或 trace；測試後立即刪除並重開 App 驗證未配置。
4. 依 JSON 順序逐題操作。每題只使用 frozen case 的局面、attached move、question、mode；不得為了讓回答變好而改寫問題或手動補入另一條主線。
5. 每題在外部 rubric 只填 `externalReviewId` 與評分，不填姓名、帳號、API key 或本機路徑。App export 只保留匿名 evaluation link、引擎證據與產品必要 trace 欄位。
6. 六題完成後從 Settings 匯出 Harness teacher-test JSON，核對其 `runManifest` 與六個 case 的 `testRunId`；結束 run，再保存 export bytes 的 SHA-256。

## 外部 rubric

每題由老師在同一份 rubric 以 0–2 分記錄，並可附短評：

| 維度 | 0 | 1 | 2 |
| --- | --- | --- | --- |
| 結論可判斷性 | 沒有回答題目 | 有方向但含糊 | 直接、可核對地回答 |
| 證據忠實度 | 補造或誤引擎證據 | 大致正確但連結不完整 | 每個關鍵主張都連回局面／走子／主線 |
| 因果與後果 | 只有標籤或分數 | 有部分機制 | 說清楚棋子／線路、對手利用與後續後果 |
| 教學清楚度 | 難以理解 | 可理解但需追問 | 適合老師帶學生複盤 |
| 不確定性誠實度 | 把推測當事實 | 偶爾模糊 | 明確分開已證明、推論與未知 |

評分是外部人的真實資料，不能由 fixture 的 `evaluationLoss` 或 App 自動填入。若老師認為回答不可接受，請保留 `externalReviewId`、case key、機器 run 與短評，讓後續工程能重現。

## 雙機完成條件

只有同時取得以下證據，才可說「老師雙機實測完成」：

- Machine A 與 Machine B 各自有可讀的 run manifest、Windows runtime、六題 evaluation links、export SHA-256 與外部 rubric。
- 兩台的 `artifactClaim` 完全相同，且與公開 Release asset SHA-256 相同；`testRunId`、`externalReviewId` 與 export digest 必須各自不同。
- 外部 rubric 有老師的實際評分與短評；無法由自動測試、CI、Server proxy 或本機開發環境代填。
- 測試後 API key 已刪除，export、trace、logs、工作目錄與提交內容中找不到 key、Authorization、hostname、account 或完整 installer path。

任何一項缺失都標記為 `pending`，不是通過。若兩台 App 版本、source commit、installer SHA、題目文字或 mode 不同，整批停止並重新建立新的 run。

## 開發端乾跑與限制

在沒有老師、第二台電腦或暫時 API key 時，開發端只能驗證 schema、case canonicalization、SHA-256 artifact claim、positive export allowlist 與既有 engine fixture；不得建立假的老師 rubric、假的 machine runtime 或假的 provider response。這些未完成項目要留在學習歷程的 `pending` 狀態。
