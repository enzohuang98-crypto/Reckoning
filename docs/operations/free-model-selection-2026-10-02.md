# 免費模型能力核對與本次候選選擇

公開能力核對日期：2026-10-02，2026-10-03／04 重新核對精確 Qwen route。公開研究限定 Reckoning 免費目錄的 17 個精確 ID；下方另標明正式 App 服務的真實探測與完整生成，兩類證據分開。

## 2026-10-06 免費資格變動與現用模型

正式main-process metadata與公開endpoint重新核對：免費文字目錄降為16個，原保存 `qwen/qwen3.8-27b:free` 已不在可用清單，其[精確endpoint](https://openrouter.ai/api/v1/models/qwen/qwen3.8-27b:free/endpoints) 為 `endpoints=[]`。先前的17個清單與Qwen選擇均為歷史證據，不能當作現在仍可生成。

依使用者既有授權選擇免費模型，正式同key服務先探測 [Inkling Small](https://openrouter.ai/api/v1/models/thinkingmachines/inkling-small:free/endpoints)：permission、不可重試，保存模型未變；沒有更改帳戶權限。再明確選擇 [Nemotron Ultra免費route](https://openrouter.ai/api/v1/models/nvidia/nemotron-3-ultra-550b-a55b:free/endpoints)，probe與原子保存成功，現在saved model為 `nvidia/nemotron-3-ultra-550b-a55b:free`。不是生成途中自動fallback，沒有付費模型或新key。

當下Ultra prompt／completion價格0，官方model reasoning metadata為optional、default high、supported efforts high／medium、supports_max_tokens=true。完整JSON保留最多1000 reasoning；1000-token research planner按四分之一預留250 reasoning，總output與共享限制不增加。[官方reasoning規格](https://openrouter.ai/docs/guides/best-practices/reasoning-tokens) 指出reasoning通常與正文共用max_tokens，exclude只隱藏它，不降低消耗。

[AA Inkling Small reasoning26](https://artificialanalysis.ai/models/inkling-small)、[Ultra reasoning23](https://artificialanalysis.ai/models/nvidia-nemotron-3-ultra-550b-a55b) 僅為當下已取得的同版一般比較。未取得覆蓋全部免費route、相同有限預算的象棋評測；不能宣稱本次1000 reasoning cap與AA模式相同或絕對最強。真正完整題兩次在research_planner收到502／503，usage與finish未提供，尚無合格正文；probe成功不代替正式答案或設定頁UI驗收。詳細commit／wire／耗時與去敏證據見進度紀錄。

## 2026-10-05 實際推理模式與比較限制

當日重新核對公開免費文字目錄仍17個，精確Qwen免費endpoint仍宣告`structured_outputs`，prompt／completion價格皆0。先前「Qwen34／首選」的比較資料使用 **xhigh推理模式**，不能移作本次`reasoning.enabled=false`模式的能力證明。[AA的同版比較](https://artificialanalysis.ai/models/comparisons/qwen3-8-27b-non-reasoning-vs-nvidia-nemotron-3-ultra-550b-a55b)列Qwen non-reasoning為20、Nemotron Ultra reasoning為23；[Inkling Small reasoning](https://artificialanalysis.ai/models/inkling-small)為26。這些一般評測仍不能證明特定免費route或象棋解釋品質。

目前saved model保留精確Qwen，沒有自動切換、付費模型或榜單即通過的判定。停用推理解決了已重現的reasoning耗尽與空正文，但本次`155ebb6`兩次正式完整題仍有策略與路數錯誤，因此不能宣稱在實際模式中使用了最強已驗收模型。先修具體前提選擇與解釋連結，保留全局呼叫／token／deadline與正文檢查；後續選擇或推理設定須另取得正式答案證據。

## 2026-10-04 Structured Outputs 能力更正

使用者提供的 [OpenRouter 官方 Structured Outputs 文件](https://openrouter.ai/docs/guides/features/structured-outputs) 明確以 endpoint 的 `structured_outputs` 作為 JSON Schema 能力指標；請求欄位則是 `response_format.type=json_schema`，搭配 `json_schema.strict=true` 與 `provider.require_parameters=true`。**未列 legacy `response_format` 不代表不支援 schema**。本文件下方原始 metadata 記錄仍保留，但不能再由缺少該 legacy 名稱推導 Qwen 無結構化輸出能力。

當日 [精確免費 Qwen endpoint](https://openrouter.ai/api/v1/models/qwen/qwen3.8-27b:free/endpoints) 為 ModelRun，prompt／completion 價格皆 0，列有 `structured_outputs`、reasoning、reasoning_effort。`505490b` 將既有五段 schema 接入正式 Harness 初次生成及一次修補，provider 僅對精確 `qwen/qwen3.8-27b:free` 的 JSON/schema 請求採用上述路由要求。其他型號、短文字、無 schema 的 planner／追問不繼承這條策略；Super 保留已有實測依據的 JSON object，沒有自動換模型或付費 fallback。

這是欄位與引用 ID 的輸出契約；官方亦指出 enforcement 依 provider 而異。400 個五段可見正文漢字、棋盤／方別／變例引用及因果驗證仍獨立執行，`length`／空正文仍拒絕，沒有 Response Healing 或補完截斷 JSON。單次 6000 與共享 token／時間／次數限制不變。離線新測試先重現 schema 缺漏（provider exit1、Harness307/9），修正及提示範例欄位對齊後 provider exit0、Harness316/0、node typecheck exit0；真實 provider 結果以進度紀錄另列，離線通過不代替正文驗收。

## 2026-10-03 正式截斷診斷與設定修正

- 同一把 App 已保存的 OpenRouter key，經正式 main-process 服務探測及原子保存，從 Super 成功切至 `qwen/qwen3.8-27b:free`；安全紀錄 `same-key-qwen-strongest-switch-2026-10-03.json`。這只證明服務切換，不代替設定頁 UI 或完整回答。
- 程式來源 `ed1fd71d09ca0f8d8e7bb57ffebb1743ed2dda11`，正式 Pikafish／prepare／Harness 初局 `h2e2` 完整題，唯一請求 `max_tokens=6000`、`reasoning={effort:xhigh,exclude:true}`，未送 `response_format`。59,905ms 後 **FAILED / generation_incomplete / empty_content**，`finish_reason=length`，completion=6000、reasoning=6000，可見輸出 token=0。沒有合格正文、正文 hash 或內容驗收。安全紀錄 `pr-fixed-case-qwen-strongest-ed1fd71-2026-10-03.json`。
- 當下官方精確 model metadata 仍為 optional reasoning，supported_efforts=`xhigh,medium,low`、default=`xhigh`；沒有宣告 `supports_max_tokens`。免費 ModelRun endpoint 的 prompt／completion 價格皆0，支持 reasoning／reasoning_effort，未列 `response_format`。[官方模型目錄](https://openrouter.ai/api/v1/models)、[精確 endpoint](https://openrouter.ai/api/v1/models/qwen/qwen3.8-27b:free/endpoints)。不能從其他 Qwen 型號推定可用 token-budget 控制。
- 此結果與官方說明相符：reasoning 與正式輸出共用 `max_tokens`，`exclude` 只隱藏 reasoning；若全額用於推理，可能回傳空 content 與 length。[官方 reasoning 說明](https://openrouter.ai/docs/guides/best-practices/reasoning-tokens)。因此只對精確免費 Qwen route 改用支援的 `low` effort，仍保留推理、相同模型／key、6000 單次上限、Harness 共用總預算／時限／次數與完整 validator。沒有付費模型、自動換模型或新增無上限重試。
- `19d8d680e24a930c3bd7f0837b845b5229696da2` 的正式重試已實際送 `effort=low`，仍 **FAILED / generation_incomplete / empty_content**：37,754ms，wire=1 請求，completion=6000、reasoning=6000、finish=length，可見輸出=0。安全報告 `pr-fixed-case-qwen-low-19d8d68-2026-10-03.json` 的 trace rows/count 未取得，而 safeWireRequests 明確記錄一次，不能把 trace count=0 誤當沒有呼叫。沒有正文或 hash。
- 低 effort 不是 hard reasoning-token cap；兩次不同 effort 都耗盡正文額度。官方精確模型 metadata `mandatory=false` 且模型頁明示 thinking 可開關，因此只對這個精確免費 route 改送 `reasoning={enabled:false,exclude:true}`，不更改同一模型、key、輸出及共用預算、驗證或重試限制。[精確官方模型頁](https://openrouter.ai/qwen/qwen3.8-27b:free)。下一次正式完整題仍是必要品質驗收；AA 的 Xhigh 分數不能冒充關閉 thinking 設定的品質證據。停止重刷已失敗的相同設定。

## 決策

本次最有比較證據的模型候選為 **`qwen/qwen3.8-27b:free`**。目前 Artificial Analysis（AA）Intelligence Index v4.3.2 的公開同版比較中，Qwen3.8 27B（Xhigh）為 34，Ultra（Reasoning）為 23；Qwen 在 HLE 與長上下文推理評測亦較高。這是選擇模型候選的依據，不是已證明它在象棋固定案例或較低推理設定勝出。原廠 Xhigh 預設已經正式完整題證明會耗盡本 App 的有限輸出額度，後續策略依上節修正。[AA 同版比較](https://artificialanalysis.ai/models/comparisons/qwen3-8-27b-vs-nvidia-nemotron-3-ultra-550b-a55b)

本次沒有找到涵蓋全部 17 個精確免費 route、同一提示、同一有限預算的象棋解說評測。因此不能宣稱完整目錄的絕對第一名。正式 Harness 的完整回答、棋盤事實與人工內容檢閱仍是必要驗收。

## 搜尋方法與證據等級

- 以安全目錄快照 `free-catalog-model-strength-2026-10-02.json` 的精確 ID 為範圍，並重新讀取 [OpenRouter 公開模型目錄](https://openrouter.ai/api/v1/models)。17 個 ID 當時均列出 prompt／completion 價格為 `0`；這不證明即時流量可用、帳戶不被限流或日後仍免費。
- 使用 research skill 與 Agent-Reach。Exa 免費搜尋額度本次受限，未建立付費 key；改以瀏覽搜尋、AA 原站、原廠模型卡及公開 endpoint JSON 核對。
- 搜尋包含 `site.artificialanalysis.ai/models` 搭配各候選名稱，以及 `site.huggingface.co/Qwen Qwen3.8-27B reasoning`。核對當前頁面，模型發布年代主要為 2026；排除論壇體驗、轉載榜單、不同版本分數及單靠名稱／參數量的排名。
- **AA 原站**：評測發佈者的一手結果，獨立於模型原廠；權重最高。但各頁仍屬同一家評測，不能算多次獨立複驗。[AA 方法](https://artificialanalysis.ai/methodology)
- **原廠模型卡**：能力設定、方法與原廠自評的一手資料；適合確認推理選項，不能取代獨立比較。
- **OpenRouter 公開 route metadata**：介面、價格與限制的一手資料；能證明當時的宣告，不能證明實際回答品質或可用性。

## 17 個候選的比較覆蓋

AA 分數取目前 v4.3.2 頁面；近似整數及估值不能當成精確統計差異。`未取得` 表示本次定向搜尋沒有取得可用的同版同模型分數，並非斷言其他地方完全沒有評測。

| 精確免費 ID | 本次 AA 結果／證據 | 判讀 |
|---|---|---|
| `qwen/qwen3.8-27b:free` | 34，Xhigh。[AA](https://artificialanalysis.ai/models/qwen3-8-27b) | 已取得比較資料的最高者；本次首選。 |
| `thinkingmachines/inkling-small:free` | 26，reasoning。[AA](https://artificialanalysis.ai/models/inkling-small) | 不能因名稱含 Small 就排除，但現有同版指數低於 Qwen。 |
| `thinkingmachines/inkling:free` | 25，Xhigh。[AA](https://artificialanalysis.ai/models/inkling) | 指數不是依參數量遞增。 |
| `nvidia/nemotron-3-ultra-550b-a55b:free` | 23，reasoning。[AA](https://artificialanalysis.ai/models/nvidia-nemotron-3-ultra-550b-a55b) | 不因 Ultra 名稱視為目錄第一。 |
| `google/gemma-4-26b-a4b-it:free` | 約 17，**估值**。[AA](https://artificialanalysis.ai/models/comparisons/gemma-4-26b-a4b-vs-nvidia-nemotron-3-super-120b-a12b) | 未完整獨立評測的估值不能與實測同等看待。 |
| `google/gemma-4-31b-it:free` | 15，reasoning。[AA](https://artificialanalysis.ai/models/gemma-4-31b) | 未以舊版宣傳分數與新版指數混排。 |
| `nvidia/nemotron-3.5-lightning:free` | 13。[AA](https://artificialanalysis.ai/models/nemotron-3-5-lightning) | 速度／效率優勢不等同最強推理。 |
| `nvidia/nemotron-3-super-120b-a12b:free` | 13，reasoning。[AA](https://artificialanalysis.ai/models/comparisons/gemma-4-26b-a4b-vs-nvidia-nemotron-3-super-120b-a12b) | 實際可生成仍須與能力及內容驗收分開。 |
| `cohere/north-mini-code:free` | 10。[AA](https://artificialanalysis.ai/models/north-mini-code) | 未提供高於 Qwen 的一般能力證據。 |
| `nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free` | 約 10；頁面摘要／FAQ 的 estimated 標示不一致，保守列**估值**。[AA](https://artificialanalysis.ai/models/nemotron-3-nano-omni-30b-a3b) | 不把多模態功能當成象棋文字推理優勢。 |
| `liquid/lfm-2.5-2.6b:free` | 約 8，**估值**。[AA](https://artificialanalysis.ai/models/lfm2-5-2-6b) | 未提供高於 Qwen 的一般能力證據。 |
| `apodex/apodex-1.1-mini:free` | 未取得同版 AA 指數；原廠有 Agent Team 結果。[模型卡](https://huggingface.co/apodex/Apodex-1.1-mini) | 專屬多代理 harness 的自評，不能搬成 Reckoning 單次生成排名。 |
| `dots-studio/dots-3-note-preview:free` | 未取得同版 AA 指數。 | 本次不據參數量或其他家族版本推定排名。 |
| `inclusionai/ling-3.0-flash-sante:free` | 未取得 Sante 精確版的同版 AA 指數。 | 不把普通 Ling 3.0 Flash 的分數移給 Sante。 |
| `poolside/laguna-s-2.1:free` | 未取得同版 AA 總指數；原廠公開 coding／agent 評測。[模型卡](https://huggingface.co/poolside/Laguna-S-2.1-FP8) | 不足以推出本案一般推理或象棋第一。 |
| `poolside/laguna-xs-2.1:free` | 未取得同版 AA 總指數。 | 不把 S 版分數移給 XS。 |
| `nvidia/nemotron-3.5-content-safety:free` | 原廠定位為安全分類 moderator。[模型卡](https://huggingface.co/nvidia/Nemotron-3.5-Content-Safety) | 不選作本案一般象棋解說模型。 |

## 精確免費 endpoint 與推理限制

以下為當時公開 endpoint 實際回傳的安全欄位，不是套用付費模型頁面的能力。每一列 prompt／completion 均為 `0`。

| 精確 ID | 當時 provider | context／最大 completion | 與本案相關的宣告參數 |
|---|---|---|---|
| `qwen/qwen3.8-27b:free` | ModelRun | 262144／235929 | `max_tokens`、`reasoning`、`reasoning_effort`、`structured_outputs`；**未列 `response_format`**。[endpoint](https://openrouter.ai/api/v1/models/qwen/qwen3.8-27b:free/endpoints) |
| `nvidia/nemotron-3-ultra-550b-a55b:free` | Nvidia | 1000000／65536 | `max_tokens`、`reasoning`、`reasoning_effort`；**未列 `response_format`**。[endpoint](https://openrouter.ai/api/v1/models/nvidia/nemotron-3-ultra-550b-a55b:free/endpoints) |
| `google/gemma-4-31b-it:free` | Google AI Studio | 262144／32768 | `max_tokens`、`reasoning`、`response_format`；未列 `reasoning_effort`。[endpoint](https://openrouter.ai/api/v1/models/google/gemma-4-31b-it:free/endpoints) |
| `thinkingmachines/inkling:free` | Thinking Machines | 1048576／262144 | `max_tokens`、`reasoning`、`reasoning_effort`；未列 `response_format`。[endpoint](https://openrouter.ai/api/v1/models/thinkingmachines/inkling:free/endpoints) |
| `nvidia/nemotron-3.5-lightning:free` | Nvidia | 1000000／65536 | `max_tokens`、`reasoning`；未列 `reasoning_effort`／`response_format`。[endpoint](https://openrouter.ai/api/v1/models/nvidia/nemotron-3.5-lightning:free/endpoints) |

`supported_parameters` 列出 reasoning 家族，不自動證明每一個子選項、enum 或 token 上限都被該 route 完整支援。原廠 Qwen3.8-27B 模型卡明列 `xhigh` 為預設，另有 `medium`、`low`，並指出降低深度可能造成分析不足或更多重試。這支持保留高深度的候選選擇；當前免費 ModelRun 是否接受並實現該設定，仍需正式服務探測與診斷。[Qwen 原廠模型卡](https://huggingface.co/Qwen/Qwen3.8-27B)

OpenRouter 的 `exclude: true` 只隱藏回傳的 reasoning；不能視作不消耗推理 token。多數 provider 會把 reasoning 算進 `max_tokens`，不夠完成時仍可能 `finish_reason=length`，且空正文應拒絕。[OpenRouter reasoning 規格](https://openrouter.ai/docs/guides/best-practices/reasoning-tokens)

## 與本案預算、品質及可用性的關係

- AA 的 Qwen Xhigh 比較表列每任務加權平均約 67k output、48k reasoning；這不是 Reckoning 應採用的配額，也不是每題所需 token，但足以證明不能將高預算榜單的能力直接等同於本案 6000-token 配額。[AA 比較及 token 使用量](https://artificialanalysis.ai/models/comparisons/qwen3-8-27b-vs-nvidia-nemotron-3-ultra-550b-a55b)
- 本案仍採明確的有限總 token、時間與呼叫次數上限，先以真實固定案例查 token／finish reason／正文品質，再依證據判斷是否需要調整。不得靠無上限增加配額，或關閉推理後仍宣稱等同 Xhigh。
- 綜合指數較高不代表每一面向都較強：同表 Qwen AA-Omniscience 為 -10、Ultra 為 0。因此精確引用、合法重播、吃子／交換核對、因果及人工檢閱都需保留，不能以榜單代替正確性。[AA 同版明細](https://artificialanalysis.ai/models/comparisons/qwen3-8-27b-vs-nvidia-nemotron-3-ultra-550b-a55b)
- 歷史 429／502 只表示當時路由或限流狀態，不能當作能力評比。研究沒有重放這些請求；正式同 key 切換失敗必須保留原模型，不以自動改用其他模型掩蓋。

可信度：Qwen 是本次已取得同版比較證據中最有力的免費候選，為中等可信；它在本案有限預算的完整象棋正文是否達標，尚需實測。公開目錄及 endpoint 是當時狀態，正式執行前需再核對免費資格與參數。

## 本次正式服務探測結果

研究完成後，使用者已授權的同 key 免費模型切換由正式 `OpenRouterSavedModelService` 執行；key 僅在 main process 解密。以下為安全診斷，不是原始帳戶回應。

| 精確候選 | 正式結果 | 保存的模型 |
|---|---|---|
| `qwen/qwen3.8-27b:free` | `generation / rate_limited`，429；RetryAfter 未提供。 | 保留 Super。 |
| `thinkingmachines/inkling-small:free` | `generation / permission`，不可重試；RetryAfter 未提供。 | 保留 Super。 |
| `thinkingmachines/inkling:free` | `generation / permission`，不可重試；RetryAfter 未提供。 | 保留 Super。 |

三份安全紀錄分別為 `same-key-qwen-strongest-switch-2026-10-02.json`、`same-key-inkling-small-strongest-available-switch-2026-10-02.json`、`same-key-inkling-strongest-available-switch-2026-10-02.json`，保留於本機驗收資料夾而不提交個人帳戶檔案。沒有重試相同拒絕、付費使用或自動改模型；`beforeModel` 與 `afterModel` 均為 `nvidia/nemotron-3-super-120b-a12b:free`。

同期安全 quota metadata 提供 free used=2／limit=50／remaining=48，因此不能宣稱已證明每日額度用盡；Qwen 的限流範圍仍不明。後續用已保存 Super 驗證程式修正，不得稱為 Qwen 或 Inkling 的完整正文驗收。候選能力、route 即時可用性、完整棋理解說品質分開判定。

Inkling 精確免費目錄宣告 optional reasoning、default effort=high，efforts 為 max／high／medium／low／minimal／none，未列 response_format。AA 的 Xhigh 分數不直接證明此免費 route 的預設 high 等同該評測；本次 probe 被拒絕，未替 Inkling 加入未實測的請求策略。
