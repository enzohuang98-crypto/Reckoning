# 自動更新通道

Windows 安裝版直接從 `enzohuang98-crypto/Reckoning` 的 GitHub Releases 取得更新：

```text
https://github.com/enzohuang98-crypto/Reckoning/releases
```

GitHub Release 是安裝下載與自動更新的同一個權威來源，不再把大型安裝檔提交到另一個 Git repository。每個版本的 Release 必須同時包含：

- `xiangqi-analyzer-X.Y.Z-setup.exe`
- `xiangqi-analyzer-X.Y.Z-setup.exe.blockmap`
- `latest.yml`

## 發布來源與順序

1. `main` 的 commit 通過 CI，建立並推送與 `package.json` 一致的 annotated `vX.Y.Z` tag。
2. Release workflow 從該 tag 重建、驗證並建立 GitHub Release。
3. 從 GitHub Release 下載同一組三項資產，執行 `npm.cmd run verify:update`。
4. 使用剛下載的 Release 安裝檔進行全新安裝或升級驗證。

`dist:update:github` 會把固定的 GitHub owner/repository 寫入安裝版。`publish:update:github` 只供既有 Release 的人工修復流程使用，會重新驗證本機產物後，以 `gh release upload --clobber` 更新該版本的三項資產。

## 必要限制

- 每次發行都必須升版號；相同版本不會觸發更新。
- `latest.yml` 的版本、檔名、大小與 SHA-512 必須和安裝檔一致。
- 單一 GitHub Release asset 必須小於 2 GiB；驗證腳本會拒絕超限檔案。
- 正式公開版應使用受信任 CA 的 Windows 程式碼簽章；明確允許的未簽章過渡版仍可能觸發 SmartScreen。
