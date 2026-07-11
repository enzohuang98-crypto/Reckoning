import { useCallback, useState } from 'react'
import { parseFen } from '@shared/logic/fen'
import {
  commitBoard,
  createBoardTimeline,
  redoBoard,
  undoBoard
} from '@shared/logic/BoardTimeline'
import { START_FEN, type BoardState } from '@shared/types/BoardState'

function createInitialBoard(): BoardState {
  const parsed = parseFen(START_FEN)
  if (parsed.valid) return parsed.board
  throw new Error('內建開局 FEN 無效')
}

interface BoardWorkspace {
  board: BoardState
  canUndo: boolean
  canRedo: boolean
  changeBoard: (next: BoardState) => void
  undo: () => void
  redo: () => void
  restoreOriginal: () => void
}

export function useBoardWorkspace(): BoardWorkspace {
  const [timeline, setTimeline] = useState(() => createBoardTimeline(createInitialBoard()))
  const board = timeline.entries[timeline.index]

  const changeBoard = useCallback((next: BoardState): void => {
    setTimeline((current) => commitBoard(current, next))
  }, [])

  const undo = useCallback((): void => {
    setTimeline((current) => undoBoard(current))
  }, [])

  const redo = useCallback((): void => {
    setTimeline((current) => redoBoard(current))
  }, [])

  const restoreOriginal = useCallback((): void => {
    changeBoard(createInitialBoard())
  }, [changeBoard])

  return {
    board,
    canUndo: timeline.index > 0,
    canRedo: timeline.index < timeline.entries.length - 1,
    changeBoard,
    undo,
    redo,
    restoreOriginal
  }
}
