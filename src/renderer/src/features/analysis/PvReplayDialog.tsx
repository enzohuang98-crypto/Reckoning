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
  const [selectedMove, setSelectedMove] = useState<string | null>(
    () => candidates[0]?.move ?? null
  )
  const [candidateSnapshot, setCandidateSnapshot] = useState<EngineCandidateMove | null>(
    () => candidates[0] ?? null
  )
  const [stepIndex, setStepIndex] = useState(0)
  const selectedCandidateIndex = candidates.findIndex((item) => item.move === selectedMove)
  const liveCandidate = selectedCandidateIndex >= 0
    ? candidates[selectedCandidateIndex]
    : null
  const candidate = candidateSnapshot ?? liveCandidate ?? candidates[0]
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

  useEffect(() => {
    setSelectedMove(candidates[0]?.move ?? null)
    setCandidateSnapshot(candidates[0] ?? null)
    setStepIndex(0)
    // candidates 會隨同一局面的搜尋持續變動；只有局面本身改變才重設重播。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialBoard.fen])

  useEffect(() => {
    if (!selectedMove && candidates[0]) {
      setSelectedMove(candidates[0].move)
      setCandidateSnapshot(candidates[0])
    }
  }, [candidates, selectedMove])

  useEffect(() => {
    if (!liveCandidate) return
    setCandidateSnapshot((current) => {
      if (!current || current.move !== liveCandidate.move || stepIndex === 0) {
        return liveCandidate
      }
      const viewedPrefix = current.principalVariation.slice(0, stepIndex)
      const sameViewedPosition = viewedPrefix.every(
        (move, index) => liveCandidate.principalVariation[index] === move
      )
      return sameViewedPosition ? liveCandidate : current
    })
  }, [liveCandidate, stepIndex])

  const selectCandidate = (index: number): void => {
    const selected = candidates[index]
    if (!selected) return
    setSelectedMove(selected.move)
    setCandidateSnapshot(selected)
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
                aria-selected={selectedCandidateIndex === index}
                className={selectedCandidateIndex === index ? 'active' : ''}
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
