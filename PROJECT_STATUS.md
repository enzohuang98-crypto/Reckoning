# 象棋 AI 分析講解：專案交接狀態

最後更新：2026-07-25

## 1. 目前狀態

- 目前版本：**v0.3.5**（`package.json` 與最新 GitHub Release 一致）
- GitHub：`https://github.com/enzohuang98-crypto/Reckoning`
- `main` HEAD：`9f1d134`（`ci: dedupe fake-engine compile step and extract signing verification`）
- 最新 Release：<https://github.com/enzohuang98-crypto/Reckoning/releases/tag/v0.3.5>（2026-07-21 發布，非 draft、非 prerelease）
- 安裝下載與自動更新的唯一權威來源為本倉庫的 GitHub Releases，流程見
  [`docs/operations/release.md`](docs/operations/release.md) 與
  [`docs/operations/update-channel.md`](docs/operations/update-channel.md)。

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

## 3. 2026-07-25：相依弱點、CI 整理與文件同步

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
- **尚未驗證**：`npm run dist` 實際產出 Windows 安裝檔（CI 只跑到 `npm run build`），以及 `release.yml` 新抽出的 `verify:signature` 步驟——後者只有真正執行 Release workflow 時才會跑到。下次發行前應優先確認這兩項。

## 4. 發行門檻

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

## 5. 唯一外部發行阻塞：受信任 Windows 簽章

GitHub Actions 尚未設定 `WINDOWS_CSC_LINK`／`WINDOWS_CSC_KEY_PASSWORD` secrets，也沒有受信任 CA 核發的程式碼簽章憑證。沒有它就無法讓 Windows 對公開下載的安裝檔建立可信發行者身分。

因此：

- 可以發行明確標示風險的未簽章過渡版（v0.3.0 至 v0.3.5 皆是）。
- 不可用自簽憑證宣稱已完成正式簽章，也不可保證 SmartScreen 不警告。
- 正式公開販售前，必須取得受信任 CA 的 PFX、設定 GitHub secrets，保持 `allow_unsigned=false` 重新封裝，並重新驗證簽章、安裝與自動更新。

## 6. 其他已知產品限制

- 安裝版自 v0.3.2 起內附 Pikafish 執行檔與 NNUE 權重（`resources/engine/`，GPL v3 + 權重授權條款，不受根目錄 MIT License 涵蓋）；乾淨安裝會自動登錄為「Pikafish（內建）」。使用者仍可刪除或改用自備的其他 UCI／UCCI 引擎。
- 棋譜匯入目前支援 FEN、UCI 著法序列與 PlayOK WXF；**尚未支援 PGN 或中文著法（炮二平五）格式**。
- 雙引擎實測使用兩個不同的 Pikafish 執行檔，可證明雙程序、不中斷 Live 與 AI 證據整合管線，但不等同兩個獨立棋力家族的分歧裁決品質驗收。
- 授權閘門依使用者要求以 `LICENSE_GATE_DISABLED = true` 維持測試停用（`src/renderer/src/app/productFlags.ts`）；這不代表商業授權與付費流程已可公開販售。
- 官方與相容服務的 model id 需在發行前依各服務商目前模型頁重新核對。
- 建置工具鏈（electron-builder 及其相依）帶有上游尚無安全修法的已知弱點，見 §3.2 第 3 層與 `security-l2.md` 的剩餘風險說明。

## 7. 過往驗證紀錄（v0.3.1 時期，2026-07-16）

以下為當時保留的實測數據，供回歸比對參考；細節與後續版本差異以 `docs/releases/` 為準。

- **視窗比例**：`1024×700`、`1366×768`、`1920×1080` 三種視窗下，棋盤、AI 教練與底部即時分析同屏可見，頁面本身不需捲動；空白狀態不產生無意義的內部捲軸。
- **PlayOK 引擎基線**：十盤完整對局從第一手跑到最後一手，825／825 個 ply 都有引擎證據，parse error、illegal move、engine error、超過 3 秒皆為 0；平行比較 min／median／p95／max 為 486／1581／2477／2975 ms。
- **AI corpus**：五盤逐手 corpus 固定為 358 個 ply，離線 self-test 通過（`fixed=6, soak=358`）。**尚未完成 358 次真實模型呼叫**——當時 Gemini 免費層額度不足，不可把 corpus／dry-run 說成 358 次 live API 成功。
- **真實 Gemini 端到端**：最佳化後初次完整解說 trace `cc834e83-2df2-4cb1-ac84-0881929a3020` 為 34,478 ms、2 次模型呼叫、0 額外引擎輪次、0 validation error；同一對話追問 trace `6d4b7eb4-6960-4d04-9780-7736d3daf242` 為 11,945 ms、1 次模型呼叫。
- **單一產品引擎**：產品 registry 只有一個 Pikafish 安裝項目，`verificationEngineId=null`，UI 只顯示「主引擎」；只有真的加入第二顆產品引擎才會出現複核相關 UI 與文案。驗收工具自身的 cross-check 是隔離的測試資產，不是使用者安裝的第二顆引擎。
- **AI 模型選單**：只列出能解密且具有精確憑證的 `provider + model + baseURL` 組合；金鑰不可跨模型或跨端點共用。

## 8. 發布與維護原則

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
