# 免費模型公開研究與實測限制

這份文件只整理停工前2026-10-10已查閱的公開資料及正式probe結果；停工後沒有再發生成請求。公開目錄和價格會變，恢復時須重新核對。通用排行榜不能證明象棋WHY能力，reasoning評測亦不能直接當作關閉推理或1000／2000-token有界模式的實際能力。

| 精確免費候選 | 公開證據 | 本次實際狀態 |
|---|---|---|
| thinkingmachines/inkling-small:free | [AA同頁比較](https://artificialanalysis.ai/models/comparisons/inkling-small-vs-nvidia-nemotron-3-super-120b-a12b)：同v4.3.2，Small26／Super reasoning13；不能因Small名稱排除它。官方[免費頁](https://openrouter.ai/thinkingmachines/inkling-small:free)限定agentic harness，accepts tools但不支持response_format | formal same-key probe403，安全分類agentic_harness_restriction，原Super保留。沒有冒用其他harness身分／繞過限制，也未證明只加app attribution即可解決 |
| thinkingmachines/inkling:free | [官方頁](https://openrouter.ai/thinkingmachines/inkling:free)列agentic harness only、通用reasoning評測25。HTTP-Referer／X-Title在[API頁](https://openrouter.ai/thinkingmachines/inkling:free?view=api)是optional attribution，不構成授權證明 | formal probe403；具體account條件沒有足夠證據，不能猜測 |
| apodex/apodex-1.1-mini:free | [原始技術報告](https://arxiv.org/html/2608.23283v1)單独列Mini的工具評測，是廠商自評，不能套旗艦AA26或當象棋證明。[exact endpoint](https://openrouter.ai/api/v1/models/apodex/apodex-1.1-mini:free/endpoints)零價格／Novita、reasoning、response_format、structured_outputs；官方models metadata mandatory=false、未宣告hard max reasoning能力 | 正式probe成功並保存；完整流程第一planner用1000output，其中906reasoning，length且無完整內容，拒絕。新增planner政策測試已RED、實作未完成 |
| dots-studio/dots-3-note-preview:free | [官方頁](https://openrouter.ai/dots-studio/dots-3-note-preview:free)及[endpoint](https://openrouter.ai/api/v1/models/dots-studio/dots-3-note-preview:free/endpoints)有reasoning與structured_outputs、零價格，官方列2026-12-31下架。本輪未找到exact型號独立原始智力評測 | 未以這輪資料宣稱比Super強或已通過新head完整答案；歷史對照仍按原日期與來源判定 |
| cohere/north-mini-code:free | [現行AA頁](https://artificialanalysis.ai/models/north-mini-code)指數10；六月27.6屬舊指數版本，不能混比 | 沒有證明它比Super更聰明，不因舊分數選它 |
| poolside/laguna-s-2.1:free | [作者評測與限制](https://poolside.ai/blog/introducing-laguna-s-2-1)為自身harness自評並披露tool schema／invalid JSON／thinking長度限制；[免費頁](https://openrouter.ai/poolside/laguna-s-2.1:free)列2026-10-31下架，endpoint未列structured_outputs | 不優先於本次Apodex／Dots探索；沒有私有key可用性或象棋內容通過結論 |

免費Ultra的正式probe仍provider_unavailable；Gemma31仍429且未提供RetryAfter。Super portable JSON可完成但內容仍錯。有剩餘免費每日quota不能推定429範圍或上游容量。

本次沒有付費OpenRouter模型、動態fallback、信用額度購買或帳戶權限變更。保存模型的成功與完整講解通過是兩個不同門檻。
