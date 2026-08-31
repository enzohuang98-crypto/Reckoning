# Reckoning 象棋 AI 分析講解

Reckoning 是 Windows 桌面象棋分析工具：由本機 Pikafish／UCI／UCCI 引擎負責計算局面，再把可查證的引擎證據交給使用者選定的 AI 模型，產生可閱讀、可複製、可繼續追問的繁體中文解說。

核心原則很簡單：**引擎負責棋力判斷，語言模型負責解釋；模型不得取代引擎捏造變化。**

## 功能總覽

### 棋盤與棋譜

- 在互動式中國象棋棋盤上合法走子、擺設局面、指定行棋方。
- 支援復原、重做、重設，以及儲存、載入、刪除常用局面。
- 可直接輸入 FEN，或匯入 PlayOK 的 WXF 棋譜／對局紀錄。
- 棋盤支援鍵盤操作、焦點狀態與輔助技術朗讀。

### 即時局面分析

- 安裝包內附 Pikafish 與 NNUE 權重，也能加入多個外部 UCI／UCCI 象棋引擎。
- 持續顯示 MultiPV 候選著、整數分數、深度、時間、節點數、NPS 與主要變化。
- 紅方、黑方都依「目前行棋方的最佳選擇」由優到劣排列，第一列永遠是引擎目前認為最好的著法。
- 一般評估使用 Pikafish 的整數分數單位；將殺局面保留將殺語義，不以小數兵值混淆顯示。
- 局面切換時保留最近一次有效結果，新的分析資料到達後再平順更新，避免整個分析區短暫空白。
- 可啟用第二套驗證引擎，顯示雙引擎是否出現重要分歧。

### 查看引擎思考

- 在棋盤按右鍵即可開啟引擎思考視窗。
- 可選第一線、第二線、第三線等候選主線，使用小棋盤逐步向前／向後重播。
- 視窗開啟期間主分析不停止；更深的新主線會持續送入，但目前正在查看的走法位置不會被任意跳動打斷。

### 猜著與 AI 深度解說

- 「猜著」只保留真正需要的輸入：你的走法，以及選填的「你選這一步的原因」。
- 提交後直接進入完整研究，不再先顯示多餘的著法分級頁或固定三步驟流程。
- AI 取得實際引擎主線、候選著與局面證據後產生解說；證據不足時必須明說，不能自行補造戰術。
- 解說文字與局面分析內容可以選取、複製及貼上。
- 分析完成後可以繼續追問，對話仍綁定同一份局面與引擎證據。
- 內建有限次數、可追蹤的品質檢查流程，避免模型無限重試或把逾時誤報為引擎證據不足。

### AI Provider 與金鑰

設定頁使用單一 API Key 欄位自動辨識服務，目前支援：

- Anthropic Claude（`sk-ant-...`）
- Google Gemini（`AIza...` 或 Google 授權類型金鑰）
- OpenAI（`sk-...`）
- OpenRouter（`sk-or-v1-...`）

系統會先向官方服務驗證金鑰與目標模型可用性；支援低用量測試的 Provider 也會執行真實生成，成功後才保存該組 **Provider + 完整模型 ID + API Key**。Renderer 不會取得金鑰明文；相容 OpenAI API 的 adapter 保留在核心架構中，但目前簡化後的設定介面只開放上列可自動識別的服務。

## OpenRouter 免費模型

OpenRouter 免費模型不使用寫死的清單。貼上 `sk-or-v1-...` 金鑰後，Reckoning 會：

1. 向 OpenRouter 的 `/api/v1/key` 驗證目前金鑰。
2. 從官方 `/api/v1/models` 即時取得模型目錄。
3. 只列出當下仍存在、可輸出文字、官方模型 ID 以 `:free` 結尾且輸入／輸出價格為零的具體模型。
4. 讓使用者看到並選擇完整模型 ID，例如 `provider/model-name:free`。
5. 使用所選 ID 做真實測試，成功後才綁定並保存。

