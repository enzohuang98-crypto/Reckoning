# 象棋 AI 分析講解：專案交接狀態

最後更新：2026-08-06

## 1. 目前狀態

- 目前 source candidate：**v0.3.8**（public teacher-test prerelease；刻意未簽章，非 Latest）
- GitHub：`https://github.com/enzohuang98-crypto/Reckoning`
- 目前公開 Release：<https://github.com/enzohuang98-crypto/Reckoning/releases/tag/v0.3.7>（2026-07-29 發布、非 draft、prerelease、刻意未簽章）
- v0.3.8 teacher candidate Release：<https://github.com/enzohuang98-crypto/Reckoning/releases/tag/v0.3.8>（2026-08-06 發布、非 draft、prerelease、刻意未簽章；沒有升為 Latest）
- `v0.3.7` annotated tag object 是 `f7efc67da97f3f4fc77bfc89625f8cb902d53cf6`，product commit 是
  `e6cce2f7e0a045b080f40c4e4454cc0d32335ab8`；目前 `main` 是
  `81bee70dd1eaf53014fa8ffd736195f5eae98855`，不可把兩者當成同一版。
- v0.3.7 安裝檔 `xiangqi-analyzer-0.3.7-setup.exe` 的公開 SHA-256 是
  `1277f5a3da64519178d38ec6bec09cf8fc7bbeb44cd4562ca4f466ff32ee8c21`。
- v0.3.7 Release run `30426166887` 的建置、測試、unsigned smoke 與 Server proxy 成功；clean Windows
  10/11 client-evidence job 曾長時間 waiting，已於 2026-08-06 取消，不能算作 client gate。
- v0.3.8 teacher-candidate Release run `31102841850` 的 build、完整測試、audit、unsigned install/uninstall
  smoke 與 Server 2022/2025 proxy 全部成功；安裝檔大小 `164630417` bytes、SHA-256 為
  `e3e9fd0b727e614ed911ff5dbabc5b8df843de2cbdba3566af8e0cae9127d94c`。Win10/Win11 client evidence 與
  promotion 依 mode 明確 skipped，完整紀錄見 [`release-v0.3.8-evidence.md`](docs/operations/release-v0.3.8-evidence.md)。
- 安裝下載與自動更新的唯一權威來源為本倉庫的 GitHub Releases，流程見
  [`docs/operations/release.md`](docs/operations/release.md) 與
  [`docs/operations/update-channel.md`](docs/operations/update-channel.md)。
- v0.3.8 teacher-test 的 frozen 六案例與雙機 protocol 見
  [`docs/operations/teacher-test-cases-v1.json`](docs/operations/teacher-test-cases-v1.json) 與
  [`docs/operations/teacher-test-protocol-v1.md`](docs/operations/teacher-test-protocol-v1.md)。

各版本的完整說明保存在 [`docs/releases/`](docs/releases/)，本檔只記錄跨版本的狀態、限制與維護原則。

## 2. 版本發布歷程

| 版本 | 發布日 | 重點 |
| --- | --- | --- |
| v0.3.0 | 2026-07-13 | Task-first 介面、UCI/UCCI 多引擎與雙引擎裁決、四類 AI Provider、AI 解說品質迴圈、CI 與 Release workflow |
| v0.3.1 | 2026-07-14 | 分析頁三列固定版面（不需捲動整頁）、持續引擎與可控 AI 工作、棋盤鍵盤操作與可存取性、資料讀取失敗不覆蓋原檔 |
| v0.3.2 | 2026-07-21 | AI 教練不再把模型逾時誤稱為引擎證據不足；**安裝版開始內附 Pikafish 與 NNUE 權重**；更新來源統一至本倉庫 GitHub Releases；補齊公開專案基本設定 |
| v0.3.3 | 2026-07-21 | 修正 NSIS 安裝模式頁在乾淨機器上仍誤判為「升級」 |
| v0.3.4 | 2026-07-21 | 修正首次設定精靈內容超出視窗時無法捲動到「完成設定」 |
| v0.3.5 | 2026-07-21 | 明確寫入並回讀 App 專屬安裝／解除安裝登錄；Release 會在乾淨 runner 實跑靜默安裝與解除安裝驗收 |
| v0.3.6 | 2026-07-25 | 修正新增 API 金鑰時整個視窗卡住無回應（`SecretStore`／`SecureJsonFile` 改用 `node:fs/promises`）；新增金鑰健康檢查（測試金鑰）與逾時保護；分數顯示統一以 `displayText` 為主；App 內部品牌名稱統一 |
| v0.3.7 | 2026-07-25 | 修正桌面 App 實質上不會自動更新：有新版時標題列會主動提示（先前只藏在設定頁內），並改為每 4 小時重新檢查（先前只在啟動後檢查一次） |
| v0.3.8 | 2026-08-06 | public unsigned teacher-test candidate：run manifest、保守 case ID、匿名 review link、非同步 installer SHA、正向 allowlist export；尚未代表老師或 Windows 雙 client 驗收 |

