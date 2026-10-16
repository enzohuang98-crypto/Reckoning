/** v2 解說管線的時間與呼叫預算（每題一般 1 次呼叫，上限 3 次）。 */
export const MAX_CALLS = 3
/** 單次模型呼叫上限。 */
export const CALL_TIMEOUT_MS = 60_000
/** 整題總截止；必須早於 renderer 的 120 秒硬截止。 */
export const TOTAL_DEADLINE_MS = 110_000
/** 自動修正或備援至少要有這麼多剩餘時間，否則直接交付引擎摘要。 */
export const MIN_RETRY_WINDOW_MS = 15_000
/** 分鐘級限流且沒有備援時，同一模型重試前最多等這麼久（服務給的 Retry-After 更長就不重試）。 */
export const RATE_LIMIT_RETRY_MAX_WAIT_MS = 5_000

/** 主線不足時補算一次引擎的上限。 */
export const ENSURE_LINES_ENGINE_MS = 2_500

export const VISIBLE_TOKENS = {
  move: 1_600,
  position: 1_400,
  question: 800
} as const
