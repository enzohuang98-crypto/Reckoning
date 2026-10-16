/** v2 解說管線的時間與呼叫預算（每題一般 1 次呼叫，上限 3 次）。 */
export const MAX_CALLS = 3
/** 單次模型呼叫上限。 */
export const CALL_TIMEOUT_MS = 60_000
/** 整題總截止；必須早於 renderer 的 120 秒硬截止。 */
export const TOTAL_DEADLINE_MS = 110_000
/** 串流閒置上限（由支援串流的 provider 自行執行，例如 OpenRouter）。 */
export const STREAM_IDLE_MS = 30_000
/** 自動修正或備援至少要有這麼多剩餘時間，否則直接交付引擎摘要。 */
export const MIN_RETRY_WINDOW_MS = 15_000
/** 主線不足時補算一次引擎的上限。 */
export const ENSURE_LINES_ENGINE_MS = 2_500

export const VISIBLE_TOKENS = {
  move: 1_600,
  position: 1_400,
  question: 800
} as const
