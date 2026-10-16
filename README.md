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

### 查看引擎思考

- 在棋盤按右鍵即可開啟引擎思考視窗。
- 可選第一線、第二線、第三線等候選主線，使用小棋盤逐步向前／向後重播。
- 視窗開啟期間主分析不停止；更深的新主線會持續送入，但目前正在查看的走法位置不會被任意跳動打斷。

### 猜著與 AI 深度解說

- 「猜著」只保留真正需要的輸入：你的走法，以及選填的「你選這一步的原因」。
- 提交後直接進入完整研究，不再先顯示多餘的著法分級頁或固定三步驟流程。
- 程式先重播引擎主線，算出每一手的吃子、將軍、新威脅與將死／困斃（事實表），AI 只負責用白話講解這些事實；證據不足時必須明說，不能自行補造戰術。
- 解說文字與局面分析內容可以選取、複製及貼上。
- 引擎結果一出現就可以直接提問；對話仍綁定同一份局面與引擎證據。
- 回答會逐字串流顯示；程式只檢查客觀錯誤（不存在的著法、與事實表矛盾的吃子／將軍等），有錯就請模型修正一次。仍不通過時改給「引擎重點摘要（非 AI 生成）」並說明原因，可一鍵重試 AI。
- 每次解說最多 3 次模型呼叫、110 秒內一定有結果或可操作的錯誤卡。OpenRouter 免費模型可另設最多 2 個備援，改用備援時介面會標示「由 X 回答」。

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

每次請求只傳送一個明確的 `model`，不傳 fallback `models` 陣列，也不使用會隨機挑選模型的 `openrouter/free` 或可能轉向付費模型的自動路由。回應回報的模型若不是同一個模型（只容許 `:free` 這類變體後綴不同），程式會拒絕該結果，而不是把「畫面顯示 A、後端實際使用 B」當成成功。

推理（thinking）依每個模型在 `/models` 公布的能力設定：能關閉就關閉、必須推理的模型則排除推理文字並加大輸出預算；回答以串流即時顯示。

可在「設定 → AI 與金鑰」另外核可最多 2 個 `:free` 備援模型（必須出現在這把金鑰當下的免費清單中）。只有主模型逾時、過載、分鐘級限流、暫時無法使用或回應格式錯誤時才會改用備援，畫面會標示「由 X 回答（Y 暫時無法使用：原因）」；連線中斷時會先重試一次，仍連不上就照同樣流程改用備援或改給引擎重點摘要；每日免費額度用完或金鑰錯誤則直接顯示錯誤卡，不會改用備援。

免費模型與供應狀態會變動；若已選模型不再出現在即時免費清單，Reckoning 會要求重新選擇，不會在使用者未核可的情況下換成其他模型。實作依據與驗證紀錄見 [OpenRouter 免費模型整合研究](docs/research/openrouter-free-models-integration.md)。

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
│  ├─ AI：事實表、Prompt、答案檢查、Provider adapter   │
│  ├─ Storage：設定、局面、備份、SecretStore           │
│  └─ Update／Security：更新策略、輸入與網路邊界       │
└──────────────┬───────────────────────┬───────────────┘
               │                       │
       本機引擎子程序             使用者選定的 AI API
```

幾個不能被破壞的邊界：

- Renderer 只傳 `analysisId` 與使用者輸入；不能自行組造一份引擎分析再交給 AI。
- 吃子、將軍、威脅、將死與困斃由程式重播引擎主線計算，AI 只能引用這份事實表；回答再由程式檢查是否提到不存在的著法或與事實矛盾。
- API Key 只在主程序解密與使用，不經 IPC 回傳明文。
- Provider adapter 只連到該 Provider 的固定官方端點；Provider、模型與金鑰必須成套保存與取用。
- 引擎原始輸出先解析成共用型別，排序、視角、將殺與分數顯示再由共享邏輯統一處理。
- 新的分析或 AI 請求都有獨立識別與取消機制，避免舊回應覆蓋新局面。

## 本機資料、隱私與安全

- API Key 由 Electron `safeStorage` 使用 Windows 系統能力加密後保存在使用者 App Data，不寫入專案或一般設定 JSON。
- 一般設定、儲存局面、分析工作資料與備份以本機資料為主；匯入資料會先經格式與大小驗證。
- AI 解說會把完成任務所需的局面、引擎證據與使用者文字送到所選 Provider；各 Provider 的保存與隱私政策仍由該服務商決定。
- 日誌與錯誤訊息會遮蔽金鑰；請仍避免把真實 Key 貼到 GitHub issue、測試資料、螢幕截圖或聊天紀錄。
- 每次 AI 解說會在本機保存一筆有上限的診斷紀錄（不含金鑰）；可在「設定 → 資料與系統」匯出或清除，回報問題時可附上匯出檔。
- Electron 啟用 context isolation、sandbox、CSP 與封裝完整性相關限制；依賴套件另有安全稽核指令。

安全政策與私下通報方式請見 [SECURITY.md](SECURITY.md)。

## 自動更新

Windows 安裝版以本專案的 GitHub Releases 作為唯一更新來源：

- 啟動後自動檢查，執行期間每 4 小時重新檢查。
- 發現新版時顯示「立即背景準備」「稍後提醒我」「跳過此版本」；稍後提醒會在 4 小時後再問。
- 更新在背景下載，期間可繼續使用；準備完成後**不會自動關閉或安裝**，由使用者明確選擇重新啟動，且會先保存目前資料（有未提交的著法草稿時會先提醒）。
- 可在設定頁關閉背景準備；手動檢查與更新入口也保留在設定頁。
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
npm.cmd run typecheck      # 主程序、renderer 與測試檔
npm.cmd test
npm.cmd run security:audit
npm.cmd run build
```

