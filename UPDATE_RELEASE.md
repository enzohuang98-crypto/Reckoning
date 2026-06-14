# 自動更新發佈

一般 `npm run dist` 會建立可安裝版本，但不會寫入更新伺服器，適合本機測試。

正式發佈時，先把安裝檔與 `latest.yml` 放在同一個 HTTPS 目錄，再以該目錄建置：

```powershell
$env:XQA_UPDATE_URL = 'https://updates.example.com/xiangqi-analyzer/'
npm run dist:update
```

`XQA_UPDATE_URL` 只接受不含帳密、使用標準 443 連接埠的 HTTPS 網址。建置完成後，將
`release` 內的安裝檔、`.blockmap` 與 `latest.yml` 上傳到該目錄。
