# 發布架構與操作手冊

本文件定義 Windows 安裝版、GitHub Release 與自動更新來源的唯一發布順序。產品內部模組請參考[架構總覽](../architecture/overview.md)。

## 1. 發布責任

```text
main 原始碼
  ├─ CI workflow：typecheck、完整測試套件、dependency audit、production build
  └─ vX.Y.Z tag
       └─ Release workflow：重跑門檻、封裝、驗證 SHA-256，依 mode 分流
            ├─ teacher-candidate：可為未簽章 prerelease，供老師雙機實測，永不自動升 Latest
            └─ formal-release：必須是有效簽章候選版，再交 Windows 10／11 用戶端驗收
                 └─ 兩邊通過後才升為 Latest，供網頁與自動更新使用
```

- `enzohuang98-crypto/Reckoning` 的原始碼、tag 與 GitHub Release 是唯一權威來源。
- `.github/workflows/ci.yml` 驗證 `main`、PR 與 tag。
- `.github/workflows/release.yml` 只能對已存在且與 `package.json` 完全相符的 tag 發布。
- `Release` workflow 的 `mode` 必須明確選擇 `teacher-candidate` 或 `formal-release`；兩者共用同一個 tag、source commit、安裝檔與 SHA-256 證據格式。
- `tools/release/verify-update-artifacts.ps1` 是本機與 Actions 共用的更新產物完整性檢查。
- GitHub-hosted Windows Server runner 只做相容性代理測試，不能當成 Windows 10 或 Windows 11 用戶端驗收。
- 歷史版本（包括 v0.3.7）只保留原有 Release 與證據，不得被新 workflow 改寫成另一種發布語義。

## 2. Windows 程式碼簽章

`formal-release` 必須建立受保護的 `windows-signing` environment，要求獨立審核者，並只允許受保護的 `main` 發行來源。下列兩個值必須放在該 environment 的 secrets，不可放在一般 repository secrets：

- `WINDOWS_CSC_LINK`：受信任 CA 核發的 PFX（base64 或安全下載位置）。
- `WINDOWS_CSC_KEY_PASSWORD`：PFX 密碼。

`teacher-candidate` 只服務受控的老師測試，可在 runner 內暫時關閉 electron-builder 的強制簽章並公開為 unsigned prerelease；這不是正式發布，也不能設為 Latest 或自動更新來源。`formal-release` 沒有未簽章的放行開關：缺少憑證、簽章狀態不是 `Valid`，或找不到可信時間戳，工作流程都會停止。自簽憑證不等同公開信任。

## 3. 發布順序

1. 確認工作樹乾淨，且 `package.json`、release notes 與預定 tag 版本一致。
2. 執行本機門檻：

   ```powershell
   npm.cmd ci
   C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe /nologo /out:tests\support\fake-engine.exe tests\support\FakeEngine.cs
   npm.cmd run typecheck
   npm.cmd test
   npm.cmd run security:audit
   npm.cmd run build
   ```

3. commit 並 push 分支，以 PR 合併到 `main`，等待 required CI 成功。
4. 建立並 push `vX.Y.Z` annotated tag。版本、tag、`package.json` 與 `main` ancestry 必須相符；v0.3.7 是受保護的歷史例外，不得重跑成新語義。
5. 在 GitHub Actions 手動執行 `Release`，輸入同一個 tag 並明確選擇 `mode`。
6. 若 `mode=teacher-candidate`，workflow 會建立 unsigned prerelease，記下安裝檔檔名、大小、SHA-256、tag、source commit 與 run ID；此版本只供受控老師測試，永不升為 Latest。若 `mode=formal-release`，workflow 會先完成有效 Authenticode 簽章與可信時間戳門檻，再公開 signed prerelease。
7. 從乾淨快照的 Windows 10 22H2 x64 與 Windows 11 x64 各自用瀏覽器下載。正式候選版要確認 Mark of the Web、有效簽章與時間戳；老師候選版則要明確記錄未簽章與 SmartScreen 風險。兩種候選版都要確認安裝、啟動、Pikafish `uci`／搜尋、捷徑與解除安裝。
8. 依照 [用戶端證據範例](windows-client-evidence.example.json) 分別產生 JSON，寫入本次 repository、tag、commit、Release workflow run ID、mode 與安裝檔 SHA-256。兩份檔案放在不同的 HTTPS 網址。
9. 對兩份 JSON 原始 bytes 分別計算 SHA-256。正式候選版才可把網址與 digest 寫入 `windows-client-release` environment 的 `WINDOWS_10_CLIENT_EVIDENCE_URL`、`WINDOWS_10_CLIENT_EVIDENCE_SHA256`、`WINDOWS_11_CLIENT_EVIDENCE_URL`、`WINDOWS_11_CLIENT_EVIDENCE_SHA256`。
10. 審核 environment gate。驗證器會拒絕重新導向，並核對文件 digest、24 小時時效、本次 tag／commit／workflow run 與安裝檔 SHA-256；只有 `formal-release` 且兩台都通過，prerelease 才會升為 Latest。`teacher-candidate` 不進入 promotion gate。

## 4. 既有 Release 資產修復

只有在 tag、Release 與本機建置來源完全一致時，才可執行 `npm.cmd run publish:update:github`。腳本會先驗證版本、檔名、大小、SHA-512、有效 Authenticode 簽章與時間戳，再覆寫該 Release 的三項資產；它不建立 tag、不建立 Release，也不刪除歷史版本。

## 5. 失敗與回復原則

- CI 或 Release 任一門檻失敗時不得升為 Latest，也不得成為自動更新來源。
- 不以舊的 `release/` 檔案補上失敗的 build；產物必須由同一 tag 重新建立。
- 發現錯版時先停止發布並保留證據，不刪除 tag、Release 或歷史更新資產；另建修正版號。
- GitHub Release 的 `latest.yml`、安裝檔與 blockmap 必須來自同一次 build，避免 SHA-512 與實際下載檔不一致。
