import { useEffect, useMemo, useState } from 'react'
import { buildPvReplay } from '@shared/logic/board/PvReplay'
import type { BoardState } from '@shared/types/BoardState'
import type { EngineCandidateMove } from '@shared/types/EngineAnalysis'
import { XiangqiBoard } from '../board/XiangqiBoard'

interface Props {
  initialBoard: BoardState
  candidates: EngineCandidateMove[]
  onClose: () => void
}

export function PvReplayDialog({ initialBoard, candidates, onClose }: Props): JSX.Element {
  const [candidateIndex, setCandidateIndex] = useState(0)
  const [stepIndex, setStepIndex] = useState(0)
  const candidate = candidates[candidateIndex] ?? candidates[0]
  const replay = useMemo(
    () =>
      buildPvReplay(
        initialBoard,
        candidate?.principalVariation ?? [],
        candidate?.displayPrincipalVariation ?? []
      ),
    [candidate, initialBoard]
  )
  const safeStepIndex = Math.min(stepIndex, replay.boards.length - 1)
  const currentBoard = replay.boards[safeStepIndex] ?? initialBoard

  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', closeOnEscape)
    return () => window.removeEventListener('keydown', closeOnEscape)
  }, [onClose])

  const selectCandidate = (index: number): void => {
    setCandidateIndex(index)
    setStepIndex(0)
  }

  return (
    <div className="pv-replay-backdrop" role="presentation" onMouseDown={onClose}>
      <section
        className="pv-replay-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="pv-replay-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="pv-replay-heading">
          <div>
            <span className="eyebrow">ENGINE LINE</span>
            <h2 id="pv-replay-title">查看引擎想法</h2>
          </div>
          <button type="button" className="btn ghost small" onClick={onClose}>关闭</button>
        </div>

        {candidates.length > 1 && (
          <div className="pv-replay-candidates" role="tablist" aria-label="候选主线">
            {candidates.map((item, index) => (
              <button
                key={`${item.move}-${index}`}
                type="button"
                role="tab"
                aria-selected={candidateIndex === index}
                className={candidateIndex === index ? 'active' : ''}
                onClick={() => selectCandidate(index)}
              >
                第 {index + 1} 线 · {item.displayMove ?? item.move} · {item.score?.displayText ?? '—'}
              </button>
            ))}
          </div>
        )}

        <div className="pv-replay-board">
          <XiangqiBoard
            grid={currentBoard.grid}
            highlightedMove={safeStepIndex > 0 ? replay.steps[safeStepIndex - 1]?.uci : null}
          />
        </div>

        <div className="pv-replay-controls">
          <button
            type="button"
            className="btn ghost"
            disabled={safeStepIndex === 0}
            onClick={() => setStepIndex((current) => Math.max(0, current - 1))}
          >
            ← 上一步
          </button>
          <span>
            {safeStepIndex === 0
              ? '起始局面'
              : `第 ${safeStepIndex} 手：${replay.steps[safeStepIndex - 1]?.display}`}
          </span>
          <button
            type="button"
            className="btn"
            disabled={safeStepIndex >= replay.steps.length}
            onClick={() =>
              setStepIndex((current) => Math.min(replay.steps.length, current + 1))
            }
          >
            下一步 →
          </button>
        </div>

        <div className="pv-replay-line" aria-label="完整引擎主线">
          {replay.steps.map((step, index) => (
            <button
              key={`${step.uci}-${index}`}
              type="button"
              className={safeStepIndex === index + 1 ? 'active' : ''}
              onClick={() => setStepIndex(index + 1)}
            >
              {index + 1}. {step.display}
            </button>
          ))}
        </div>
        {replay.warning && <p className="error-text small">{replay.warning}</p>}
      </section>
    </div>
  )
}
