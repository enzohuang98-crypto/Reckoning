// Compile-time only. Ordinary builds replace this with null and remove hooks.
declare global { const __ISOLATED_UPDATER_PROBE_ID__: string | null }
export const ISOLATED_PROBE_CHANNEL = 'isolated-updater-probe:record'
export const ISOLATED_PROBE_STAGES = [
  'prepare-start', 'prepare-complete', 'first-draft-clear', 'first-draft-present',
  'after-save-draft-clear', 'after-save-draft-present', 'install-dispatch'
] as const
export type IsolatedProbeStage = typeof ISOLATED_PROBE_STAGES[number]
export interface IsolatedUpdaterProbeApi { record(stage: IsolatedProbeStage): Promise<void> }
