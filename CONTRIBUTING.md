# 貢獻指南

感謝協助改善象棋 AI 分析講解。請讓每個變更保持單一目的、可審查且可驗證。

## 開始之前

1. 搜尋既有 issue，避免重複回報。
2. 功能變更或大型重構先建立 issue，說明使用情境、範圍與相容性風險。
3. 不得提交 API Key、授權私鑰、個人資料、第三方未授權二進位檔或權重。

## 唯一來源與交付流程

- GitHub 倉庫是唯一正式來源；原始碼只在 Git checkout 中修改。
- 不得直接修改 `%LOCALAPPDATA%\Programs\xiangqi-analyzer` 或手動複製建置產物覆蓋已安裝 App。
- 所有可交付變更都必須經分支、commit、push 與 Pull Request。
- 桌機版本只透過 GitHub Release 的 App 自動更新或 Release 安裝程式變更。
- Release 必須由版本標籤觸發 GitHub Actions Release workflow 建置及發布。

## 本機驗證

```powershell
npm.cmd ci
npm.cmd run typecheck
npm.cmd test
npm.cmd run security:audit
npm.cmd run build
```

只修改文件時，可依風險省略與程式無關的測試，但請在 PR 中寫明實際執行項目。

## Pull request

- 標題簡潔說明結果。
- 內文包含問題、解法、驗證方式與仍存在的風險。
- UI 變更附上前後截圖。
- 不混入格式化、產生檔或無關重構。
- 新增行為時，加入最小且直接的測試。
