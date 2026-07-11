/**
 * 本機象棋知識庫。
 *
 * 目的不是取代引擎，而是把穩定的術語定義、使用條件與教練判斷框架放在程式內，
 * 讓較小的語言模型不必每次重新猜詞義。任何「這一盤確實形成某戰術」的結論，
 * 仍必須由引擎主線或可驗證棋盤事實支持。
 *
 * 主要資料來源（定義均重新整理、沒有逐字複製）：
 * - 中國象棋協會審定《象棋競賽規則（2020 版）》第 24 條
 * - 世界象棋聯合會（WXF）棋子、棋盤與記譜資料
 * - 公開的中國象棋術語分類與常見教學用語
 */

export type XiangqiKnowledgeCategory =
  | 'official_rule'
  | 'board'
  | 'piece_state'
  | 'tactic'
  | 'mate_pattern'
  | 'opening'
  | 'strategy'
  | 'endgame'
  | 'notation'

export interface XiangqiKnowledgeEntry {
  id: string
  term: string
  aliases: readonly string[]
  category: XiangqiKnowledgeCategory
  definition: string
  coachingUse: string
  /** 防止模型只看到名詞就反推本局已成立。 */
  evidenceRule: string
}

function knowledge(
  id: string,
  term: string,
  aliases: readonly string[],
  category: XiangqiKnowledgeCategory,
  definition: string,
  coachingUse: string,
  evidenceRule = '只有棋盤或引擎主線直接呈現此條件時，才能把它寫成本局結論。'
): XiangqiKnowledgeEntry {
  return { id, term, aliases, category, definition, coachingUse, evidenceRule }
}

