# 象棋解說的棋規基礎與來源邊界

核對日期：2026-10-02。核對對象：`src/shared/logic/ai/xiangqiKnowledge.ts` 的九條必帶基本規則，以及棋規與本局推論的分界。本紀錄只證明來源與文字核對，不代表正式 AI 回答或 Windows binary 已通過驗收。

## 研究範圍與來源等級

使用 research skill、Agent-Reach 的 Exa 搜尋及官方頁面／PDF 閱讀。搜尋包含 `site.asianxiangqi.org axf_rules 长杀 一将一杀 可行`；只納入規例制定組織發布的材料，排除部落格、未注明規例版本的教學及轉載。年代範圍以 AXF 2017 第四次修訂本與 WXF 官方版本沿革說明為限，沒有宣稱完成所有地區或最新比賽裁判規例的調查。

| 來源 | 已讀範圍 | 證據等級與用途 |
|---|---|---|
| [AXF《象棋比賽規例》第四次修訂補充本（2017）](https://asianxiangqi.org/%E6%AF%94%E8%B5%9B%E8%A7%84%E4%BE%8B/%E6%AF%94%E8%B5%9B%E8%A7%84%E4%BE%8B_2017.pdf) | 印刷第 4–5、13、15–16 頁的抽取文字 | 制定組織的一級規範來源；本次基本走子核對的主要依據。PDF 頁面圖片抓取逾時，未以圖片補驗。 |
| [AXF 官方棋例摘要](https://www.asianxiangqi.org/axf_rules.htm) | 術語及棋例總綱 | 官方摘要；協助交叉定位，同一組織的重述不計為獨立證據。 |
| [WXF 官方 World Xiangqi Rules 介紹](https://www.wxf-xiangqi.org/index.php?Itemid=291&catid=133&id=269%3Aworld-xiangqi-rules-introductionen&lang=en&layout=default&option=com_content&view=article) | 版本沿革介紹 | 制定組織的一級背景來源；只支持 WXF 以 AXF 第四次修訂本為基礎的沿革，不能代替 WXF 規例正文逐條核對。 |

AXF 英文 PDF 此次開啟後沒有取得可讀正文，因此未用其內容支持任何條文結論。亦未取得並核對 CCA 2020 原文；本紀錄不將程式既有的來源註解視作已完成官方原文核對。

## 九條基本規則逐項核對

下表為獨立摘要；條次對應目前 `XIANGQI_BASIC_RULES` 的順序。頁碼均為印刷頁碼。

| 條次／規則群 | 核對內容 | 官方出處 |
|---|---|---|
| 1：棋盤、輪走 | 九路十線，紅先而後交替。 | [AXF](https://asianxiangqi.org/%E6%AF%94%E8%B5%9B%E8%A7%84%E4%BE%8B/%E6%AF%94%E8%B5%9B%E8%A7%84%E4%BE%8B_2017.pdf#page=5) 第 4 頁第一節第 1 條；第 5 頁第三節第 1 條。 |
| 2：將帥、士仕 | 九宮內；將帥直／橫一格，士仕斜一格。 | [AXF](https://asianxiangqi.org/%E6%AF%94%E8%B5%9B%E8%A7%84%E4%BE%8B/%E6%AF%94%E8%B5%9B%E8%A7%84%E4%BE%8B_2017.pdf#page=5) 第 4 頁第二節第 1–2 條。 |
| 3：相象 | 本方半場斜兩格，中點有子不得通過。 | [AXF](https://asianxiangqi.org/%E6%AF%94%E8%B5%9B%E8%A7%84%E4%BE%8B/%E6%AF%94%E8%B5%9B%E8%A7%84%E4%BE%8B_2017.pdf#page=5) 第 4 頁第二節第 3 條。 |
| 4：馬 | 一直／橫再一斜；馬腿受阻不得通過。 | [AXF](https://asianxiangqi.org/%E6%AF%94%E8%B5%9B%E8%A7%84%E4%BE%8B/%E6%AF%94%E8%B5%9B%E8%A7%84%E4%BE%8B_2017.pdf#page=5) 第 4 頁第二節第 5 條。 |
| 5：車 | 直／橫不限距離，不跨子。 | [AXF](https://asianxiangqi.org/%E6%AF%94%E8%B5%9B%E8%A7%84%E4%BE%8B/%E6%AF%94%E8%B5%9B%E8%A7%84%E4%BE%8B_2017.pdf#page=5) 第 4 頁第二節第 4 條。 |
| 6：炮 | 移動同車；吃子須隔一炮架，原文不限制炮架方別。 | [AXF](https://asianxiangqi.org/%E6%AF%94%E8%B5%9B%E8%A7%84%E4%BE%8B/%E6%AF%94%E8%B5%9B%E8%A7%84%E4%BE%8B_2017.pdf#page=5) 第 4 頁第二節第 6 條。 |
| 7：兵卒 | 每著一格；過河可橫走，不可後退。 | [AXF](https://asianxiangqi.org/%E6%AF%94%E8%B5%9B%E8%A7%84%E4%BE%8B/%E6%AF%94%E8%B5%9B%E8%A7%84%E4%BE%8B_2017.pdf#page=5) 第 4 頁第二節第 7 條。 |
| 8：占位、吃子 | 不占己子位置；吃敵子後移除敵子並占位。 | [AXF](https://asianxiangqi.org/%E6%AF%94%E8%B5%9B%E8%A7%84%E4%BE%8B/%E6%AF%94%E8%B5%9B%E8%A7%84%E4%BE%8B_2017.pdf#page=5) 第 4 頁第二節第 8 條。 |
| 9：將帥安全 | 不無遮擋對面；須解將，不送將。 | [AXF](https://asianxiangqi.org/%E6%AF%94%E8%B5%9B%E8%A7%84%E4%BE%8B/%E6%AF%94%E8%B5%9B%E8%A7%84%E4%BE%8B_2017.pdf#page=5) 第 4 頁第二節第 9–10 條；第 5 頁第三節第 5 條。 |

結論：這九條未發現與所核對 AXF 條文衝突的基本走子錯誤。AXF 對實體比賽中已離手的送將有判負處置；App 在操作或重播時先拒絕非法著法，是產品的合法性處理，不等同實作完整裁判流程。

## 循環棋例不可混用

AXF 2017 第 13 頁第三節第 2 條，以及第 15–16 頁的長殺細則與例圖，允許相應長殺循環，不能把長殺一律寫成禁止。官方摘要有同一方向的說明。[AXF 正文](https://asianxiangqi.org/%E6%AF%94%E8%B5%9B%E8%A7%84%E4%BE%8B/%E6%AF%94%E8%B5%9B%E8%A7%84%E4%BE%8B_2017.pdf#page=14)、[AXF 摘要](https://www.asianxiangqi.org/axf_rules.htm)

WXF 官方介紹明說其以 AXF 第四次修訂本為基礎，但這不能推出兩版所有細則相同。循環判決需要明確規例版本與完整歷史；不能將未核對的 CCA 2020 概括結論套到 AXF／WXF 情境。[WXF 官方沿革](https://www.wxf-xiangqi.org/index.php?Itemid=291&catid=133&id=269%3Aworld-xiangqi-rules-introductionen&lang=en&layout=default&option=com_content&view=article)

## 官方棋規、程式事實與模型推論的分界

- 「本次輪走方依局面資料」「紅黑前進方向不得混用」是將官方輪走／走子規則套到本次 FEN 的程式要求。
- `formatXiangqiKnowledgeForPrompt` 的「從棋規到本局解釋」屬產品證據契約：限定同一變例的合法重播、步數身分、實際吃子／反吃、交換與可觀察子數。這些限制不可署名為 AXF 已證明本局評價。
- 本次可確認的是基本規則文字與來源；某一步吃子不自動證明淨賺，某條有限主線也不證明所有合理應對。剩餘子數、交換次序與推論是否適用，須另外由實際棋盤重播及正式驗證路徑檢查。
- 「控制中央」「取得主動」「引擎首選目的」仍是依主線與局面作出的模型解釋。一般術語、有效引用、引擎分差或來源可信，都不能單獨證明這些判斷已成立。

可信度：基本走子文字核對為高；所有比賽循環裁判、全部本機術語與正式生成品質不在本次已完成的核對範圍。後續驗收仍須分開記錄離線測試、真實 provider 回答與候選 binary 操作結果。
