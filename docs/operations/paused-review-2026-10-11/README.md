# 2026-10-11 停工交接：目標、修改、失敗與未驗收項目

使用者要求先停止工作、公開目前全部修改並親自檢查。本 goal 已設為 **paused**。此目錄與同次提交是停工快照，包含尚未完成的修改和已知失敗測試，**不是可合併或可發布版本**。

## 1. 使用者真正要達成的目標

最優先是讓棋手復盤時得到準確而切題的回答：為何這步有漏洞、對手如何反制、Pikafish 首選想做什麼、後續主線如何支持這個目的，以及兩種走法的實際差異。分數只是比較資料，不能代替原因；走對時不能硬找錯誤；證據不足時要先盡有界研究能力，而不能直接用不知道結束。

完整講解須有穩定五段、至少400可見漢字，目標約500–900，不能以重複或內部欄位湊字數。短追問直接回答問題，不強迫五段長文。解釋使用真Pikafish及可信棋規基礎，正確區分紅黑、局面、主線、步數、吃子／將軍、觀察與推論，不能把模型自填verified或有效引用當成棋理已證實。

必須只使用同一把App已保存的OpenRouter key與免費模型，能在實際設定頁切換、成功保存、設定重開及App重啟後保留，失敗保留原模型。引擎與AI研究參數固定既有預設，移除雙引擎、可調參數與授權啟用的產品功能。

最後要經feature branch→PR→CI→main→未使用patch版本→新annotated tag→unsigned候選原資產→實際Windows安裝、UI、背景更新與資料保護驗收→同資產Latest promotion。不能覆寫tag或公開資產；forceCodeSigning:true保留，只用既有明確unsigned例外並揭露SmartScreen。v0.4.15若已使用則選下一個未使用patch。

## 2. 停工時的版本與GitHub狀態