export const XIANGQI_KNOWLEDGE_BASE: readonly XiangqiKnowledgeEntry[] = [
  knowledge('rule-check', '將軍', ['将军', '將', '照將', '照将'], 'official_rule', '走子後直接攻擊對方將帥。', '說明對手必須立即應將，其他計畫通常要暫停。'),
  knowledge('rule-mate-threat', '殺', ['杀', '叫殺', '叫杀', '做殺', '做杀'], 'official_rule', '走子後威脅下一著或連續將軍完成將死。', '區分立即將軍與下一步形成的殺棋威脅。'),
  knowledge('rule-chase', '捉', ['捉子', '追捉'], 'official_rule', '走子後形成下一著可實際得子的攻擊。', '指出被攻擊棋子、攻擊者與對方是否能安全解圍。'),
  knowledge('rule-exchange', '兌', ['兑', '邀兌', '邀兑'], 'official_rule', '以同兵種提出交換，接受交換不會讓接受方立即遭受額外子力損失。', '說明簡化局面、解除壓力或進入有利殘局。'),
  knowledge('rule-offer', '獻', ['献', '獻子', '献子'], 'official_rule', '主動把棋子送到可被吃的位置，對方吃後不會立即在子力上吃虧。', '和有計算依據的棄子區分；獻本身不代表一定正確。'),
  knowledge('rule-block', '攔', ['拦', '阻攔', '阻拦'], 'official_rule', '走子阻住對方棋子的通路，但本身不形成直接攻擊。', '說明線路被切斷或大子活動空間下降。'),
  knowledge('rule-follow', '跟', ['盯牽', '盯牵'], 'official_rule', '持續盯住有根棋子，但沒有形成可直接得子的攻擊。', '避免把一般跟隨誤寫成捉子。'),
  knowledge('rule-idle', '閒', ['闲', '閒著', '闲着'], 'official_rule', '不屬於將、殺、捉的著法；兌、獻、攔、跟通常歸在此類。', '棋例判斷使用，不等於棋力上的緩手。'),
  knowledge('rule-perpetual-check', '長將', ['长将'], 'official_rule', '同一方連續將軍形成規定次數的循環。', '提醒循環棋例限制，不能把長將當作永久和棋手段。'),
  knowledge('rule-perpetual-mate', '長殺', ['长杀'], 'official_rule', '同一方持續以殺著形成重複循環。', '用於棋例與變著責任判斷。'),
  knowledge('rule-perpetual-chase', '長捉', ['长捉'], 'official_rule', '同一方持續追捉一子或數子形成重複循環。', '用於判斷是否必須變著。'),
  knowledge('rule-forbidden-cycle', '禁止著法', ['禁止着法'], 'official_rule', '長將、長殺、長捉及其攻擊性組合所形成的禁例。', '引擎主線若出現循環，解說要提醒規則風險。'),
  knowledge('rule-rooted', '有根子', ['有根', '受保護子', '受保护子'], 'official_rule', '有己方其他棋子提供足夠保護的棋子。', '分析交換後能否反吃，以及攻擊是否真的能得子。'),
  knowledge('rule-unrooted', '無根子', ['无根子', '無根', '无根', '失根'], 'official_rule', '缺乏己方棋子有效保護的棋子。', '常是捉子、頓挫或先手攻擊的具體目標。'),
  knowledge('rule-underdefended', '少根子', ['少根', '保護不足', '保护不足'], 'official_rule', '保護力量少於攻擊力量，或保護者無法有效反吃的棋子。', '用攻擊者與防守者數量、釘住狀態具體說明。'),
  knowledge('rule-false-defender', '假根', ['假保護', '假保护'], 'official_rule', '表面有棋子保護，但保護者一動或反吃就造成送將等非法或致命後果。', '說明為何看似有根仍可能被捉。'),
  knowledge('rule-joint-attack', '聯合捉子', ['联合捉子', '聯捉', '联捉'], 'official_rule', '兩個以上棋子共同形成的得子攻擊，缺少其中一子便不能成立。', '逐一指出參與攻擊的棋子與目標。'),
  knowledge('rule-self-mate', '自斃', ['自毙', '自殺', '自杀'], 'official_rule', '己方著法使自己進入無法合法應對的被殺或送將狀態。', '用於解釋表面將軍其實反而輸棋的特殊情形。'),
  knowledge('rule-stalemate', '困斃', ['困毙', '欠行'], 'official_rule', '輪到走棋的一方沒有合法著法；象棋規則判負。', '殘局分析不能套用西洋棋的和棋規則。'),

  knowledge('board-back-rank', '底線', ['底线'], 'board', '本方最靠後、開局擺放車馬相士將的一條橫線。', '說明沉底攻擊、底線防守與將帥退路。'),
  knowledge('board-second-rank', '底二路', ['底二线', '下二路'], 'board', '從本方底線向前數第二條橫線。', '常用於描述車炮橫向活動與防守層次。'),
  knowledge('board-palace-top', '宮頂線', ['宫顶线', '分津線', '分津线'], 'board', '九宮頂端所在的橫線。', '說明攻方大子壓近九宮的距離。'),
  knowledge('board-pawn-rank', '兵行線', ['兵行线', '卒林線', '卒林线'], 'board', '開局兵卒所在的橫線。', '判斷高兵、低兵及大子是否深入。'),
  knowledge('board-river-bank', '河界線', ['河界线', '河沿'], 'board', '雙方領域交界的橫線。', '描述巡河、騎河、過河與子力活動半徑。'),
  knowledge('board-edge-file', '邊線', ['边线', '邊路', '边路'], 'board', '棋盤最外側的一路與九路。', '判斷邊子活動空間與攻防方向。'),
  knowledge('board-rib-file', '肋道', ['肋線', '肋线', '四路', '六路'], 'board', '九宮兩側的四、六路縱線，是車炮攻王的重要通道。', '具體說明肋車、肋炮與九宮側翼壓力。'),
  knowledge('board-center-file', '中線', ['中线', '中路', '五路'], 'board', '棋盤中央的五路縱線。', '說明中炮、空頭炮、將帥對臉與中路控制。'),
  knowledge('board-palace', '九宮', ['九宫', '宮區', '宫区'], 'board', '將帥與士活動的九個交叉點區域。', '王區安全的核心範圍。'),
  knowledge('board-palace-center', '宮心', ['宫心', '花心'], 'board', '九宮中央交叉點。', '判斷花心士、花心車兵與剜心戰術。'),
  knowledge('board-waist-point', '腰點', ['腰点'], 'board', '宮心左右相鄰的要點，可影響上下象的聯絡。', '說明象路被切斷與九宮側翼弱點。'),
  knowledge('board-own-river', '巡河', ['巡河車', '巡河车', '巡河炮'], 'board', '棋子位於己方河界線。', '通常兼顧橫向控制、保兵與轉移。'),
  knowledge('board-enemy-river', '騎河', ['骑河', '騎河車', '骑河车'], 'board', '棋子位於對方河界線。', '表示棋子更深入，但也要檢查退路與被趕風險。'),

  knowledge('pawn-crossed', '過河兵', ['过河兵', '過河卒', '过河卒'], 'piece_state', '已越過己方河界的兵卒，可以橫走。', '衡量空間、限制敵子與殘局價值。'),
  knowledge('pawn-high', '高兵', ['高卒'], 'piece_state', '尚未低於對方兵卒林的過河兵卒。', '通常仍保有前進空間與較高牽制價值。'),
  knowledge('pawn-low', '低兵', ['低卒'], 'piece_state', '已深入對方兵卒林以下但尚未到底線的兵卒。', '接近九宮但路線可能變窄，要看是否有大子配合。'),
  knowledge('pawn-bottom', '底兵', ['底卒', '老兵', '老卒'], 'piece_state', '到達對方底線的兵卒。', '不能再前進，價值主要來自橫向牽制與配合。'),
  knowledge('pawn-brothers', '兄弟兵', ['兄弟卒', '聯兵', '联兵'], 'piece_state', '相鄰並能互相呼應的兩個兵卒。', '說明彼此保護、限制線路與殘局推進。'),
  knowledge('pawn-facing', '對頭兵', ['对头兵', '對頭卒', '对头卒'], 'piece_state', '雙方未過河兵卒在同一路相向阻擋。', '分析兌兵後線路開放與先後手。'),
  knowledge('pawn-palace-center', '花心兵', ['花心卒'], 'piece_state', '進入對方宮心的兵卒。', '通常限制將帥與士的活動，需配合其他子力才成殺勢。'),
  knowledge('pawn-throat', '咽喉兵', ['咽喉卒'], 'piece_state', '接近九宮中路、卡住將帥活動的兵卒。', '指出它限制的逃路與配合攻子。'),
  knowledge('rook-rib', '肋車', ['肋车'], 'piece_state', '位於四路或六路肋道的車。', '常直接壓九宮側翼或牽制士。'),
  knowledge('rook-bottom', '沉底車', ['沉底车', '底車', '底车'], 'piece_state', '深入對方底線的車。', '檢查是否有橫將、吃士象或配合炮馬的威脅。'),
  knowledge('rook-close', '貼身車', ['贴身车'], 'piece_state', '緊貼敵方將帥附近的車。', '威力大但要驗證是否有保護與安全退路。'),
  knowledge('rook-active', '高頭車', ['高头车', '明車', '明车'], 'piece_state', '位置開揚、能快速轉線參戰的車。', '比較兩條線時可作為子力活躍度的具體依據。'),
  knowledge('rook-passive', '低頭車', ['低头车', '暗車', '暗车'], 'piece_state', '受自家棋子阻擋、需要額外手數才能參戰的車。', '說明出車延誤與陣形擁塞。'),
  knowledge('rook-doubled', '重線車', ['同線車', '同线车', '霸王車', '霸王车'], 'piece_state', '雙車在同一橫線或縱線互相支援。', '說明線路壓力與交換次序。'),
  knowledge('rook-pinned', '守喪車', ['守丧车'], 'piece_state', '因必須守住要點或棋子而難以活動的車。', '指出牽制來源，不能只貼「車被困」標籤。'),
  knowledge('horse-screen', '屏風馬', ['屏风马'], 'piece_state', '雙馬向內發展形成互相呼應的開局骨架。', '說明穩健出子、中路防守與反擊基礎。'),
  knowledge('horse-river', '盤河馬', ['盘河马'], 'piece_state', '馬發展到靠近河界的三路或七路要點。', '通常積極但要檢查馬腿與對方兵卒衝擊。'),
  knowledge('horse-fishing', '釣魚馬', ['钓鱼马'], 'piece_state', '馬深入敵方三、七路附近，配合其他子攻擊九宮。', '指出其控制的將帥逃路與配合子。'),
  knowledge('horse-high-fishing', '高釣馬', ['高钓马', '側面虎', '侧面虎'], 'piece_state', '馬位於更高的卒林附近，從側面壓迫九宮。', '檢查是否有車炮配合與馬腿安全。'),
  knowledge('horse-groove', '臥槽馬', ['卧槽马', '臥槽', '卧槽'], 'piece_state', '馬進入敵方底二路靠近九宮的槽位，常形成將軍或抽車。', '必須指出馬控制的宮內點與配合攻子。'),
  knowledge('horse-center', '窩心馬', ['窝心马', '歸心馬', '归心马'], 'piece_state', '馬位於己方九宮中心附近，常阻礙將帥與士象。', '說明陣形擁塞、馬路或王區風險。'),
  knowledge('horse-chain', '連環馬', ['连环马', '拐子馬', '拐子马'], 'piece_state', '兩馬互相保護。', '分析交換與突破時指出保護關係。'),
  knowledge('horse-blocked', '蹩馬腿', ['蹩马腿', '絆馬腿', '绊马腿', '馬腿', '马腿'], 'piece_state', '馬的必要鄰接點被棋子占住，該方向不能跳。', '指出是哪一格堵住哪匹馬，不要只說馬受限。'),
  knowledge('elephant-eye', '塞象眼', ['堵象眼', '塞相眼', '象眼', '相眼'], 'piece_state', '象相斜走中點被占住，該方向不能走。', '指出被堵的中點與受影響的防守聯絡。'),
  knowledge('cannon-empty-center', '空頭炮', ['空头炮', '空心炮'], 'piece_state', '中炮與敵將帥同線，中間缺少常規遮擋，形成強烈中路壓力。', '驗證炮架、將帥位置與合法應對後再下結論。'),
  knowledge('cannon-double', '重炮', ['雙炮疊線', '双炮叠线'], 'piece_state', '兩炮在同一路前後配合，前炮可作後炮炮架。', '說明將軍線、炮架與解殺方式。'),
  knowledge('cannon-linked', '擔桿炮', ['担杆炮', '擔子炮', '担子炮'], 'piece_state', '兩炮隔一己子互相呼應。', '分析中間子被牽制或移開後炮線變化。'),

  knowledge('tactic-pin', '牽制', ['牵制', '釘住', '钉住'], 'tactic', '利用更大威脅使某棋子不能自由移動。', '必須指出被牽制子、它保護的目標與移動後後果。'),
  knowledge('tactic-blockade', '封鎖', ['封锁', '堵截'], 'tactic', '控制關鍵格或線路，使敵子難以前進或轉移。', '指出被封的格、線或棋子。'),
  knowledge('tactic-interference', '攔截', ['拦截'], 'tactic', '插入棋子切斷攻守雙方的聯絡。', '說明原先哪兩子相連、攔截後失去什麼。'),
  knowledge('tactic-obstruction', '堵塞', ['壅塞'], 'tactic', '迫使或利用棋子占住己方需要的通路或逃路。', '指出堵住的線路、馬腿、象眼或將帥出口。'),
  knowledge('tactic-discovered', '閃擊', ['闪击'], 'tactic', '移開前方棋子，露出後方車炮的攻擊線。', '指出移開子、露出的攻擊子與目標。'),
  knowledge('tactic-discovered-check', '閃將', ['闪将'], 'tactic', '移開棋子後由後方棋子形成將軍。', '要區分移動棋子本身將軍或後方棋子將軍。'),
  knowledge('tactic-skewer-check', '抽將', ['抽将', '將軍抽子', '将军抽子'], 'tactic', '以將軍取得先手，下一著再吃另一重要棋子。', '指出被抽的棋子以及對方為何不能同時兼顧。'),
  knowledge('tactic-fork', '捉雙', ['捉双', '雙重威脅', '双重威胁'], 'tactic', '一著同時攻擊兩個目標。', '列出兩個目標及對方可否一次化解。'),
  knowledge('tactic-deflection', '引離', ['引离'], 'tactic', '迫使防守子離開關鍵位置。', '指出被引走的防守者及離開後暴露的目標。'),
  knowledge('tactic-attraction', '吸引', ['誘入', '诱入'], 'tactic', '把敵子引到可被攻擊、堵塞或形成殺棋的位置。', '指出誘入點與後續利用。'),
  knowledge('tactic-clearance', '騰挪', ['腾挪', '騰位', '腾位'], 'tactic', '移開己子讓出線路、格位或炮架。', '說明讓出的空間被哪個棋子使用。'),
  knowledge('tactic-zwischenzug', '頓挫', ['顿挫', '中間著', '中间着'], 'tactic', '在預期交換前插入更強迫的將、殺或捉。', '列出正常交換順序與插入著的作用。'),
  knowledge('tactic-sacrifice', '棄子', ['弃子', '棄車', '弃车', '棄馬', '弃马'], 'tactic', '主動犧牲子力換取將殺、得回更多子力、先手或結構利益。', '必須沿主線算到補償出現，不能只因引擎推薦就稱妙棄。'),
  knowledge('tactic-remove-defender', '消除防守', ['去除防守', '拔根'], 'tactic', '先交換或攻擊關鍵防守子，再利用暴露目標。', '指出防守者、被保護目標與消除後的具體著法。'),
  knowledge('tactic-overload', '過度負擔', ['过度负担', '超載', '超载'], 'tactic', '同一棋子同時承擔多個防守任務，無法全部兼顧。', '列出它同時守護的對象。'),
  knowledge('tactic-line-opening', '開線', ['开线', '打通線路', '打通线路'], 'tactic', '交換或移子後打通車炮的橫線或縱線。', '指出開的是哪一線以及進入該線的棋子。'),
  knowledge('tactic-simplify', '簡化', ['简化', '兌子簡化', '兑子简化'], 'tactic', '透過交換減少子力與變化。', '說明簡化後的殘局是否更容易控制，而不是假定交換必然好。'),
  knowledge('tactic-counter', '反擊', ['反击', '反先'], 'tactic', '在防守中製造更迫切的反威脅，重新奪回節奏。', '指出反擊目標及對方是否被迫回應。'),

  knowledge('mate-facing-kings', '對面笑', ['对面笑', '白臉將', '白脸将'], 'mate_pattern', '利用將帥同線與中間無子形成的限制或殺棋。', '必須驗證將帥同線與中間遮擋。'),
  knowledge('mate-double-rook', '雙車錯', ['双车错'], 'mate_pattern', '雙車交替控制橫縱線，逐步壓縮將帥活動。', '指出兩車各控制的線與將帥退路。'),
  knowledge('mate-rook-advisor', '雙車脅士', ['双车胁士'], 'mate_pattern', '雙車利用九宮士位與底線形成攻殺。', '確認雙車位置、士位與將帥可走格。'),
  knowledge('mate-corner-horse', '掛角馬', ['挂角马', '士角馬', '士角马'], 'mate_pattern', '馬進士角附近將軍，控制九宮特定逃路。', '指出馬控制點及配合車炮。'),
  knowledge('mate-octagon-horse', '八角馬', ['八角马'], 'mate_pattern', '掛角馬把將帥逼到對角位置後形成的控制網。', '需要主線證明將帥被迫到指定位置。'),
  knowledge('mate-horse-cannon', '馬後炮', ['马后炮'], 'mate_pattern', '馬控制將帥逃路並作炮架，炮在馬後同線將軍。', '確認馬的控制點、炮架與炮線。'),
  knowledge('mate-heaven-earth-cannon', '天地炮', ['天地炮'], 'mate_pattern', '兩炮分居中路高低位置，配合控制將帥與底線。', '指出兩炮的位置、炮架及被封逃路。'),
  knowledge('mate-smothered-palace', '悶宮', ['闷宫'], 'mate_pattern', '利用九宮內己方棋子堵住將帥，外部將軍完成殺棋。', '列出被己子堵住的逃路。'),
  knowledge('mate-smothered', '悶殺', ['闷杀'], 'mate_pattern', '將帥因周圍格位被封而無法逃脫的殺棋總稱。', '逐格確認逃路、吃將子與墊子可能。'),
  knowledge('mate-double-check', '雙將', ['双将', '雙重將軍', '双重将军'], 'mate_pattern', '一著同時由兩個棋子將軍，通常只能移將應對。', '指出兩個將軍來源。'),
  knowledge('mate-iron-gate', '鐵門栓', ['铁门栓', '鐵門閂', '铁门闩'], 'mate_pattern', '車炮等子力封住九宮要道，使將帥缺少解殺空間。', '指出被封的肋道、中路或士位。'),
  knowledge('mate-two-ghosts', '二鬼拍門', ['二鬼拍门'], 'mate_pattern', '兩個車兵類重子逼近九宮兩側形成夾擊。', '指出兩個攻子與將帥被壓縮的路線。'),
  knowledge('mate-heart-cut', '大膽穿心', ['大胆穿心', '大刀剜心'], 'mate_pattern', '以車等大子強入宮心吃士，破壞九宮防線。', '必須算清犧牲後是否形成將殺或足夠補償。'),
  knowledge('mate-three-side', '三子歸邊', ['三子归边'], 'mate_pattern', '三個攻子集中在同一側翼對王區形成合力。', '列出三子、集中側與具體威脅。'),
  knowledge('mate-rook-cannon-sandwich', '夾車炮', ['夹车炮', '車夾炮', '车夹炮'], 'mate_pattern', '車炮沿線交錯配合，利用炮架或封線攻王。', '指出車、炮、炮架與攻擊線。'),
  knowledge('mate-seabed-moon', '海底撈月', ['海底捞月'], 'mate_pattern', '車炮對單車等殘局中，以中路控制與底線配合取勝的典型手法。', '不能僅憑子力配置宣告例勝，需有具體主線。'),
  knowledge('mate-cannon-grind', '炮碾丹砂', ['炮碾丹沙'], 'mate_pattern', '炮借連續將軍與炮架反覆侵襲士象的攻殺手法。', '指出每次炮架、應將與被吃防守子。'),

  knowledge('opening-central-cannon', '中炮', ['當頭炮', '当头炮'], 'opening', '首階段以炮占中路，直接對準中卒與將帥。', '說明中路壓力、出車路線與對手防守，而非只說攻勢強。'),
  knowledge('opening-screen-horses', '屏風馬布局', ['屏风马布局'], 'opening', '雙馬自然發展、兼顧中卒與兩翼的防守反擊體系。', '指出雙馬位置及後續出車、挺卒計畫。'),
  knowledge('opening-counter-palace-horse', '反宮馬', ['反宫马', '夾炮屏風', '夹炮屏风'], 'opening', '雙正馬配合士角炮的防守反擊陣式。', '說明炮位如何支援出子與中路。'),
  knowledge('opening-same-side-cannon', '順炮', ['顺炮', '順手炮', '顺手炮'], 'opening', '後手以同方向中炮回應先手中炮。', '常進入快速出車與中路對攻，要看具體次序。'),
  knowledge('opening-opposite-cannon', '列炮', ['列手炮'], 'opening', '後手以相反方向中炮回應。', '說明兩翼車路與中路攻防差異。'),
  knowledge('opening-elephant', '飛相局', ['飞相局'], 'opening', '首著飛相，先穩固防守再選擇出子方向。', '評估彈性、先手轉換與是否給對手從容部署。'),
  knowledge('opening-pawn', '仙人指路', ['兵七進一', '兵三進一'], 'opening', '以挺三路或七路兵開局，保留轉入多種體系的彈性。', '指出限制對方馬與後續轉型。'),
  knowledge('opening-palace-cannon', '過宮炮', ['过宫炮'], 'opening', '炮先平到士角另一側，兼顧出子與側翼控制。', '說明炮位、車路和中路取捨。'),
  knowledge('opening-advisor-cannon', '士角炮', ['仕角炮'], 'opening', '炮先到士角位置，支援正馬與後續反擊。', '指出與反宮馬或其他陣式的銜接。'),
  knowledge('opening-single-horse', '單提馬', ['单提马'], 'opening', '一馬正起、另一馬暫緩或走邊的開局架構。', '比較未發展馬、車路與中路防守。'),
  knowledge('opening-three-step-horse', '三步虎', ['三步虎'], 'opening', '以馬、炮、車快速完成一翼部署的陣式。', '指出部署側與另一翼可能落後。'),
  knowledge('opening-five-seven-cannon', '五七炮', ['五七炮'], 'opening', '中炮配合七路炮的雙炮配置。', '說明對馬、卒林與兩翼的壓力。'),
  knowledge('opening-five-six-cannon', '五六炮', ['五六炮'], 'opening', '中炮配合六路炮，通常兼顧中路與穩健出子。', '指出炮位如何保馬或準備出車。'),
  knowledge('opening-five-eight-cannon', '五八炮', ['五八炮'], 'opening', '中炮配合八路炮，常針對屏風馬形成側翼壓力。', '需依具體馬卒配置說明。'),
  knowledge('opening-cross-horses', '盤頭馬', ['盘头马', '中兵盤頭馬', '中兵盘头马'], 'opening', '中兵推進並讓雙馬向中路集中支援的進攻架構。', '檢查中兵根基、馬路與王區反擊風險。'),
  knowledge('opening-mandarin-duck-cannon', '鴛鴦炮', ['鸳鸯炮'], 'opening', '雙炮在一側前後或高低配合的防守反擊陣式。', '指出炮架、出車和被壓制一側。'),

  knowledge('strategy-development', '出子', ['發展子力', '发展子力', '部署'], 'strategy', '把開局受阻的車馬炮移到能參戰的位置。', '比較完成部署所需手數與是否帶威脅。'),
  knowledge('strategy-rook-activation', '亮車', ['亮车', '出車', '出车'], 'strategy', '打通車路，讓車能沿橫縱線活動。', '指出是哪個棋子移開以及車獲得哪條線。'),
  knowledge('strategy-initiative', '先手', ['主動', '主动'], 'strategy', '著法帶有必須回應的威脅，使己方能連續推進計畫。', '必須指出具體威脅和被迫回應；不能只憑分數稱有先手。'),
  knowledge('strategy-loss-tempo', '失先', ['失去先手', '丟先', '丢先'], 'strategy', '原有的強迫節奏消失，讓對手取得完成計畫的時間。', '指出哪一手沒有威脅、對手因此多做了哪一步。'),
  knowledge('strategy-tempo', '搶先', ['抢先', '爭先', '争先'], 'strategy', '利用著法次序比對手更早完成關鍵部署或威脅。', '比較兩條主線到同一目標各需幾手。'),
  knowledge('strategy-coordination', '子力協調', ['子力协调', '呼應', '呼应'], 'strategy', '棋子互相保護並能共同攻守同一區域。', '列出互相支援的棋子與共同目標。'),
  knowledge('strategy-mobility', '子力活動度', ['活動度', '活动度', '棋子受限'], 'strategy', '棋子可用的安全格、線路與轉移能力。', '以具體受阻線、馬腿、象眼或可走格說明。'),
  knowledge('strategy-space', '空間', ['空间'], 'strategy', '己方棋子可安全活動、前進與轉線的範圍。', '指出控制的格線與被壓縮的棋子。'),
  knowledge('strategy-king-safety', '王區安全', ['王区安全', '九宮安全', '九宫安全'], 'strategy', '將帥周圍守子、逃路與敵方攻線的綜合狀態。', '至少說明士象、開線、將軍或逃路之一。'),
  knowledge('strategy-formation', '陣形', ['阵形', '陣型', '阵型'], 'strategy', '棋子位置形成的攻守結構與彼此聯絡。', '指出哪幾子脫節、擁塞或形成有效配置。'),
  knowledge('strategy-control', '控盤', ['局面控制', '可控性'], 'strategy', '能以清楚計畫限制對手反擊，並維持可預期的局面走向。', '比較強迫著比例、對手反擊、分支數與容錯，不可只看分數。'),
  knowledge('strategy-forcing', '強迫著', ['强迫着', '逼著', '逼着'], 'strategy', '將、殺、直接得子等使對手選擇明顯受限的著法。', '指出對手有哪些合法主要應對。'),
  knowledge('strategy-quiet', '緩手', ['缓手', '軟著', '软着'], 'strategy', '沒有及時處理局面要點，讓對手獲得完成計畫或反擊的時間。', '必須指出錯失機會、對手利用與具體後果。'),
  knowledge('strategy-prophylaxis', '預防著', ['预防着'], 'strategy', '提前限制對手計畫，而非立即製造戰術。', '指出被阻止的對手計畫，避免把任何安靜著都稱預防。'),
  knowledge('strategy-plan-switch', '攻守轉換', ['攻守转换'], 'strategy', '局面由進攻轉防守或由防守取得反擊節奏。', '指出轉折著與攻守責任如何改變。'),
  knowledge('strategy-human-control', '人類可控性', ['人类可控性', '容錯', '容错'], 'strategy', '一條主線對人類而言是否容易理解、維持與修正，取決於強迫程度、分支、戰術精度、王區風險與可逆性。', '不能由單一引擎分數決定；必須逐項比較兩條線。'),

  knowledge('endgame-full-guards', '士象全', ['仕相全'], 'endgame', '士與象相均完整的王區防守配置。', '仍需看位置與是否被牽制，不能只數棋子。'),
  knowledge('endgame-single-advisor', '單缺士', ['单缺士'], 'endgame', '雙象相完整但只剩一士仕的防守配置。', '說明缺口所在肋道與敵方攻子。'),
  knowledge('endgame-single-elephant', '單缺象', ['单缺象', '單缺相', '单缺相'], 'endgame', '雙士仕完整但只剩一象相的防守配置。', '說明中路、底線與另一側象眼。'),
  knowledge('endgame-theoretical-win', '例勝', ['例胜', '理論勝', '理论胜'], 'endgame', '在正確走法下攻方可強制取勝的典型子力局面。', '必須符合具體子力與位置條件，不能只看名稱。'),
  knowledge('endgame-theoretical-draw', '例和', ['理論和', '理论和'], 'endgame', '在正確防守下弱方可守和的典型局面。', '需檢查位置例外、先後手與規則限制。'),
  knowledge('endgame-zugzwang', '等著', ['等着', '待著', '待着'], 'endgame', '保留局面、把走子責任交給對方的調整手段。', '說明對方被迫動子後哪個防點會鬆動。'),
  knowledge('endgame-no-move', '欠行', ['無子可動', '无子可动'], 'endgame', '缺少安全可走著法的狀態，嚴重時形成困斃。', '列出候選著及其失敗原因。'),

  knowledge('notation-forward', '進', ['进'], 'notation', '棋子向對方方向移動。', '中文著法解析使用；車炮兵以步數，馬相士以到達路數表示。'),
  knowledge('notation-retreat', '退', ['退'], 'notation', '棋子向己方方向移動。', '中文著法解析使用。'),
  knowledge('notation-horizontal', '平', ['平'], 'notation', '棋子在同一橫線移動到另一條路。', '中文著法解析使用。'),
  knowledge('notation-front-rear', '前後子記法', ['前后子记法', '前車', '后车', '前炮', '後炮'], 'notation', '同一路有兩個同兵種棋子時，以前後區分。', '避免把同名棋子的著法對錯對象。')
] as const

