# 象棋 AI 分析講解

Windows 桌面象棋分析工具，結合 UCCI 相容象棋引擎與大型語言模型，將引擎主線整理成可讀的繁體中文教練解說。

## 目前功能

- 棋盤走子、FEN 與 PlayOK WXF 棋譜匯入
- Pikafish 等 UCCI 引擎的持續分析與候選著比較
- 「實戰步與 AI 首選」五段式教練解說
- Gemini 與 Anthropic API Provider
- Windows 本機加密保存 API Key
- 本機授權驗證與 Windows 安裝／更新包

## 開發環境

- Windows 10 或 11
- Node.js 22
- npm
- 內附 Pikafish 所需的 AVX2 引擎與 NNUE 權重；也可自行選擇其他 UCI／UCCI 引擎

```powershell
npm.cmd ci
npm.cmd run dev
```

常用驗證指令：

```powershell
npm.cmd run typecheck
npm.cmd test
npm.cmd run security:audit
npm.cmd run build
```

建立 Windows 解壓即用版本：

```powershell
npm.cmd run pack
```

## GitHub 與桌機同步

GitHub Release 是桌機版本的唯一正式來源。開發者不得直接修改已安裝目錄；所有變更先經分支、Pull Request 與版本標籤，再由 GitHub Actions 建置 Release。已安裝 App 會在啟動後檢查並自動下載新版本，於使用者正常關閉 App 後安裝。未啟動 App、離線或無法連線 GitHub 時，更新會延後到下次可連線啟動。

## API Key 與隱私

API Key 由 Electron `safeStorage` 加密後保存在使用者的本機 App Data，不寫入專案檔案，也不應提交到 GitHub。請勿在 issue、紀錄或螢幕截圖中貼出真實 Key。

## 象棋引擎授權

本倉庫在 `resources/engine/` 收錄免費的 Pikafish 2026-01-31 Windows 引擎與 NNUE 權重，供本非營利 App 使用。Pikafish 引擎程式採 GPL v3，權重另受目錄內的權重授權協議約束；原始碼來源、作者、授權與更新說明均保留在同一目錄。其他用途請先閱讀這些條款與[官方 Pikafish 專案](https://github.com/official-pikafish/Pikafish)。

本倉庫根目錄的 MIT License 只涵蓋本專案自行開發的程式碼，不取代外部引擎、權重、第三方套件或匯入棋譜資料的授權。

## 專案結構

- `src/main/`：Electron 主程序、引擎、AI Provider、安全儲存
- `src/renderer/`：React 使用者介面
- `src/shared/`：IPC 型別與共用象棋邏輯
- `tests/`：單元、整合、架構、安全與引擎端對端測試
- `tools/`：驗收、授權與發行工具
- `docs/`：設計與發行文件

問題回報與提交方式請見 [CONTRIBUTING.md](CONTRIBUTING.md)，安全問題請見 [SECURITY.md](SECURITY.md)。
