import type { EngineAnalysisResultPayload } from '@shared/types/ipc'

interface Props {
  result: EngineAnalysisResultPayload
  compact?: boolean
}

export function EngineResultSummary({ result, compact = false }: Props): JSX.Element {
  const analysis = result.engineAnalysis
  const confidence = result.moveComparison.confidence
  const dual = result.dualEngineComparison
  const analysisWarning =
    analysis.incomplete || confidence === 'low'
      ? analysis.warnings.length > 0
        ? analysis.warnings.join('；')
        : `本次引擎資料不足：${result.moveComparison.uncertaintyReasons.join('；')}`
      : null
  const compactWarnings = [analysisWarning, result.verificationWarning].filter(
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
          <span>原始分數 <b>{analysis.scoreAfterBestMove?.raw ?? '無'}</b></span>
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
          {result.verificationWarning && (
            <div className="engine-status warn">{result.verificationWarning}</div>
          )}
        </>
      )}

      {dual && compact && (
        <section className={`dual-engine-summary compact ${dual.status}`}>
          <div className="section-heading">
            <div>
              <span className="eyebrow">DUAL ENGINE</span>
              <h4>
                {dual.status === 'agreement'
                  ? '兩個引擎方向一致'
                  : dual.status === 'disagreement'
                    ? '兩個引擎出現分歧'
                    : '雙引擎資料仍不足'}
              </h4>
            </div>
            <span className={`badge ${dual.status === 'agreement' ? 'on' : 'warn'}`}>
              {dual.primaryEngineName} × {dual.verificationEngineName}
            </span>
          </div>
          <div className="compact-dual-engine-lines">
            {dual.candidateLines.slice(0, 2).map((line) => (
              <div key={line.move} className="compact-dual-engine-line">
                <b>{line.displayMove}</b>
                <span>
                  {line.engineViews
                    .map((view) => `${view.engineName} ${view.score?.raw ?? '無分數'}`)
                    .join(' · ')}
                </span>
              </div>
            ))}
          </div>
        </section>
      )}

      {dual && !compact && (
        <section className={`dual-engine-summary ${dual.status}`}>
          <div className="section-heading">
            <div>
              <span className="eyebrow">DUAL ENGINE</span>
              <h4>
                {dual.status === 'agreement'
                  ? '兩個引擎方向一致'
                  : dual.status === 'disagreement'
                    ? '兩個引擎出現分歧'
                    : '雙引擎資料仍不足'}
              </h4>
            </div>
            <span className={`badge ${dual.status === 'agreement' ? 'on' : 'warn'}`}>
              {dual.primaryEngineName} × {dual.verificationEngineName}
            </span>
          </div>
          {dual.reasons.length > 0 && (
            <ul className="compact-list">
              {dual.reasons.map((reason) => (
                <li key={reason.code}>{reason.message}</li>
              ))}
            </ul>
          )}
          <div className="dual-engine-lines">
            {dual.candidateLines.map((line) => (
              <article key={line.move} className="dual-engine-line">
                <b>{line.displayMove}</b>
                <span>{line.proposedBy.join('、')}推薦</span>
                <span>{line.humanControl.summary}</span>
                <div className="dual-engine-views">
                  {line.engineViews.map((view) => (
                    <span key={view.engineId}>
                      {view.engineName}：
                      {view.rank ? `第 ${view.rank} 候選` : '未列入候選'} ·{' '}
                      {view.score?.raw ?? '無正式分數'}
                    </span>
                  ))}
                </div>
              </article>
            ))}
          </div>
          {dual.status === 'disagreement' && (
            <p className="muted small">
              AI 解說會交叉比較兩條主線的可控性、戰術精度、王區風險與長期發展，不會把兩個分數直接平均。
            </p>
          )}
        </section>
      )}

      <ol className="line-list" aria-label="候選著法與分析找法">
        {analysis.candidateMoves.map((candidate, index) => (
          <li key={`${index}-${candidate.move}`}>
            <span className="candidate-rank">{index + 1}</span>
            <div>
              <b>{candidate.displayMove ?? '無法辨識著法'}</b>
              <span className="candidate-score">原始分數 {candidate.score?.raw ?? '無'}</span>
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
