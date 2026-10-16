import type { PreparedExplanationExecution } from '../prepareExplanationExecution'

export type ExplainPipelineVersion = 'v1' | 'v2'

/** 預設使用 v2；設定環境變數 XQA_EXPLAIN_PIPELINE=v1 可整體回滾到 v1 Harness。 */
export const EXPLAIN_PIPELINE: ExplainPipelineVersion = 'v2'

export function configuredExplainPipeline(
  env: Readonly<Record<string, string | undefined>> = process.env
): ExplainPipelineVersion {
  return env.XQA_EXPLAIN_PIPELINE === 'v1' ? 'v1' : EXPLAIN_PIPELINE
}

/** 老師測試（prelude／正式案例）仍走 v1，直到計畫 P4-5 決定其去留。 */
export function selectExplainPipeline(
  execution: Pick<PreparedExplanationExecution, 'interactionKind'>,
  env: Readonly<Record<string, string | undefined>> = process.env
): ExplainPipelineVersion {
  return execution.interactionKind === 'ordinary' ? configuredExplainPipeline(env) : 'v1'
}
