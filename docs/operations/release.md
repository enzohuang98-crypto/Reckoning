# 發布架構與操作手冊

本文件定義 Windows 安裝版、GitHub Release 與自動更新來源的唯一發布順序。產品內部模組請參考[架構總覽](../architecture/overview.md)。

## 1. 發布責任

```text
main 原始碼
  ├─ CI workflow：typecheck、完整測試套件、dependency audit、production build
  └─ vX.Y.Z tag
       └─ Release workflow：重跑門檻、封裝、驗證 SHA-256，依 mode 分流
            ├─ teacher-candidate：可為未簽章 prerelease，供老師雙機實測，永不自動升 Latest
            ├─ unsigned-release：擁有者明確授權的過渡候選模式，只建立不可變 prerelease
            │    └─ Windows／AI／更新器實機驗收後，以獨立 promotion workflow 提升同一批資產
            └─ formal-release：必須是有效簽章候選版，再交 Windows 10／11 用戶端驗收
                 └─ 兩邊通過後才升為 Latest，供網頁與自動更新使用
```

- `enzohuang98-crypto/Reckoning` 的原始碼、tag 與 GitHub Release 是唯一權威來源。
- `.github/workflows/ci.yml` 驗證 `main`、PR 與 tag。
- `.github/workflows/release.yml` 只能對已存在且與 `package.json` 完全相符的 tag 發布。
- `Release` workflow 的 `mode` 必須明確選擇 `teacher-candidate`、`unsigned-release` 或 `formal-release`；三者共用同一個 tag、source commit、安裝檔與 SHA-256 證據格式。
- `tools/release/verify-update-artifacts.ps1` 是本機與 Actions 共用的更新產物完整性檢查。
- GitHub-hosted Windows Server runner 只做相容性代理測試，不能當成 Windows 10 或 Windows 11 用戶端驗收。
- 歷史版本（包括 v0.3.7）只保留原有 Release 與證據，不得被新 workflow 改寫成另一種發布語義。

## 2. Windows 程式碼簽章

`formal-release` 必須建立受保護的 `windows-signing` environment，要求獨立審核者，並只允許受保護的 `main` 發行來源。下列兩個值必須放在該 environment 的 secrets，不可放在一般 repository secrets：

- `WINDOWS_CSC_LINK`：受信任 CA 核發的 PFX（base64 或安全下載位置）。
- `WINDOWS_CSC_KEY_PASSWORD`：PFX 密碼。

`teacher-candidate` 只服務受控的老師測試，可在 runner 內暫時關閉 electron-builder 的強制簽章並公開為 unsigned prerelease；這不是正式發布，也不能設為 Latest 或自動更新來源。`unsigned-release` 是擁有者明確授權的短期同步例外：必須輸入精確確認字串、完整重跑測試與稽核、驗證 NotSigned、SHA-256、安裝／解除安裝，再從匿名公開網址於兩個 Windows Server 代理重新下載相同 bytes。Release workflow 到此只留下不可變候選版；完成真正 Windows App、AI 與更新器實機驗收後，才可用 `Promote unsigned candidate` workflow 核對預期 installer SHA-256，將同一份 Release 提升為 Latest。promotion 不重新建置、不重新上傳，也不使用 `--clobber`。未簽章版本仍沒有可信發行者，不能算作正式簽章或乾淨 Windows 10／11 證據。`formal-release` 沒有未簽章的放行開關：缺少憑證、簽章狀態不是 `Valid`，或找不到可信時間戳，工作流程都會停止。自簽憑證不等同公開信任。

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
   同 tag 的 Release 已存在時 workflow 會失敗；不得重建或覆寫公開候選資產，必須改用下一個未使用的 patch 版本。
6. 若 `mode=teacher-candidate`，workflow 會建立 unsigned prerelease，永不升為 Latest。若 `mode=unsigned-release`，必須輸入 `PUBLISH UNSIGNED LATEST`，並建立帶警告的 unsigned prerelease；同次 build 的 SHA-256、安裝／解除安裝及兩個匿名公開下載代理全部通過後仍保持 prerelease，等待實機驗收。若 `mode=formal-release`，workflow 會先完成有效 Authenticode 簽章與可信時間戳門檻，再公開 signed prerelease。三種模式都記錄檔名、大小、SHA-256、tag、source commit 與 run ID。
7. 從乾淨快照的 Windows 10 22H2 x64 與 Windows 11 x64 各自用瀏覽器下載。正式候選版要確認 Mark of the Web、有效簽章與時間戳；未簽章候選版則要明確記錄 NotSigned 與 SmartScreen 風險。兩種候選版都要確認安裝、啟動、Pikafish `uci`／搜尋、捷徑與解除安裝。未簽章同步版本另須完成產品指定的真實 AI、同 key 切換、資料保護與隔離更新器驗收。
8. 依照 [用戶端證據範例](windows-client-evidence.example.json) 分別產生 JSON，寫入本次 repository、tag、commit、Release workflow run ID、mode 與安裝檔 SHA-256。兩份檔案放在不同的 HTTPS 網址。
9. 對兩份 JSON 原始 bytes 分別計算 SHA-256。正式候選版才可把網址與 digest 寫入 `windows-client-release` environment 的 `WINDOWS_10_CLIENT_EVIDENCE_URL`、`WINDOWS_10_CLIENT_EVIDENCE_SHA256`、`WINDOWS_11_CLIENT_EVIDENCE_URL`、`WINDOWS_11_CLIENT_EVIDENCE_SHA256`。
10. 審核 environment gate。驗證器會拒絕重新導向，並核對文件 digest、24 小時時效、本次 tag／commit／workflow run 與安裝檔 SHA-256；只有 `formal-release` 且兩台都通過，prerelease 才會升為 Latest。`teacher-candidate` 不進入 promotion gate。
11. `unsigned-release` 的全部實機門檻通過後，手動執行 `Promote unsigned candidate`，輸入既有 tag、已驗收 installer 的 SHA-256 與精確確認字串 `PUBLISH UNSIGNED LATEST`。workflow 會從公開 Release 重新下載並核對 manifest、版本、大小、SHA-512 與 SHA-256，只切換該既有 prerelease 的狀態；不得重新 build 或覆寫資產。

## 4. 既有 Release 資產修復

只有在 tag、Release 與本機建置來源完全一致時，才可執行 `npm.cmd run publish:update:github`。腳本會先驗證版本、檔名、大小、SHA-512、有效 Authenticode 簽章與時間戳，再覆寫該 Release 的三項資產；它不建立 tag、不建立 Release，也不刪除歷史版本。

## 5. 失敗與回復原則

- CI 或 Release 任一門檻失敗時不得升為 Latest，也不得成為自動更新來源。
- 不以舊的 `release/` 檔案補上失敗的 build；產物必須由同一 tag 重新建立。
- 發現錯版時先停止發布並保留證據，不刪除 tag、Release 或歷史更新資產；另建修正版號。
- GitHub Release 的 `latest.yml`、安裝檔與 blockmap 必須來自同一次 build，避免 SHA-512 與實際下載檔不一致。
