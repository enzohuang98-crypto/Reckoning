# Reckoning teacher-test protocol v1

這份 protocol 是 teacher candidate 的雙機實測操作契約。它定義要重播的題目、要留下的匿名證據與停止條件；它不替代老師的實際評分，也不把本機自測誤稱為老師驗收。實際 Release tag 必須以 run manifest 的 `artifactClaim` 為準。

## 固定輸入

- 六個 frozen cases 以 [teacher-test-cases-v1.json](teacher-test-cases-v1.json) 為唯一題目來源。每個 case 的 `positionFen`、side-to-move、attached move、question 與 mode 必須原樣送入 App。
- 原始題目取自 `tests/fixtures/playok/acceptance-cases.json`，其 SHA-256 已寫在 JSON。`historicalFixture` 只代表既有工程 fixture 的背景，不是這次老師分數的預設答案或通過門檻。
- App、Release tag、product source commit、installer 檔名與 installer SHA-256 必須先由 Settings 的 `TEACHER PILOT EVIDENCE` run manifest 核對。沒有完整 artifactClaim 就停止，不進入題目測試。
- 兩台電腦必須使用同一個公開 GitHub teacher-candidate Release asset。每台各自建立一個 `testRunId`；不可把一台電腦的 trace 併入另一台的 run。

## Case-set status before teacher confirmation

- 目前 `teacher-test-cases-v1.json` 的六題是工程乾跑基線，全部來自既有 PlayOK fixture；JSON 明確標記 `fixture-only; teacher-confirmation-pending`。
- 這六題可以驗證 case canonicalization、engine fixture 與 export schema，但不能被寫成老師已確認的題目，也不能代填外部 rubric。
- 計畫要求的正式 pilot 還缺三個由專業象棋／學習歷程老師提供或明確確認的題目：防守資源／利用對手、PlayOK WXF 中局、以及需要回答「為什麼／如何反思」的題目。老師確認後，必須更新 frozen case 文件與其 metadata，再讓兩台機器使用同一份新文件。

## 每台電腦的操作

1. 從指定 GitHub Release 下載安裝檔，先核對 `SHA256SUMS.txt`，記錄 Windows SmartScreen／未簽章警告與檔案 SHA-256。teacher candidate 是刻意未簽章版本，只在受控測試環境使用。
2. 安裝並啟動 App，在 Settings 開始 teacher-test run，選取同一份 `.exe`。確認畫面上的 `testRunId`、release tag、source commit、installer filename／SHA-256 與 Windows runtime。
3. 使用同一個已核准的暫時 API key 完成六題。API key 只在測試機的 main-process SecretStore 或本次測試流程中使用，不貼到聊天、issue、PR、screenshot 或 trace；測試後立即刪除並重開 App 驗證未配置。
4. 依 JSON 順序逐題操作。每題只使用 frozen case 的局面、attached move、question、mode；不得為了讓回答變好而改寫問題或手動補入另一條主線。
5. 每題在外部 rubric 只填 `externalReviewId` 與評分，不填姓名、帳號、API key 或本機路徑。App export 只保留匿名 evaluation link、引擎證據與產品必要 trace 欄位。
6. 六題完成後從 Settings 匯出 Harness teacher-test JSON，核對其 `runManifest` 與六個 case 的 `testRunId`；結束 run，再保存 export bytes 的 SHA-256。

## 外部 rubric

每題由老師在同一份 rubric 以 1–5 分記錄，2 與 4 是相鄰描述之間的中間值，並可附短評：

| 維度 | 1 分 | 3 分 | 5 分 |
| --- | --- | --- | --- |
| 最佳著／實戰步判斷正確性 | 核心判斷錯誤或無法判斷 | 大致判斷正確，但有重要遺漏 | 判斷正確，且能指出實戰步與候選最佳步的關鍵差異 |
| 變化是否合法且連貫 | 有非法、跳步或互相矛盾的變化 | 主線大致可走，但部分連接不完整 | 變化合法、連貫，且能回到引擎主線核對 |
| 文字符合引擎 evidence | 補造、誤引或把一般棋理冒充本局證據 | 多數主張有依據，但連結不完整 | 每個關鍵主張都能連回局面、走子或主線 |
| 象棋術語與因果解釋清楚 | 只有標籤／分數，沒有機制 | 有部分棋理機制，但需老師追問 | 說清楚棋子／線路、對手利用與後續後果 |
| 建議具體且可實際練習 | 沒有可執行建議 | 有方向，但學生不知道如何練 | 有明確、可操作、可複盤的練習建議 |
| 能引導學生反思，而非只公布答案 | 只公布結論 | 有一個反思方向，但不夠具體 | 能提出「為什麼」與下一步反思／修正行動 |
| 是否值得放入學習歷程 | 不宜放入，會誤導 | 需大量編修後才可使用 | 可作為學習歷程證據，限制也有清楚標示 |

另以三個獨立 gate 記錄整體狀態，不把 gate 與單題分數互相推導：

| Gate | `pass` | `concern` | `fail` / `not_assessed` |
| --- | --- | --- | --- |
| `softwareEnvironment` | 兩台可安裝、啟動、匯入、分析、解說、feedback、export，且 artifact／run 證據完整 | 有可繞過的環境或流程問題 | 核心流程失敗，或尚未取得足夠環境證據 |
| `xiangqiContent` | 六題中至少五題 correctness ≥ 4/5、證據一致性平均 ≥ 4/5，且無非法／錯局面／錯誤 timeout 描述 | 有可重現的內容疑慮但尚未達 fail | 核心棋理或證據錯誤，或尚未完成真人內容評分 |
| `teachingValue` | 平均 teaching value ≥ 3.5/5，且老師能指出學生練習／反思行動 | 正確但教學轉化仍需改善 | 沒有可用教學行動，或尚未取得教學老師評估 |

每個 gate 為 `not_assessed` 時必須保留原因，不能寫成 pass。評分是外部人的真實資料，不能由 fixture 的 `evaluationLoss` 或 App 自動填入。若老師認為回答不可接受，請保留 `externalReviewId`、case key、機器 run、各項 1–5 分與短評，讓後續工程能重現。

## 雙機完成條件

只有同時取得以下證據，才可說「老師雙機實測完成」：

- Machine A 與 Machine B 各自有可讀的 run manifest、Windows runtime、六題 evaluation links、export SHA-256 與外部 rubric。
- 兩台的 `artifactClaim` 完全相同，且與公開 Release asset SHA-256 相同；`testRunId`、`externalReviewId` 與 export digest 必須各自不同。
- 外部 rubric 有老師的實際評分與短評；無法由自動測試、CI、Server proxy 或本機開發環境代填。
- 測試後 API key 已刪除，export、trace、logs、工作目錄與提交內容中找不到 key、Authorization、hostname、account 或完整 installer path。

任何一項缺失都標記為 `pending`，不是通過。若兩台 App 版本、source commit、installer SHA、題目文字或 mode 不同，整批停止並重新建立新的 run。

## 開發端乾跑與限制

在沒有老師、第二台電腦或暫時 API key 時，開發端只能驗證 schema、case canonicalization、SHA-256 artifact claim、positive export allowlist 與既有 engine fixture；不得建立假的老師 rubric、假的 machine runtime 或假的 provider response。這些未完成項目要留在學習歷程的 `pending` 狀態。
