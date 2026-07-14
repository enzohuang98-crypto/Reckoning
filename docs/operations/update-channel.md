# 自動更新通道

公開更新目錄位於 `enzohuang98-crypto/xiangqi-analyzer-site` 的 `downloads/`：

```text
https://raw.githubusercontent.com/enzohuang98-crypto/xiangqi-analyzer-site/main/downloads/
```

本文件只說明更新通道的角色；唯一權威發布順序請依照[發布架構與操作手冊](release.md)。不得先把本機候選產物推到網站，再補 commit、tag 或 GitHub Release。

## 發布來源與順序

1. `main` 的 commit 通過 CI，建立並推送與 `package.json` 一致的 annotated `vX.Y.Z` tag。
2. Release workflow 從該 tag 重建、驗證並發布 GitHub Release。
3. 從 GitHub Release 下載同一組 `setup.exe`、`.blockmap`、`latest.yml` 回到 `release/`，執行 `npm.cmd run verify:update`。
4. 只有回讀驗證成功後，才執行 `npm.cmd run publish:update:github`。
5. 回讀公開 `latest.yml` 與三個網站檔案，再使用剛下載的 Release 安裝檔升級桌面 App。

`dist:update:github` 會把固定 HTTPS URL 寫入安裝版；`publish:update:github` 只發布目前版本的三個更新檔並保留歷史版本。已安裝帶更新設定的版本後，使用者可在設定頁檢查更新。

## 必要限制

- 每次發行都必須升版號；相同版本不會觸發更新。
- `latest.yml` 的版本、檔名、大小與 SHA-512 必須和安裝檔一致。
- 更新網站使用 Git repository，安裝檔必須嚴格小於 100 MiB；驗證與發布腳本會拒絕超限檔案。v0.3.x 已接近此上限，下一個大型版本應先遷移到 GitHub Release asset、Cloudflare R2 或 S3 等二進位儲存。
- 正式公開版應使用受信任 CA 的 Windows 程式碼簽章；明確允許的未簽章過渡版仍可能觸發 SmartScreen。
