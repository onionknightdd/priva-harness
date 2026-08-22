import { join, resolve } from 'node:path'

const PI_PRODUCT_DIRECTORY = '.bambuddy'

export function piGlobalDir(harnessHome: string): string {
  return join(harnessHome, PI_PRODUCT_DIRECTORY)
}

export function piProjectDir(cwd: string): string {
  return join(cwd, PI_PRODUCT_DIRECTORY)
}

export function piSessionsRoot(agentDir: string): string {
  return join(agentDir, 'sessions')
}

export function piSessionBucketDir(agentDir: string, cwd: string): string {
  const resolvedCwd = resolve(cwd)
  const safePath = `--${resolvedCwd.replace(/^[/\\]/u, '').replace(/[/\\:]/gu, '-')}--`
  return join(piSessionsRoot(agentDir), safePath)
}

