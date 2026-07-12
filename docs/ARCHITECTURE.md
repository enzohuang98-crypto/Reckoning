# 象棋 AI 分析講解：產品架構

本文件是目前程式架構的主要依據。目標是讓功能可獨立維護、測試與替換，並避免畫面、IPC、引擎與 AI 流程互相滲透。

## 1. 行程與信任邊界

```text
renderer (React, 無 Node 權限)
        │ typed window.api
        ▼
preload (唯一 IPC bridge)
        │ validated IPC
        ▼
main (Electron / Node)
  ├─ engine      本機 UCI / UCCI 引擎
  ├─ ai          Provider 與 Harness loop
  ├─ storage     一般資料、分析 session、加密金鑰
  ├─ security    IPC、瀏覽器與輸入驗證
  └─ update      自動更新

shared
  ├─ types       main、preload、renderer 共用契約
  ├─ logic       不依賴 Electron / React 的純邏輯
  └─ config      模型與產品設定目錄
```

規則：

- 引擎資料是棋力判斷的唯一事實來源；LLM 只能解釋。
- API Key 只存在 main process，透過 `safeStorage` 加密；renderer 永遠讀不到明文。
- renderer 不可直接 import `electron`、`node:*` 或 main process 實作。
- IPC payload 必須在 main 端驗證，不能信任 renderer 傳入的物件。
- `shared/logic` 必須維持純函式，不能讀寫檔案、DOM 或 Electron 狀態。

## 2. Renderer 模組

```text
src/renderer/src/
  app/
    AppShell.tsx             固定品牌列、主導覽、全域儲存錯誤
    StartupScreen.tsx        啟動進度與長時間等待提示
  features/
    app-data/                AppData 載入、遷移、排隊儲存
    board/                   棋盤 timeline、悔棋、下一步、還原
    workspace/               分析工作區的功能組裝
    analysis/                即時引擎、AI 教練、猜著、資料檢視
    settings/                分類式設定 UI 與各領域 section
  components/
    ui/                      無業務狀態的共用元件與 SVG icon
    *.tsx                    棋盤與既有領域元件
  pages/                     頂層頁面控制器
  storage/                   renderer 一般設定（不得放 API Key）
  styles/                    依責任拆分的全域樣式
  utils/                     renderer 純工具
```

### 元件責任

- `App.tsx`：只組裝頂層頁面、設定、資料 store 與棋盤工作階段。
- `AnalysisWorkspace.tsx`：管理右側檢視選擇與猜著互動，不執行 IPC 驗證。
- `AnalysisPanel.tsx`：分析與 AI IPC 的 controller；純顯示放到 `features/analysis`。
- `SettingsPage.tsx`：設定 IPC controller；各分類畫面放到 `features/settings`。
- `styles/*.css`：一個 selector 應只有一個主要定義；響應式覆蓋只放 `responsive.css`。

## 3. UI 資訊架構

主畫面採 Task-first App Shell：

```text
App Header
  分析 | 錯題本 | 待理解 | 設定

Analysis Command Bar
  局面工具 ▾ | 悔棋 | 下一步 | 重新分析 | 停止 | AI 解說 | 猜著模式

Workspace
  ├─ 左：棋盤、擺棋抽屜、匯入抽屜
  └─ 右：即時分析 | AI 教練 | 猜著 | 資料
```

- 引擎監聽與 AI 生成不因切換右側檢視或頂層頁面而卸載。
- 常用動作直接顯示；低頻局面功能放在「局面工具」選單。
- 原始輸出、複核引擎與收藏工具集中在「資料」。
- 設定依用途分成 AI、本機引擎、解說品質、資料與系統四類。

## 4. 資料流

```text
BoardState change
  → automatic engine request
  → progress events (live view)
  → EngineAnalysis session stored in main
  → renderer receives analysisId
  → AI Harness reads session by analysisId
  → quality loop validates and rewrites failed sections
  → conversation / feedback saved to AppData
```

持久化：

- `AppDataSnapshot`：main process JSON，原子寫入、大小限制、匯入清洗。
- 一般 UI 設定：renderer localStorage，經 `normalizeSettings` 正規化。
- API Key：`SecretStore` + OS `safeStorage`，與一般資料完全分離。
- 引擎登錄：main process JSON，只允許本機絕對路徑。
- Harness trace：本機限量保存，可匯出成 regression case。
- 產品階段旗標：集中於 `app/productFlags.ts`；公開商業發行不得保留測試授權旁路。

## 5. AI 解說 Loop 與本機知識

正常解說不是單次 prompt，而是固定上限的品質迴圈：

