import type { PreparedExplanationExecution } from '../prepareExplanationExecution'

export type ExplainPipelineVersion = 'v1' | 'v2'

/** 預設使用 v2；設定環境變數 XQA_EXPLAIN_PIPELINE=v1 可整體回滾到 v1 Harness。 */
export const EXPLAIN_PIPELINE: ExplainPipelineVersion = 'v2'

export function configuredExplainPipeline(
  env: Readonly<Record<string, string | undefined>> = process.env
): ExplainPipelineVersion {
  return env.XQA_EXPLAIN_PIPELINE === 'v1' ? 'v1' : EXPLAIN_PIPELINE
}

/** 一般解說的管線選擇（老師測試已移除，所有解說都依旗標決定）。 */
export function selectExplainPipeline(
  _execution: Pick<PreparedExplanationExecution, 'interactionKind'>,
  env: Readonly<Record<string, string | undefined>> = process.env
): ExplainPipelineVersion {
  return configuredExplainPipeline(env)
}