| 項目 | 實際狀態 |
|---|---|
| Repository／PR | enzohuang98-crypto/Reckoning，[PR76](https://github.com/enzohuang98-crypto/Reckoning/pull/76)，feature branch `fix/ai-explanation-completeness` |
| main | ce03ba0685eaf8b499241ba3153db722eb0f2eae；本工作沒有合併到main |
| 最後已提交的AI修正 | 4eb14de03df129445c333ecdce50a1a1e8999672；本停工快照另外提交未完成工作及本報告 |
| 最後整套必要檢查來源 | 7e0e75ac73d4fffaa4c786c86c4a9d426c271cbb；不是停工快照的通過證據 |
| package版本 | 0.4.14 |
| GitHub Latest | [v0.4.13](https://github.com/enzohuang98-crypto/Reckoning/releases/tag/v0.4.13)，2026-09-14發布；未發布正式v0.4.15 |
| v0.4.15 tag | 停工核對遠端尚不存在；工程測試包使用0.4.15身份不等於正式公開版本已發布 |
| 使用者安裝版 | `C:\Program Files\xiangqi-analyzer\象棋AI分析講解.exe`，ProductVersion **0.4.13.0** |
| 最近正式保存的模型 | `apodex/apodex-1.1-mini:free`；同saved key探測成功後經正式service保存。停工後沒有再切換模型或發生成請求 |
| Goal | paused；沒有標成complete，沒有背景代理繼續修正 |

## 3. 已做的修正，及它們能證明什麼

### AI比較、內容與研究

- Harness、scorer、validation、prompt與UI共用實際比較狀態；同首選不強制負面解釋，有證據才比較，不用候選排名或自行發明分差門檻推論失誤。
- 新研究改變首選後，初答、audit、scorer和repair使用同一個目前比較快照，避免拿舊首選來評新正文。raw salvage／recovery也不能绕過同首選／不足限制；批評主詞限定實戰步，其他候選有自身證據時仍可比較。
- 不足豁免按局部陳述判斷，同段其餘實質斷言仍受限制。格式、引用存在、可計算棋盤事實與模型策略解释分開，不再宣稱任意目的／機會／後果均已驗證。
- 新增有界模型研究決策→合法Pikafish搜尋→完成證據→下一決策→寫作流程，只允許原局面、合法候選與可信主線前綴。保留105秒、6模型calls、10000 output、3引擎queries與10秒名義引擎額度及writer／repair預留，不自動換模型。
- 解析的公開UCI info先進本機研究，再套UI節流，修正80ms UI節流丟掉研究觀測。保留96筆／PV32手與省略量；不宣稱取得引擎未公開內部搜尋節點。
- 合法重播產生逐線棋盤事實與premise pools，對錯方別、跨線、錯步數、吃子／將軍及不相關引用做確定性檢查；這些不是通用自然語言真偽引擎。
- 複數次相同中文著法會有不同吃子結果。4eb14de修正只看前置手序、忽略「兵三進一在第7手」的誤拒；手序、方別、前提、snapshot及時序取交集後再查事實，不能按希望的吃子結果挑一手。

### Provider與JSON

- 拒絕length、空正文、錯模型身份與不完整JSON，不擷取內部大括號修補截斷回應。malformed audit／answer／claim原先會TypeError並誤報network，現在拒絕為invalid_model_response。
- 精確Ultra小型planner採有界reasoning ceiling，保留可見JSON空間。Super只在已確認的initial／repair portable schema使用strict json_schema＋require_parameters，其他模型／階段不誤套。
- native schema對前提的要求原本與正式validator矛盾：局部不足可以不選前提，schema卻強制選一項。7e0e75a允許native形狀空前提，但正式validator仍拒絕實質核心斷言缺前提，並保留五段400字。
- 後續planner軟逾時原本連已有證據與writer預留都丟棄；8cbc5d4只在安全條件成立時停止研究，交由真正模型寫作並驗證。首次timeout、總期限、取消、429／503及不合格正文仍拒絕。

### UI、Windows與發布管線

- 設定頁未知／讀取失敗目錄不再誤報模型下架，清單仍選目前模型顯示已啟用。本機引擎導覽不再宣稱有已移除的複核／參數調整。
- 移除雙引擎、引擎／AI研究参数調整及授權啟用UI／相關入口；研究與引擎使用既有固定預設，保留key、設定与棋局資料。
- 改善棋盤、工具區、FEN與長中文內容的響應式布局；來源fixture有不同viewport／zoom檢查和前後圖。這些不代表所有Windows環境已保證，也不代表正式候選已驗收。
- 修正隔離Windows驗收晚失前景的有界恢復及PS7 DateTime UTC重解析造成台灣時區保存deadline倒退8小時；未知／安全提示仍拒絕，原12秒期限不增加。
- exact-candidate與promotion驗證public原資產、original artifact、tag／main commit／hash／unsigned／proxy jobs，不為promotion重新build或覆寫。離線66正反例不等於真candidate通過。
- source-map-js以最小lock變更更新到修補版本1.2.2；security:audit依repository既有runtime／build政策通過，不表示所有npm advisory都歸零。

## 4. 真正卡住的兩個發布門檻

### A. 真實AI完整答案和策略追問都尚未合格

Super可以在portable schema下回完整JSON，stop且reasoning0，仍寫錯棋子關係、左右翼、方別或變例引用。把推理改為有界1000／2000的對照也沒有解決內容；實際上限被遵守，但草稿仍不合格。這些對照沒有採用為產品策略，也沒有當成正式App驗收。

固定初局h2e2「炮二平五」完整題**沒有任何一份accepted五段正文、最終正文SHA或獨立內容通過結論**。少了generation_incomplete不等於WHY已解決。

102半回合真實公棋譜第22步的策略追問：初答錯引用，補救又length at1200、reasoning0；因此也没有交付有效答案。短問題實際prompt已正確分流，不以這次失敗為由任意重寫或降低正文驗證。

更高通用能力的Inkling Small免費版目前正式probe回403；白名單分類為agentic harness restriction，官方頁也列agentic harness only。没有冒用其他agent身份或繞過限制。Ultra仍provider_unavailable，Gemma31仍429且未提供retry-after。每日免費有剩餘請求不能证明具體限流範圍。

Apodex Mini免費probe成功並保存，但第一次正式完整流程就planner length：1000 output中906是reasoning，沒有完整JSON。官方只提供optional reasoning（mandatory=false），沒有硬reasoning token budget能力宣告；因此不能憑名字猜測它接受Ultra的max_tokens策略。**新增planner策略測試已RED，正式修正尚未實作，停工快照保留這個紅燈。**

### B. 最新隔離Windows工程包正常更新後未成功重啟

[CI38005496481](https://github.com/enzohuang98-crypto/Reckoning/actions/runs/38005496481)對7e0e75a成功，但[Windows38005496441](https://github.com/enzohuang98-crypto/Reckoning/actions/runs/38005496441)失敗。

該工程包已通過下載失敗恢復、背景可用、不自退、毀損cache恢復、同版本cache重開、未提交草稿攔截、保存途中新增草稿攔截與early prepare恢復。真fault NSIS PID6140退出73有OS ProcessStopTrace證據，失敗後重開舊App與cache reuse也觀察到。

第二次正常安裝已看到exe版本變0.4.15，但隨後 `Reopened packaged workspace did not become ready.`。最終重啟、資料hash／FEN、捷徑與installFailureRetry完整門檻沒有完成，不能沿用上一個62e0da1工程包的成功。

可確認工具缺口是只等ProductVersion變更就啟動App，沒有等第二installer真正OS完成；**目前還不能证明這就是實機失敗的根因**。已寫OS start／stop lineage與startup PID觀測草稿，但尚未完成驗證、未在新VM重跑。沒有取消安全提示、加長睡眠或修改正式installer來冒充通過。

## 5. 停工快照刻意保留的未完成工作

| 檔案／工作 | 狀態 |
|---|---|
| tests/unit/main/openRouterProvider.test.ts | 新增exact Apodex Mini planner與其他phase／model隔離測試；實際RED，policy實作未完成。當前快照npm test可能因此失敗，不能沿用7e0綠燈 |
| windows-packaged-updater.ps1 | 新增hash／App PID／OS installer lineage完成觀測與version共同門檻；草稿，未完成驗收 |
| windows-packaged-ui.ps1 | 新增safe啟動PID／session／window／exit觀測；草稿，未完成驗收 |
| windows-save-race.self-test.ps1 | 新增installer未完成但version已更新、failed exit等離線編排測試；尚無最終PS5／PS7全案通過證據 |
| 本機acceptance helpers | 一併公開原始碼供查核實際流程；不是普通App bundle，沒有key或私有profile內容，不能當作交付的installed App |

本快照不再補fix或跑新的測試。push本身可能觸發repository既有Actions；新的結果由GitHub顯示，並非本報告已驗收或已合併。

## 6. 已有證據與明確限制

| 證據類別 | 已取得 | 還缺什麼 |
|---|---|---|
| 離線程式 | 7e0五個必要入口＋no-hooks exit0，Harness371／0、research37、engine100／0；4eb focused variation349／0、premises19／0、Harness371／0、node typecheck | 停工WIP新head整套檢查，已知Apodex RED需完成 |
| 真實provider | 同key的probe、真Pikafish／正式Harness的安全calls／budget／usage／finish／错误，見本目錄七份摘要 | 合格完整正文及策略追問、正文SHA與独立內容檢閱 |
| 真來源UI | Super→Lightning成功保存、設定重開及App重啟保持；Inkling Small失敗保留原模型，沒有重輸key | 正式候選binary上的同key操作／重啟、真正分析頁全文 |
| 完整棋局 | Pikafish55半回合自對弈至將死；公棋譜102／69／75半回合全局合法重播與正常預設失誤點分析 | 它們的有效AI WHY回答與內容驗收 |
| 隔離Windows | 62e0舊工程包全案曾通過；最新7e0工程包上述8項通過、重啟失敗 | 新head全案、canonical候選原資產及真正安裝／重啟資料 |
| 使用者主機 | 目前已安裝0.4.13.0；沒有以source runner覆蓋安裝版 | 候選下載hash、正常安裝、同key UI、引擎／完整講解、資料及捷徑驗收 |
| 簽章與Release | forceCodeSigning:true保留、既有explicit unsigned exception與揭露要求 | 版本PR／新tag／unsigned正式candidate、通過後同hash Latest promotion |

## 7. 為什麼會反覆修，以及哪些判斷不能當成功

同一回答跨過研究、prompt、schema、audit、writer、repair、scorer、render；前期部分限制只修到其中一段，後續路徑仍可能用舊比較、錯誤主詞或不一致的豁免。離線fixture與真provider的輸出差異也暴露JSON shape、推理預算與語義問題。Windows的實際NSIS、UTC、前景與cache流程不能由SDK fixture推定。

工作方式也有不足：過多局部迭代，還沒有形成完整可發布驗收閉環；關閉推理雖讓正文出來，沒有證明精確原因已修好；schema讓JSON完成也沒有證明棋理正確；新source後曾有模型／Windows門檻仍未過，不能把單一綠燈當整體完成。使用者要求一次釐清根因是合理的，現在的實際交付仍未達到。

本報告不把所有錯誤都歸因於免費模型。已確認的App缺陷有具體紅綠證據；其餘模型能力、提示／證據呈現與Windows startup因素仍需實測區分，不能借外部限制掩蓋未完成工作。

## 8. 建議親自檢查的閱讀順序

1. [PR76 Files changed](https://github.com/enzohuang98-crypto/Reckoning/pull/76/files)，以及本快照與main的完整diff。
2. 本目錄 [index.json](index.json) 与七份safe摘要。每份只列模型、commit、階段、budget、usage、finish、耗時、錯誤及validator；沒有raw帳戶回應或隱藏思考。
3. `*-rejected-drafts.md`：固定初局真模型被拒草稿，能直接看到錯誤。它們**不是App成功答案**；沒有完成可見回應的Apodex只提供metadata摘要，不造正文。
4. [Windows失敗摘要](windows-38005496441-summary.json)與原Actions artifact，區分passed／not_run／failed；不把null的最終payload當0。
5. [設定頁四張before／after](../settings-ui-review-2026-10-09/README.md)；明示合成React/CSS來源，不冒充真provider／candidate。
6. [逐階段長紀錄](../v0.4.15-2026-09-23-progress.md)、[棋規可信來源](../xiangqi-rules-foundation.md)、[目前free模型研究](../free-model-selection-2026-10-02.md)，查閱每項來源和限制。

## 9. 恢復位置

從本停工快照接續，先處理已知RED Apodex planner政策與Windows OS完成觀測草稿，重新驗證受影響gates；再取得真正精確完整正文和整盤棋策略答案。其後才是最終PR review／CI／main／版本PR／新annotated tag／candidate immutable資產／Windows正式binary與主機驗收／Latest。所有原目標保留，沒有把完成標準縮成「代碼已上傳」。

目前不要求使用者重新貼key、開付費模型、代做Windows或批准合併；使用者先看GitHub，再決定恢復方向。