```text
deterministic plan
  → engine evidence packet
  → consequence audit
  → structured writer
  → deterministic validation + causal-chain score
  → diagnose failed sections
  → rewrite failed sections only (最多固定輪數)
  → validated answer 或 evidence-based fallback
```

- 一般成功路徑只需要「後果審查 + 寫作」兩次模型呼叫；規劃、證據關聯、術語檢查與品質評分都在本機完成。
- 每個核心主張必須引用 `evidenceIds`，並連到已驗證的 `findingIds`；空泛標籤、唯分數理由、虛構主線與不完整因果鏈都不得通過。
- 暫時性 429 / 5xx / timeout 只自動重試一次；模型呼叫與引擎加深都有固定預算，不能形成無限 loop。
- `xiangqiKnowledge.ts` 是可檢索的結構化本機知識庫；只把與局面相關的小段放進 prompt。它協助低階模型理解術語，但永遠不能冒充本局引擎證據。
- 穩定術語參考來源包括中國象棋協會 2020 規則術語、世界象棋聯合會入門與記譜資料，以及公開術語分類。知識定義均重新整理，不逐字複製來源。

## 6. 雙引擎裁決

- 主引擎與複核引擎平行分析；任何一邊的即時深度、分數、NPS 與主線都帶有 engine role，UI 不得混成同一條紀錄。
- 分數單位是「兵」，分差門檻不得誤用 centipawn；兩個引擎分數永遠分開保存，不取平均。
- 當最佳著、優劣方向或正式分數出現顯著分歧時，`DualEngineComparison` 建立兩條候選線與逐手盤面事實。
- Harness 必須讓兩個引擎交叉分析彼此候選，並要求外接 AI 比較：強迫程度、分支與容錯、走歪／失控風險、王區、子力活動、陣形、部署與長期發展。
- 裁決必須同時引用兩個引擎；證據不足時只能回覆「暫時無法判定」與缺少的分析，不得靠較高分數硬選。
- 複核引擎失敗時保留主引擎結果並顯示降級警告，不讓整個分析請求失敗。

## 7. 外接 AI 相容層

- 官方 adapter：Anthropic、OpenAI、Gemini。
- `openai-compatible` adapter：DeepSeek、Kimi / Moonshot、xAI、Ollama、LM Studio 與使用者自訂 Chat Completions 相容服務。
- 遠端 Base URL 只允許標準 HTTPS；HTTP 只允許 `localhost`、`127.0.0.1`、`::1`。禁止帳密、query 與 fragment，避免憑證外洩與明顯 SSRF。
- 本機 loopback 服務可免 API Key；遠端服務必須使用單一加密 Key 欄位。renderer 不得取得解密後金鑰。
- OpenAI 相容服務的加密 Key 會綁定使用者儲存時確認的 Base URL；網址變更後必須重新確認並儲存，避免 renderer 遭入侵時把既有 Key 轉送到其他端點。
- Provider JSON 回應採串流讀取並設 5 MB 上限；錯誤文字會遮蔽官方格式與本次請求的精確 Key，避免惡意或故障端點造成記憶體耗盡或日誌洩漏。
- 相容服務的 model ID 允許使用受限制字元的自訂值；設定頁預設值只提供方便，不形成永久白名單。

官方相容契約參考：

- DeepSeek: <https://api-docs.deepseek.com/>
- Kimi: <https://platform.kimi.ai/docs/api/overview>
- xAI: <https://docs.x.ai/developers/rest-api-reference/inference>
- Ollama: <https://docs.ollama.com/api/openai-compatibility>
- LM Studio: <https://lmstudio.ai/docs/developer/openai-compat>

## 8. 新增功能的放置規則

1. 先判斷它屬於 app shell、feature、page、shared logic 或 main service。
2. UI 不得直接重做既有 IPC 或資料正規化邏輯。
3. 單一畫面超過約 300 行時，優先抽出純顯示 section；不要先建立全域 context。
4. 跨行程資料先定義 shared type，再新增 preload API 與 main validation。
5. 新的非同步失敗必須有可見狀態，不能只寫 console。
6. 新的啟動依賴必須有逾時或保守降級，不能留下永久 loading。

## 9. 發行門檻

GitHub Actions、Windows 簽章、Release 與公開更新來源的責任及操作順序，統一記錄於 [`RELEASE.md`](RELEASE.md)。

每個可交付版本至少必須完成：

```text
npm run typecheck
npm test
npm run security:audit
npm run build
npm run dist
```

封裝後還要從安裝版以滑鼠驗證：啟動、棋盤走子、局面工具、悔棋/下一步、引擎即時分析、右側檢視切換、猜著選棋、AI 解說入口、設定分類與版本頁。

發行完成後必須核對：安裝版版本、`app.asar` 與本次封裝一致，桌面捷徑指向新的安裝位置。
