export function isolatedUpdaterProbeId(mode: string, environment: NodeJS.ProcessEnv): string | null {
  if (mode !== 'isolated-updater-acceptance') return null
  if (environment.GITHUB_ACTIONS !== 'true' || environment.RUNNER_ENVIRONMENT !== 'github-hosted' ||
      !/^[1-9][0-9]{0,19}$/.test(environment.GITHUB_RUN_ID ?? '')) {
    throw new Error('Isolated updater instrumentation requires an explicit hosted VM build.')
  }
  return environment.GITHUB_RUN_ID!
}
