/** v2 解說管線的時間與呼叫預算（每題一般 1 次呼叫，上限 3 次）。 */
export const MAX_CALLS = 3
/** 單次模型呼叫上限。 */
export const CALL_TIMEOUT_MS = 60_000
/** 整題總截止；必須早於 renderer 的 120 秒硬截止。 */
export const TOTAL_DEADLINE_MS = 110_000
/** 自動修正或備援至少要有這麼多剩餘時間，否則直接交付引擎摘要。 */
export const MIN_RETRY_WINDOW_MS = 15_000
/** 分鐘級限流且沒有備援時，同一模型重試前最多等這麼久（服務給的 Retry-After 更長就不重試）。 */
// 實測（付費 Sonnet、沒有備援）：連按幾次「重試 AI」後服務回 429，等 5 秒內重試常常還沒解除，
// 整題就變成引擎摘要。寧可多等一點換到一份真正的回答：最多等 20 秒，沒給 Retry-After 時先等 8 秒。
export const RATE_LIMIT_RETRY_MAX_WAIT_MS = 20_000
/** 服務沒給 Retry-After 時，重試前預設等多久。 */
export const RATE_LIMIT_DEFAULT_WAIT_MS = 8_000

/** 主線不足時補算一次引擎的上限。 */
export const ENSURE_LINES_ENGINE_MS = 2_500

/** 關鍵著法檢查（三個「如果…」同時搜尋）每條的搜尋時間。 */
export const IDEA_PROBE_ENGINE_MS = 800
/** 關鍵著法檢查整體的上限（含啟動引擎）；超過就不附，解說照常進行。 */
export const IDEA_PROBE_DEADLINE_MS = 6_000

export const VISIBLE_TOKENS = {
  move: 1_600,
  position: 1_400,
  question: 800
} as const
