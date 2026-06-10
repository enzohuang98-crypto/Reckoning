# CLAUDE.md — 象棋 AI 分析講解軟體 (xiangqi-analyzer)

本檔說明整體架構與開發規則，供後續以 Claude Code 接續開發時參考。

## 一句話定位

本機桌面應用：以 **本機象棋引擎**（Pikafish 等 UCI 引擎，或象棋小蟲/旋風/名手/烏雲等 UCCI 引擎）做棋力判斷，再由 **LLM 把結構化引擎資料翻譯成人類能懂的講解**。引擎是事實來源，AI 只負責解釋。

## 技術棧

- Electron + React + TypeScript + Vite（以 `electron-vite` 建置）
- 本機資料：`localStorage`（一般設定、錯題本）
- 機密資料：Electron `safeStorage`（API 金鑰，加密落地，永不明文）
- 目標平台：Windows 10/11 64-bit

## 啟動指令

```bash
npm install      # 安裝相依套件
npm run dev      # 開發模式（electron-vite dev）
npm run build    # 型別檢查 + 打包（electron-vite build）
npm run typecheck# 只跑 tsc 型別檢查（node + web 兩個 project）
```

> 注意：本機若 `node` 不在 PATH，請先把 `C:\Program Files\nodejs` 加入 PATH。

## 目錄結構與職責

```
src/
  main/                      # Electron 主行程（Node 環境）
    index.ts                 #   進入點：建視窗、註冊 IPC
    engine/
      PikafishAdapter.ts     #   以子行程驅動引擎；UCI/UCCI 自動偵測；找不到二進位會回報不可用
      EngineOutputParser.ts  #   解析 UCI/UCCI info/bestmove 行（純函式）
    ai/
      AIProvider.ts          #   Provider 工廠（依 id 建實例）
      promptBuilder.ts       #   由引擎資料組 prompt（內含護欄規則）
      cost.ts                #   依 model_pricing.json 估算成本
      providers/
        AnthropicProvider.ts #   完整實作（@anthropic-ai/sdk）
        OpenAIProvider.ts    #   stub
        GeminiProvider.ts    #   stub
    storage/
      StorageService.ts      #   一般 JSON 檔讀寫（userData）
      SecretStore.ts         #   safeStorage 加密金鑰，獨立檔 secrets.enc.json
      AnalysisSessionStore.ts#   分析工作階段持久化
    ipc/
      engineAnalysisHandlers.ts   # engine:* 通道
      aiExplanationHandlers.ts     # ai:* 與 secret:* 通道
  preload/
    index.ts                 # contextBridge 暴露型別安全的 window.api
  renderer/                  # React UI（瀏覽器環境，無 Node 權限）
    index.html
    src/
      App.tsx                # 三分頁：分析 / 設定 / 錯題本；首啟動改顯示 SetupWizard
      components/            # BoardEditor / FenInput / XiangqiBoard / AnalysisPanel / GuessModePanel
      pages/                 # SettingsPage / MistakeBookPage / SetupWizard
      logic/pieces.ts        # 棋子字形與調色盤
      storage/localSettings.ts  # localStorage（設定 + 錯題本）
  shared/                    # main 與 renderer 共用（純型別與純邏輯）
    types/                   # 所有核心型別（見下）
    logic/
      fen.ts                 # FEN 解析/序列化
      MoveComparisonService.ts # 錯誤分級 + 信心值
    config/model_pricing.json   # 模型定價（含 lastUpdated / sourceNote）
```

## 核心型別（src/shared/types）

- `BoardState`：棋盤 10x9、輪走方、FEN、回合計數
- `EngineAnalysis` / `EngineScore` / `EngineLine`：引擎輸出；mate 分數透過 `scoreToCentipawns` 正規化為極大值
- `MoveComparisonResult` + `MoveQuality`（Blunder / Mistake / Inaccuracy / OK）
- `AIExplanationRequest` / `AIExplanationResponse`（含 `groundedOnEngineData` 護欄旗標）
- `MistakeBookEntry` / `UserGuess`
- `AIProvider` 介面 + `AIProviderConfig` / `AIProviderId`
- `AppSettings`（一般設定，**不含金鑰**）
- `ipc.ts`：IPC 通道常數與 `window.api` 形狀

## 重要設計原則（務必遵守）

1. **引擎判棋力、AI 只解釋**：`AIExplanationRequest.engineAnalysis` 是唯一事實來源。
   prompt（`promptBuilder.ts`）明確禁止模型發明不在引擎資料中的戰術。