const CATEGORY_HINTS: Record<XiangqiKnowledgeCategory, readonly string[]> = {
  official_rule: ['規則', '规则', '循環', '循环', '長將', '长将', '困斃', '困毙'],
  board: ['位置', '線路', '线路', '九宮', '九宫', '河界', '中路', '肋道'],
  piece_state: ['棋子', '受限', '活動', '活动', '馬', '马', '炮', '車', '车', '兵', '卒'],
  tactic: ['戰術', '战术', '得子', '失子', '威脅', '威胁', '交換', '牽制', '牵制'],
  mate_pattern: ['殺棋', '杀棋', '將死', '将死', '王區', '王区', '九宮', '九宫'],
  opening: ['開局', '开局', '布局', '佈局', '出子', '部署'],
  strategy: ['目的', '計畫', '计划', '先手', '控盤', '控盘', '容錯', '容错', '陣形', '阵形'],
  endgame: ['殘局', '残局', '例勝', '例胜', '例和', '士象'],
  notation: ['記譜', '记谱', '中文著法', '进', '退', '平']
}

const DEFAULT_CORE_IDS = new Set([
  'strategy-development',
  'strategy-initiative',
  'strategy-loss-tempo',
  'strategy-coordination',
  'strategy-mobility',
  'strategy-king-safety',
  'strategy-formation',
  'strategy-human-control',
  'tactic-pin',
  'tactic-fork',
  'rule-rooted',
  'rule-unrooted'
])

