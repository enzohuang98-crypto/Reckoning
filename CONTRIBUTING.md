# 貢獻指南

感謝協助改善象棋 AI 分析講解。請讓每個變更保持單一目的、可審查且可驗證。

## 開始之前

1. 搜尋既有 issue，避免重複回報。
2. 功能變更或大型重構先建立 issue，說明使用情境、範圍與相容性風險。
3. 不得提交 API Key、授權私鑰、個人資料、第三方未授權二進位檔或權重。

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