2. **金鑰安全**：API 金鑰只走 `SecretStore`（safeStorage 加密，獨立檔），
   **絕不**寫入 `localStorage` 一般設定；renderer 只能 set/has/delete，永遠讀不回明文。
3. **Pikafish 是本機 UCI 引擎**，不是雲端 API；文件與命名都依此。
4. **錯誤分級用半開區間且支援負分**（mate 正規化後可能為大負值）：
   - Blunder：loss > 300cp
   - Mistake：150 < loss ≤ 300
   - Inaccuracy：50 < loss ≤ 150
   - OK：loss ≤ 50
   confidence 由「離分級邊界的距離」與「是否涉及 mate」決定。
5. **main / renderer 嚴格分離**：`contextIsolation: true`、`nodeIntegration: false`；
   renderer 只透過 `window.api` 與 main 溝通。

## MVP 範圍（已完成）

- Stage 1：CLAUDE.md、全部核心型別、`npm run build` 可通過。
- Stage 2：BoardEditor（手動擺棋）、FenInput（FEN 驗證渲染）、SettingsPage（金鑰安全儲存）、
  10x9 棋盤渲染、Electron IPC main/renderer 分離。
- Stage 3：Pikafish UCI 整合。`PikafishAdapter` 採分段握手
  （`uci`→`uciok`→`setoption MultiPV`+`isready`→`readyok`→`position`+`go`），
  `EngineOutputParser` 解析 multipv/cp/mate（已含單元驗證），`engine:analyze` / `engine:status` IPC，
  AnalysisPanel 顯示候選線。**引擎路徑**可於 SettingsPage 指定（含原生檔案選擇器），
  經 `engine:setPath` 存入 main 的 `StorageService`（`engine-config.json`），啟動時讀回注入 adapter。
  路徑優先序：使用者設定 > `PIKAFISH_PATH` > `resources/engine/pikafish.exe`。
- Stage 4：AI 解釋流程。`AnthropicProvider` 真實呼叫 `@anthropic-ai/sdk`，
  `promptBuilder` 組裝引擎資料（含護欄），`ai:explain` IPC 自 `SecretStore` 取金鑰，
  AnalysisPanel 顯示解說與 token/成本。
- Stage 5：UCCI 引擎支援 + 初始設定嚮導。
  - **UCI/UCCI 雙協定**（`PikafishAdapter`）：握手時自動偵測——先送 `uci` 等 `uciok`，
    2 秒逾時改送 `ucci` 等 `ucciok`；若引擎在偵測期間直接結束行程，以剩餘協定重啟再試。
    偵測結果持久化於 `engine-config.json`（`engineProtocol` 欄位），下次直接以已知協定握手；
    設定頁變更引擎路徑時重置為 null 重新偵測。
  - **UCCI 與 UCI 的差異處理**：`setoption <選項> <值>`（無 name/value 關鍵字）、
    握手後送 `setoption usemillisec true`（否則 `go time` 單位是秒）、
    限時搜尋用 `go time <ms>`（UCCI 無 `go movetime`）、`nobestmove` 表示無著法、
    `info` 行的 `score <n>` 為裸數值（`EngineOutputParser` 兩種格式都解析）。
  - **連線測試**（`engine:test` IPC）：實際啟動引擎完成握手後關閉，
    回傳 `EngineTestResult`（協定 + `id name` 版本名），供設定嚮導「測試引擎」使用。
  - **初始設定嚮導**（`SetupWizard.tsx`）：localStorage `setup_completed` 旗標非 `'1'`
    且引擎路徑與所有 API 金鑰皆未設定時，取代主介面顯示；引擎路徑與金鑰皆可留空跳過。
    完成後寫入旗標，之後不再顯示（升級用戶若已有任一設定，啟動時自動補旗標跳過）。

### 引擎執行前置（使用者需自備）

- Pikafish 為閉源 NNUE 引擎：除 `pikafish.exe` 外，**還需把 `pikafish.nnue` 評估檔放在同目錄**
  （或以 `setoption name EvalFile` 指定）。缺檔時引擎可能無法通過 `isready`。
  本軟體只負責驅動 UCI，不內含二進位與評估檔。

## 尚未完成 / 後續

- 內含或自動下載 Pikafish 二進位與 `pikafish.nnue`（目前需使用者自備並於設定頁指定）。
- OpenAI / Gemini Provider 真實實作。
- 對每個候選著法逐一搜尋以取得精確 loss（目前猜著模式以候選線分數近似）。
- 將判定為錯著的局面一鍵加入錯題本的 UI 流程。
- 走子合法性驗證與棋譜（PGN/UCI move list）匯入。
- electron-builder 打包設定。