function normalizeSearchText(value: string): string {
  return value.toLocaleLowerCase('zh-TW').replace(/\s+/g, '')
}

/**
 * 只取與問題最相關的小段知識，不把整本詞彙表塞進 prompt。
 * 這同時降低 token 成本，也避免小模型被大量不相關術語干擾。
 */
export function selectXiangqiKnowledge(
  query: string,
  options: {
    categories?: readonly XiangqiKnowledgeCategory[]
    includeCore?: boolean
    limit?: number
  } = {}
): XiangqiKnowledgeEntry[] {
  const normalized = normalizeSearchText(query)
  const categoryFilter = options.categories
    ? new Set(options.categories)
    : null
  const scored = XIANGQI_KNOWLEDGE_BASE.map((entry, index) => {
    if (categoryFilter && !categoryFilter.has(entry.category)) {
      return { entry, index, score: -1 }
    }
    let score = 0
    for (const name of [entry.term, ...entry.aliases]) {
      if (name.length >= 2 && normalized.includes(normalizeSearchText(name))) {
        score += name === entry.term ? 12 : 8
      }
    }
    if (
      CATEGORY_HINTS[entry.category].some((hint) =>
        normalized.includes(normalizeSearchText(hint))
      )
    ) {
      score += 2
    }
    if (options.includeCore !== false && DEFAULT_CORE_IDS.has(entry.id)) score += 1
    return { entry, index, score }
  })
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score || a.index - b.index)

  return scored.slice(0, options.limit ?? 18).map((item) => item.entry)
}

export function formatXiangqiKnowledgeForPrompt(
  entries: readonly XiangqiKnowledgeEntry[]
): string {
  if (entries.length === 0) return ''
  return [
    '【本機象棋知識：只協助解釋術語，不得冒充引擎證據】',
    ...entries.map(
      (entry) =>
        `- ${entry.term}：${entry.definition} 教練用途：${entry.coachingUse} 證據限制：${entry.evidenceRule}`
    )
  ].join('\n')
}

export function findXiangqiKnowledgeEntry(
  termOrAlias: string
): XiangqiKnowledgeEntry | undefined {
  const normalized = normalizeSearchText(termOrAlias)
  return XIANGQI_KNOWLEDGE_BASE.find((entry) =>
    [entry.term, ...entry.aliases].some(
      (name) => normalizeSearchText(name) === normalized
    )
  )
}