測試範圍包含象棋規則、分數與排序、PV 重播、Provider／模型綁定、金鑰儲存、IPC 架構與來源驗證、安全邊界、PlayOK 匯入、更新流程、設定遷移、解說事實表與答案檢查、v2 解說管線與引擎端對端行為。`npm test` 依 `tests/test-manifest.json` 逐一執行並在最後列出所有失敗；`npm.cmd test -- --only <路徑片段>` 只跑部分測試。部分測試（安全基線、引擎登錄、引擎端對端、`safeStorage`、Electron 更新測試）只能在 Windows 執行，其他平台可用 `--portable` 略過。

### AI 解說的開發與驗收

- 預設使用 v2 解說流程（`src/main/ai/explain/`）。設定環境變數 `XQA_EXPLAIN_PIPELINE=v1` 可整體退回舊版流程，僅供比較與回滾。
- 真實模型驗收需要自己的 OpenRouter 金鑰，金鑰只從環境變數讀取，輸出寫到已被 git 忽略的 `.local-review/`：

  ```powershell
  $env:OPENROUTER_API_KEY="（你的金鑰）"
  npx.cmd tsx --tsconfig tsconfig.node.json tools/acceptance/explain-v2-live.ts --models <模型>:free --out v2-review.md
  Remove-Item Env:OPENROUTER_API_KEY
  ```

  預設只允許 `:free` 模型；加 `--allow-paid` 才能測付費模型（費用記在 OpenRouter 帳戶）。付費輪只看解說品質，不能代表免費模型的交付率。報表的「呼叫紀錄」會列出每次呼叫的秒數與失敗分類，連線失敗附底層代碼。

- 匯出的診斷紀錄可用 `tools/acceptance/summarize-traces.ts` 統計失敗類別（不輸出回答原文或局面）。
- 進行中的改善計畫與上線門檻見 [AI 對話可靠性計畫](docs/plans/ai-chat-reliability-v2.md)。

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
- `docs/`：架構（`architecture/`）、操作與發行（`operations/`、`releases/`）、計畫（`plans/`）與研究；`history/` 與 `archive/` 只保存歷史紀錄。

## 授權

本倉庫自行開發的程式碼採 [MIT License](LICENSE)。MIT License 不涵蓋外部引擎、權重、第三方套件或匯入資料。

`resources/engine/` 收錄 Pikafish 2026-01-31 Windows 引擎與 NNUE 權重。Pikafish 程式採 GPL v3，權重另受該目錄中的權重授權協議約束；來源、作者與更新說明均保留在同一目錄。其他用途請先閱讀這些條款與 [Pikafish 官方專案](https://github.com/official-pikafish/Pikafish)。

## 參與專案

- 架構說明：[docs/architecture/overview.md](docs/architecture/overview.md)
- 開發規則與目錄職責：[CLAUDE.md](CLAUDE.md)；專案現況：[PROJECT_STATUS.md](PROJECT_STATUS.md)
- 更新通道：[docs/operations/update-channel.md](docs/operations/update-channel.md)
- 發行流程：[docs/operations/release.md](docs/operations/release.md)
- 提交與問題回報：[CONTRIBUTING.md](CONTRIBUTING.md)
- 安全通報：[SECURITY.md](SECURITY.md)

提交功能前請至少完成 typecheck、完整測試與安全稽核；涉及安裝包或自動更新時，還必須驗證版本、簽章、更新中繼資料與 Release 資產一致。