## 3. 2026-07-25（上午）：相依弱點、CI 整理與文件同步

本輪不含任何產品功能或棋力邏輯變更，全部集中在建置、稽核與文件。

### 3.1 相依套件弱點（PR #14，commit `124bed3`、`2df18b5`）

GitHub Advisory Database 對**未變動的 lockfile** 陸續發布新弱點，使 `npm audit` 從 3 個增至 19 個，CI 的 `security:audit` 長期卡紅燈。

已套用可安全修復的部分（`npm audit fix`，非 `--force`），共 14 個套件版本異動，關鍵為
`fast-uri` 3.1.4、`postcss` 8.5.23、`tar` 7.5.22、`brace-expansion`（頂層）5.0.8、
`electron-builder` **26.15.3 → 26.15.7**（同 major patch 升級）。

剩餘弱點全部指向同一個 `brace-expansion` advisory，且**無法從本倉庫修復**：

- 相依樹同時需要三個互不相容的 major——minimatch 3.x／5.x／9.x 需要 callable 的 1.x／2.x，minimatch 10.x 需要 `{ expand }` 物件的 5.x。
- 唯一修好的 5.0.8 改了匯出形式。實測以 `overrides` 強制統一後，minimatch 3.1.5 在**含大括號的 glob pattern** 會丟 `TypeError: expand is not a function`；electron-builder 的 `files` 設定大量使用大括號，等於弄壞 `npm run dist`，但整套測試仍會全綠。
- `npm audit fix --force` 的建議則是把 `electron-builder` **降版**到 25.x。

兩種修法都經實測後排除。

### 3.2 分層稽核政策

`npm run security:audit` 改走 `tools/security/audit-dependencies.mjs`，依「是否會隨 App 散布給使用者」分層把關：

| 層級 | 範圍 | 門檻 | 現況 |
| --- | --- | --- | --- |
| 1 | 執行期相依（`--omit=dev`） | moderate 以上一律擋下 | 0 個 |
| 2 | 建置工具相依中**自身帶 advisory 的根因**，且可安全修復 | 一律擋下 | 0 個 |
| 3 | 同上但只剩破壞性修法 | 記錄追蹤，不擋 | 1 個根因（另 15 個連坐） |

第 2 層確保這個豁免不會變成永久免死金牌：上游一釋出可安全套用的修正，CI 立刻要求套用。
第 2、3 層只針對「自身中招」的根因判斷——`npm audit` 對**同一個根因**在 Linux 與 Windows 會回報不一致的 `fixAvailable`，若讓純連坐的套件各自把關，CI 會卡在沒有任何 `npm audit fix` 能滿足的紅燈。

政策全文與理由見 [`docs/architecture/security-l2.md`](docs/architecture/security-l2.md) 的「相依套件弱點政策」。

### 3.3 CI／Release workflow 整理與文件同步（PR #13，commit `7131f38`、`9f1d134`）

- 新增 `.github/actions/compile-fake-engine` composite action，`ci.yml` 與 `release.yml` 不再各自維護一份逐字重複的假引擎編譯腳本。
- 把 `release.yml` 中一個約 35 行、同時處理版本解析／signtool 搜尋／簽章驗證／簽章政策的內嵌步驟抽成 `tools/release/verify-signature.ps1`（`npm run verify:signature`），拆為兩個各司其職的步驟；`release.yml` 由 159 行降到 122 行。
- `CLAUDE.md` 同步到目前程式碼現況（內建 Pikafish、PlayOK WXF 匯入、`openai-compatible` provider、GitHub Release 自動更新、Harness 現行契約），並移除容易與程式碼漂移的寫死測試數字。

### 3.4 本輪驗證狀態

- PR #13、#14 的 Windows CI 皆已通過（typecheck、完整 `npm test`、引擎 E2E、dependency audit、production build）。
- `npm run build` 已實跑確認（postcss／vite 有升級）。
- 稽核腳本的**兩條失敗路徑都實測會擋下**，不是只驗證通過路徑。
- 已驗證未引入相容性破壞：6 個 minimatch 副本全部 resolve 到相容的 brace-expansion，不相容數 0。
- ~~**尚未驗證**：`npm run dist` 實際產出 Windows 安裝檔（CI 只跑到 `npm run build`），以及 `release.yml` 新抽出的 `verify:signature` 步驟——後者只有真正執行 Release workflow 時才會跑到。~~
  **已於 v0.3.6 發行時補驗證，見 §4.4。**

