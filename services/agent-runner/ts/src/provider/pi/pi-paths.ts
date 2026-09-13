import { join, resolve } from 'node:path'

import { getAgentDir } from '@earendil-works/pi-coding-agent'

const PI_DIRECTORY = '.pi'

export function piGlobalDir(): string {
  return getAgentDir()
}

export function piProjectDir(cwd: string): string {
  return join(cwd, PI_DIRECTORY)
}

export function piSessionsRoot(agentDir: string): string {
  return join(agentDir, 'sessions')
}

export function piSessionBucketDir(agentDir: string, cwd: string): string {
  const resolvedCwd = resolve(cwd)
  const safePath = `--${resolvedCwd.replace(/^[/\\]/u, '').replace(/[/\\:]/gu, '-')}--`
  return join(piSessionsRoot(agentDir), safePath)
}
