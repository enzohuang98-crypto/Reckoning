# 發布架構與操作手冊

本文件定義 Windows 安裝版、GitHub Release 與自動更新來源的唯一發布順序。產品內部模組請參考[架構總覽](../architecture/overview.md)。

## 1. 發布責任

```text
main 原始碼
  ├─ CI workflow：typecheck、完整測試套件、dependency audit、production build
  └─ vX.Y.Z tag
       └─ Release workflow：重跑門檻、封裝、驗證 metadata／SHA-512／簽章
            └─ GitHub Release：setup.exe、blockmap、latest.yml
                 └─ xiangqi-analyzer-site/downloads：公開 generic update channel
                      └─ 已安裝桌面 App
```

- `xiangqi-analyzer` 是原始碼、tag 與 GitHub Release 的權威來源。
- `xiangqi-analyzer-site` 只保存公開更新檔；`latest.yml` 指向目前版本，舊版安裝檔與 blockmap 保留供追溯。
- `.github/workflows/ci.yml` 驗證 `main`、PR 與 tag。
- `.github/workflows/release.yml` 只能對已存在且與 `package.json` 完全相符的 tag 發布。
- `tools/release/verify-update-artifacts.ps1` 是本機與 Actions 共用的更新產物完整性檢查。

## 2. Windows 程式碼簽章

正式公開版本應在 GitHub repository secrets 設定：

- `WINDOWS_CSC_LINK`：受信任 CA 核發的 PFX（base64 或安全下載位置）。
- `WINDOWS_CSC_KEY_PASSWORD`：PFX 密碼。

Release workflow 預設拒絕沒有憑證的封裝。`allow_unsigned` 只供已明確接受 SmartScreen 風險的過渡版本，Release notes 必須寫明未簽章。自簽憑證不等同公開信任，不可用來宣稱正式簽章已完成。

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

3. commit 並 push `main`，等待 CI 成功。
4. 建立並 push `vX.Y.Z` annotated tag。
5. 在 GitHub Actions 手動執行 `Release`，輸入同一 tag；有正式憑證時保持 `allow_unsigned=false`。
6. 從 GitHub Release 下載該版本的 `setup.exe`、`blockmap`、`latest.yml` 到 `release/`，執行 `npm.cmd run verify:update`。
7. 執行 `npm.cmd run publish:update:github`；腳本只更新目前版本與 `latest.yml`，不刪除歷史版本。
8. 回讀 GitHub Release、公開 `latest.yml` 與三個資產，再從 Release 安裝檔升級桌面 App。
9. 在安裝版設定頁核對版本與更新結果，並以滑鼠完成核心流程 smoke test。

## 4. 失敗與回復原則

- CI 或 Release 任一門檻失敗時不得建立或覆寫公開更新來源。
- 不以舊的 `release/` 檔案補上失敗的 build；產物必須由同一 tag 重新建立。
- 發現錯版時先停止發布並保留證據，不刪除 tag、Release 或歷史更新資產；另建修正版號。
- 更新站與 GitHub Release 必須使用同一組三項產物，避免 `latest.yml` 的 SHA-512 與實際下載檔不一致。