## 4. 2026-07-25（下午）：修正新增 API 金鑰卡住視窗（v0.3.6，PR #16）

使用者實測回報：在設定頁新增 API 金鑰時，整個視窗會失去回應。三個背景研究 agent
定位根因後修正，範圍刻意收斂在實際造成這個問題的路徑，不擴及其他子系統。

### 4.1 根因與修法

- 根因：`SecretStore` 透過共用工具 `SecureJsonFile` 讀寫 `secrets.enc.json`，其中
  `writeJsonFileAtomic` 使用 `writeFileSync(..., { flush: true })`（強制 fsync）。
  這串同步磁碟 I/O 執行在 Electron main process 的訊息迴圈上，會讓整個視窗（不只設定頁）
  卡住沒有重繪、沒有輸入回應，Windows 上防毒軟體攔截時尤其明顯。
- 修法：新增 `readJsonFileAsync`／`writeJsonFileAtomicAsync`（`node:fs/promises`），
  `SecretStore` 全面改為 async，`aiExplanationHandlers.ts` 的 `secret:*` IPC handler 對應改
  async/await。**刻意不動** `StorageService`（供 engine registry／license／app-data／
  harness trace 使用）——這些路徑不是這次回報問題的成因，維持原樣以避免無關的大規模重構。
- 設定頁新增 `secretBusy` 狀態與既有 `withTimeout`（10 秒）逾時保護，儲存／啟用／刪除金鑰
  與初次狀態讀取皆套用，逾時會顯示明確錯誤而不是無限卡住。

### 4.2 新增金鑰健康檢查

- `AIProvider` 介面新增 `testCredential()`：Anthropic 用 SDK 的 `models.list()`，
  OpenAI／Gemini／OpenAI-compatible 呼叫對應的 `/models` 端點，不消耗生成 token。
  新增 `ai:test-credential` IPC 通道與設定頁「測試金鑰」按鈕；草稿金鑰（尚未儲存）測試時
  只在該次請求使用，不落地。
- `detectApiKeyProvider` 修正：即使已指定 `preferredProvider`，仍依已知金鑰前綴
  （`sk-ant-`／`AIza`／`sk-`）做格式檢查，擋下貼錯欄位的金鑰（例如把 Anthropic 金鑰
  貼進 OpenAI 欄位），而不是等到真正呼叫 API 才發現。

### 4.3 分數顯示與品牌名稱

- `EngineResultSummary`／`GuessModePanel` 主要顯示改為 `score.displayText`
  （例如 `+1.20`），不再把 `.raw` UCI 字串標成「原始分數」跟它並列造成兩個數字互相矛盾；
  `scoreRaw`（實際裝著 `displayText`）改名為 `scoreDisplay`，純改名無邏輯變動。
- App 內部三處品牌名稱（AppShell「象理」／StartupScreen「XIANGQI STUDY DESK」／
  SetupWizard「XIANGLI」）統一為「象棋 AI 分析講解」，與安裝檔、官網一致；
  未調整任何版面比例或 CSS 尺寸。

### 4.4 驗證狀態

- PR #16 的 Windows CI（`ci.yml`）已通過（typecheck、完整 `npm test` 含引擎 E2E 與
  secret-store electron 測試、dependency audit、production build）。
- 本機 Linux 額外驗證：新增 Anthropic provider 請求形狀測試與四個 provider 的
  `testCredential` 成功／401／逾時測試（`providers.test.ts`，共 71 條斷言）；
  `secretStore.electron.test.ts` 以 `xvfb-run --no-sandbox` 在容器內用真正 Electron
  runtime 驗證 async 簽章與 safeStorage 加解密仍正確。