每次請求只傳送一個使用者選定的 `model`，不傳 fallback `models` 陣列，也不使用會隨機挑選模型的 `openrouter/free` 或可能轉向付費模型的自動路由。回應若回報不同模型 ID，程式會拒絕該結果，而不是把「畫面顯示 A、後端實際使用 B」當成成功。

免費模型與供應狀態會變動；若已選模型不再出現在即時免費清單，Reckoning 會要求重新選擇，不會暗中換成另一個模型。實作依據與驗證紀錄見 [OpenRouter 免費模型整合研究](docs/research/openrouter-free-models-integration.md)。

## 基本使用流程

1. 在「設定 → 本機引擎」確認內附 Pikafish，或加入自己的 UCI／UCCI 引擎。
2. 在「設定 → AI 與金鑰」貼上 API Key；OpenRouter 使用者再從即時免費清單選擇一個具體模型。
3. 回到「分析」，擺設局面、輸入 FEN 或匯入 PlayOK 棋譜。
4. 查看持續更新的候選著；需要時以右鍵開啟小棋盤重播引擎主線。
5. 開啟「猜著」，輸入你的走法與思考，直接提交完整 AI 深度解說。

本機引擎分析不需要 AI API；AI 解說、金鑰驗證、OpenRouter 模型清單與更新檢查需要網路。

## 架構

Reckoning 採 Electron 的權限分層。使用者介面不能直接讀取 Node.js、檔案系統、API Key 或啟動引擎；所有高權限操作都必須通過具型別的 preload bridge 與主程序 IPC 驗證。

```text
┌──────────────────────────────────────────────────────┐
│ Renderer：React 棋盤、即時分析、PV 重播、猜著、設定 │
└───────────────────────┬──────────────────────────────┘
                        │ 具型別、白名單 IPC
┌───────────────────────▼──────────────────────────────┐
│ Preload：contextBridge，僅公開必要能力               │
└───────────────────────┬──────────────────────────────┘
                        │ 驗證後的請求與事件
┌───────────────────────▼──────────────────────────────┐
│ Electron Main                                        │
│  ├─ Analysis Session：以 analysisId 保存可信分析     │
│  ├─ Engine：Pikafish／UCI／UCCI、取消、MultiPV       │
│  ├─ AI：Prompt、Provider adapter、逾時與回應驗證     │
│  ├─ Storage：設定、局面、備份、SecretStore           │
│  └─ Update／Security：更新策略、輸入與網路邊界       │
└──────────────┬───────────────────────┬───────────────┘
               │                       │
       本機引擎子程序             使用者選定的 AI API
```

幾個不能被破壞的邊界：

- Renderer 只傳 `analysisId` 與使用者輸入；不能自行組造一份引擎分析再交給 AI。
- API Key 只在主程序解密與使用，不經 IPC 回傳明文。
- Provider adapter 只連到該 Provider 的固定官方端點；Provider、模型與金鑰必須成套保存與取用。
- 引擎原始輸出先解析成共用型別，排序、視角、將殺與分數顯示再由共享邏輯統一處理。
- 新的分析或 AI 請求都有獨立識別與取消機制，避免舊回應覆蓋新局面。

## 本機資料、隱私與安全

- API Key 由 Electron `safeStorage` 使用 Windows 系統能力加密後保存在使用者 App Data，不寫入專案或一般設定 JSON。
- 一般設定、儲存局面、分析工作資料與備份以本機資料為主；匯入資料會先經格式與大小驗證。
- AI 解說會把完成任務所需的局面、引擎證據與使用者文字送到所選 Provider；各 Provider 的保存與隱私政策仍由該服務商決定。
- 日誌與錯誤訊息會遮蔽金鑰；請仍避免把真實 Key 貼到 GitHub issue、測試資料、螢幕截圖或聊天紀錄。
- Electron 啟用 context isolation、sandbox、CSP 與封裝完整性相關限制；依賴套件另有安全稽核指令。

