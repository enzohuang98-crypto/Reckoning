import type { BoardState } from '../../types/BoardState'

export interface BoardTimeline {
  entries: BoardState[]
  index: number
}

const MAX_BOARD_HISTORY = 100

export function createBoardTimeline(initial: BoardState): BoardTimeline {
  return { entries: [initial], index: 0 }
}

export function commitBoard(
  timeline: BoardTimeline,
  board: BoardState
): BoardTimeline {
  if (timeline.entries[timeline.index]?.fen === board.fen) return timeline
  let entries = [...timeline.entries.slice(0, timeline.index + 1), board]
  if (entries.length > MAX_BOARD_HISTORY) {
    entries = entries.slice(entries.length - MAX_BOARD_HISTORY)
  }
  return { entries, index: entries.length - 1 }
}

export function undoBoard(timeline: BoardTimeline): BoardTimeline {
  return timeline.index === 0
    ? timeline
    : { ...timeline, index: timeline.index - 1 }
}

export function redoBoard(timeline: BoardTimeline): BoardTimeline {
  return timeline.index >= timeline.entries.length - 1
    ? timeline
    : { ...timeline, index: timeline.index + 1 }
}