- **v0.3.6 Release workflow 全程通過**（run
  [30177545758](https://github.com/enzohuang98-crypto/Reckoning/actions/runs/30177545758)，
  15 個步驟全綠）。這一併補上了 §3.4 當時列為「尚未驗證」的兩項：
  `npm run dist` 已實際在乾淨 Windows runner 產出安裝檔並通過靜默安裝／解除安裝驗收，
  `release.yml` 抽出的 `verify:signature` 步驟也已首次實跑通過（`allow_unsigned=true` 路徑）。
- 產出資產：`xiangqi-analyzer-0.3.6-setup.exe`（169,642,942 bytes，
  sha256 `48dc04d6…c19b8d`）、對應 `.blockmap` 與 `latest.yml`。

## 5. 2026-07-25（晚間）：修正自動更新實質不可見（v0.3.7）

使用者回報「已經發布 v0.3.6，但桌面 App 沒有自動更新」。實測後確認更新來源與
`electron-updater` 串接都是好的，問題出在兩個獨立缺陷：

### 5.1 根因

- **提示看不到**：`updateStatus` 在 renderer 只被 `SystemSettingsSection` 使用，
  AppShell、主畫面、標題列都沒有任何指示。偵測到新版後只會靜靜改變設定頁裡的一段文字，
  使用者不主動點進「設定 → 系統」就永遠不知道，體感等同沒有自動更新。
- **只檢查一次**：`startAutomaticCheck()` 是單發 `setTimeout(5 秒)`，沒有 interval。
  習慣讓 App 一直開著的使用者，在該次啟動之後發布的任何版本都不會被發現。

### 5.2 修法

- 標題列在 `phase` 為 `available` 或 `downloaded` 時顯示提示，點擊切到設定頁；
  其餘狀態（含 `checking`／`not-available`／`error`）不打擾使用者，**沒有新版時完全不渲染**。
- 首次檢查後改為每 4 小時再檢查一次（`RECHECK_INTERVAL_MS`）。
- `check()` 加上防護：`checking`／`downloading`／`downloaded` 期間不重跑，
  否則背景重新檢查會把已下載狀態蓋回 `available`，使用者剛下載好的安裝按鈕會消失。
- 自動下載仍**刻意維持關閉**（`autoDownload = false`）：只自動偵測與提示，
  下載與安裝一律由使用者按鈕決定。

### 5.3 版面影響

標題列提示為 `flex: 0 0 auto`，不與分析工具列掛載點（`.analysis-command-mount`，
維持唯一的 `flex: 1`）搶伸縮空間，且只在有新版時存在，因此不影響已驗收的分析頁比例。
新增 `tests/unit/renderer/updatePrompt.test.tsx`（15 條斷言）鎖定這兩點與各 phase 的顯示規則。

## 6. 發行門檻

每個可交付版本至少必須完成（詳見 [`docs/operations/release.md`](docs/operations/release.md)）：

```powershell
npm.cmd run typecheck
npm.cmd test
npm.cmd run security:audit
npm.cmd run build
npm.cmd run dist
```

封裝後還要從安裝版以滑鼠驗證：啟動、棋盤走子、局面工具、悔棋／下一步、引擎即時分析、右側檢視切換、猜著選棋、AI 解說入口、設定分類與版本頁；並核對安裝版版本、`app.asar` 與本次封裝一致，桌面捷徑指向新的安裝位置。

完整 `npm test` 需要 Windows：引擎 E2E 與 secret-store 測試需要先以 `csc.exe` 編譯 `tests/support/FakeEngine.cs`，並需要真正的 Electron runtime。部分測試（`security.test.ts`、`engineRegistry.test.ts`）的斷言使用 `C:\...` 路徑，在非 Windows 環境會失敗，屬預期行為。

## 7. Windows 發行政策與 teacher-test 限制

GitHub Actions 尚未設定 `WINDOWS_CSC_LINK`／`WINDOWS_CSC_KEY_PASSWORD` secrets，也沒有受信任 CA 核發的程式碼簽章憑證。沒有它就無法讓 Windows 對公開下載的安裝檔建立可信發行者身分。

因此目前保留兩種明確分離的 workflow 語意：

- `teacher-candidate`：可在明確揭露風險下建立未簽章 prerelease；永遠不會自動升為 Latest。
- `formal-release`：必須使用受信任 Authenticode 憑證與時間戳，並通過獨立的 Windows 10 22H2 與 Windows 11 client evidence，才允許 promotion。
- 不可用自簽憑證宣稱已完成正式簽章，也不可把 Server proxy 成功寫成 Win10/Win11 client evidence。
- v0.3.7 保留為歷史 unsigned prerelease，不覆寫 tag、Release 或 asset；v0.3.8 必須使用新 tag、新 commit 與新 SHA。

v0.3.8 teacher candidate 已按上述例外實際發布：Release run `31102841850`、tag/source 綁定與 installer SHA-256 均已獨立核對；它仍不具可信簽章、不進 Latest，也沒有真人老師或第二台電腦結果。

teacher-test 程式只保存 main-memory run context；正式測試每台機器都必須在測試當天匯出 trace，並由外部評分表保存姓名、簽名與質性理由。六案例與 runtime canonicalization 已由本機測試驗證，但尚未有專業象棋老師或學習歷程老師的實測結果，不能宣稱整體棋理或教學價值已驗證。

## 8. 其他已知產品限制

- 安裝版自 v0.3.2 起內附 Pikafish 執行檔與 NNUE 權重（`resources/engine/`，GPL v3 + 權重授權條款，不受根目錄 MIT License 涵蓋）；乾淨安裝會自動登錄為「Pikafish（內建）」。使用者仍可刪除或改用自備的其他 UCI／UCCI 引擎。
- 棋譜匯入目前支援 FEN、UCI 著法序列與 PlayOK WXF；**尚未支援 PGN 或中文著法（炮二平五）格式**。
- 雙引擎實測使用兩個不同的 Pikafish 執行檔，可證明雙程序、不中斷 Live 與 AI 證據整合管線，但不等同兩個獨立棋力家族的分歧裁決品質驗收。
- 授權閘門依使用者要求以 `LICENSE_GATE_DISABLED = true` 維持測試停用（`src/renderer/src/app/productFlags.ts`）；這不代表商業授權與付費流程已可公開販售。
- 官方與相容服務的 model id 需在發行前依各服務商目前模型頁重新核對。
- 目前 lockfile 經 `npm audit fix` 後，`npm run security:audit` 為執行期與建置工具相依皆 0 個未處理弱點；§3.2 保留的是 2026-07-25 的歷史稽核背景，後續 Advisory 變動仍須在每次 CI 重新核對。

## 9. 過往驗證紀錄（v0.3.1 時期，2026-07-16）

以下為當時保留的實測數據，供回歸比對參考；細節與後續版本差異以 `docs/releases/` 為準。

- **視窗比例**：`1024×700`、`1366×768`、`1920×1080` 三種視窗下，棋盤、AI 教練與底部即時分析同屏可見，頁面本身不需捲動；空白狀態不產生無意義的內部捲軸。
- **PlayOK 引擎基線**：十盤完整對局從第一手跑到最後一手，825／825 個 ply 都有引擎證據，parse error、illegal move、engine error、超過 3 秒皆為 0；平行比較 min／median／p95／max 為 486／1581／2477／2975 ms。
- **AI corpus**：五盤逐手 corpus 固定為 358 個 ply，離線 self-test 通過（`fixed=6, soak=358`）。**尚未完成 358 次真實模型呼叫**——當時 Gemini 免費層額度不足，不可把 corpus／dry-run 說成 358 次 live API 成功。
- **真實 Gemini 端到端**：最佳化後初次完整解說 trace `cc834e83-2df2-4cb1-ac84-0881929a3020` 為 34,478 ms、2 次模型呼叫、0 額外引擎輪次、0 validation error；同一對話追問 trace `6d4b7eb4-6960-4d04-9780-7736d3daf242` 為 11,945 ms、1 次模型呼叫。
- **單一產品引擎**：產品 registry 只有一個 Pikafish 安裝項目，`verificationEngineId=null`，UI 只顯示「主引擎」；只有真的加入第二顆產品引擎才會出現複核相關 UI 與文案。驗收工具自身的 cross-check 是隔離的測試資產，不是使用者安裝的第二顆引擎。
- **AI 模型選單**：只列出能解密且具有精確憑證的 `provider + model + baseURL` 組合；金鑰不可跨模型或跨端點共用。

## 10. 發布與維護原則

- 不可用分數高低代替象棋因果解釋，術語也不能冒充本局證據。
- 不可平均主引擎與複核引擎分數；分歧時必須保留兩邊證據。
- API Key 不可進入 renderer、log、trace、Git 或安裝產物。
- Harness 必須有呼叫、token、研究輪次與重寫輪次上限，不可無限重試。
- 不可因切換 UI 檢視而取消引擎或 AI 工作；使用者明確停止時也不可自動重啟。
- 資料讀取失敗時不可用空白資料覆蓋原檔。
- 不可只看 source code 宣告桌面 App 可用；必須驗證封裝版、安裝版與實際桌面操作。
- 發布失敗時保留 tag、Release 與產物證據，另建修正版號，不覆寫既有版本。
- 不可遺失使用者或其他代理留下的工作樹變更；任何同步前先檢查 `git status` 與遠端 HEAD。
- 相依弱點的豁免只適用於不隨安裝檔散布的建置工具，且必須是「只剩破壞性修法」；執行期相依維持零容忍。