安全政策與私下通報方式請見 [SECURITY.md](SECURITY.md)。

## 自動更新

Windows 安裝版以本專案的 GitHub Releases 作為唯一更新來源：

- 啟動後自動檢查，執行期間也會定期重新檢查。
- 發現新版時顯示「立即更新」「稍後提醒我」「跳過此版本」。
- 選擇立即更新後在背景下載；完成時程式自動關閉、安裝並重新開啟，不需要使用者再手動尋找安裝檔。
- 手動檢查與更新入口仍保留在設定頁。
- `latest.yml`、NSIS 安裝檔與 blockmap 必須屬於同一個版本，否則不應發布。

更完整的通道規則見 [自動更新文件](docs/operations/update-channel.md)。只有 GitHub Release 中通過檢查的正式資產才代表可交付版本；原始碼分支上的功能不等於已安裝版本已更新。

## 開發

### 環境需求

- Windows 10 或 Windows 11
- Node.js 22
- npm
- 若要產生正式 Windows 安裝檔，需要專案要求的程式碼簽章憑證

安裝依賴並啟動開發版：

```powershell
npm.cmd ci
npm.cmd run dev
```

主要品質檢查：

```powershell
npm.cmd run typecheck
npm.cmd test
npm.cmd run security:audit
npm.cmd run build
```

測試範圍包含象棋規則、分數與排序、PV 重播、Provider／模型綁定、金鑰儲存、IPC 架構、安全邊界、PlayOK 匯入、更新流程、雙引擎、AI 品質 Harness 與引擎端對端行為。

建立未安裝的 Windows 測試目錄：

```powershell
npm.cmd run pack
```

建立正式安裝與更新資產：

```powershell
npm.cmd run dist:update
npm.cmd run verify:update
```

`electron-builder.yml` 對正式產物啟用 `forceCodeSigning`；缺少簽章設定時，正式打包失敗是預期的安全閘門，不應為了方便而關閉。

## 專案目錄

- `src/main/`：Electron 主程序、引擎程序、AI Provider、IPC、安全儲存與更新。
- `src/preload/`：受限的 renderer bridge。
- `src/renderer/`：React 棋盤、分析工作區、PV 重播、猜著與設定介面。
- `src/shared/`：跨程序共用型別、象棋規則、分數、驗證與資料契約。
- `resources/engine/`：隨安裝包提供的 Pikafish 執行檔、NNUE 權重與各自授權。
- `tests/`：單元、整合、架構、安全與端對端測試。
- `tools/`：驗收、安全稽核、簽章、安裝與發行工具。
- `docs/`：架構、操作、研究、驗收與發行文件。

## 授權

本倉庫自行開發的程式碼採 [MIT License](LICENSE)。MIT License 不涵蓋外部引擎、權重、第三方套件或匯入資料。

`resources/engine/` 收錄 Pikafish 2026-01-31 Windows 引擎與 NNUE 權重。Pikafish 程式採 GPL v3，權重另受該目錄中的權重授權協議約束；來源、作者與更新說明均保留在同一目錄。其他用途請先閱讀這些條款與 [Pikafish 官方專案](https://github.com/official-pikafish/Pikafish)。

## 參與專案

- 架構說明：[docs/architecture/overview.md](docs/architecture/overview.md)
- 更新通道：[docs/operations/update-channel.md](docs/operations/update-channel.md)
- 發行流程：[docs/operations/release.md](docs/operations/release.md)
- 提交與問題回報：[CONTRIBUTING.md](CONTRIBUTING.md)
- 安全通報：[SECURITY.md](SECURITY.md)

提交功能前請至少完成 typecheck、完整測試與安全稽核；涉及安裝包或自動更新時，還必須驗證版本、簽章、更新中繼資料與 Release 資產一致。
