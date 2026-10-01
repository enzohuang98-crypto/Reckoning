import type { EngineAnalysisResultPayload } from '@shared/types/ipc'

interface Props {
  result: EngineAnalysisResultPayload
  compact?: boolean
}

export function EngineResultSummary({ result, compact = false }: Props): JSX.Element {
  const analysis = result.engineAnalysis
  const confidence = result.moveComparison.confidence
  const analysisWarning =
    analysis.incomplete || confidence === 'low'
      ? analysis.warnings.length > 0
        ? analysis.warnings.join('；')
        : `本次引擎資料不足：${result.moveComparison.uncertaintyReasons.join('；')}`
      : null
  const compactWarnings = [analysisWarning].filter(
    (warning): warning is string => Boolean(warning)
  )
  const compactWarningText = compactWarnings.join('；')

  return (
    <section className={`analysis-result${compact ? ' compact' : ''}`}>
      <div className="result-head">
        <div>
          <span className="eyebrow">CURRENT RESULT</span>
          <h3>{analysis.displayBestMove ?? '無法辨識最佳著法'}</h3>
        </div>
        <div className="result-metrics">
          <span>分數 <b>{analysis.scoreAfterBestMove?.displayText ?? '無'}</b></span>
          <span>深度 <b>{analysis.depth ?? '—'}</b></span>
          {analysis.analysisTimeMs !== undefined && (
            <span>耗時 <b>{(analysis.analysisTimeMs / 1000).toFixed(1)}s</b></span>
          )}
        </div>
      </div>

      {compact ? (
        compactWarningText && (
          <div
            className="engine-status warn"
            aria-label={compactWarningText}
            title={compactWarningText}
          >
            {compactWarnings.length > 1
              ? `${compactWarnings.length} 項分析限制：${compactWarningText}`
              : compactWarningText}
          </div>
        )
      ) : (
        <>
          {analysisWarning && <div className="engine-status warn">{analysisWarning}</div>}
        </>
      )}

      <ol className="line-list" aria-label="候選著法與分析找法">
        {analysis.candidateMoves.map((candidate, index) => (
          <li key={`${index}-${candidate.move}`}>
            <span className="candidate-rank">{index + 1}</span>
            <div>
              <b>{candidate.displayMove ?? '無法辨識著法'}</b>
              <span className="candidate-score">分數 {candidate.score?.displayText ?? '無'}</span>
              <div className="pv">
                {(candidate.displayPrincipalVariation ?? []).slice(0, 8).join('、') ||
                  '引擎沒有回傳後續主線'}
              </div>
            </div>
          </li>
        ))}
      </ol>
    </section>
  )
}
