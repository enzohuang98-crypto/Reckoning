# 自動更新發佈

一般 `npm run dist` 會建立可安裝版本，但不會寫入更新伺服器，適合本機測試。

老師測試通道使用公開網站 repo `enzohuang98-crypto/xiangqi-analyzer-site` 的 `downloads/`
資料夾當固定 HTTPS 更新目錄：

```text
https://raw.githubusercontent.com/enzohuang98-crypto/xiangqi-analyzer-site/main/downloads/
```

每次要發自動更新：

```powershell
npm version patch --no-git-tag-version
npm run dist:update:github
npm run publish:update:github
git add package.json package-lock.json docs/operations/update-channel.md tools/release
git commit -m "chore: release x.y.z"
git tag vx.y.z
git push origin main vx.y.z
```

`dist:update:github` 會把上面的公開更新 URL 寫進安裝版。
`publish:update:github` 會把 `release` 內目前版本的安裝檔、`.blockmap` 與 `latest.yml`
發到網站 repo 的 `downloads/` 資料夾。已安裝「帶自動更新設定」版本的使用者，
開啟 APP 後即可在設定頁檢查更新。

注意：

- 第一次必須手動安裝一版帶更新設定的安裝檔。
- 每次發版都必須升版號，否則 APP 不會判定有更新。
- 更新檔未上傳完整時，APP 會顯示更新失敗。
- GitHub 對單檔 100 MB 有硬性限制；目前安裝檔約 80 MB，MVP 可用。正式商用建議改用
  Cloudflare R2、S3 或 GitHub Release asset。
