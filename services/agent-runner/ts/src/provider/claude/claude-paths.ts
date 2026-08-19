import { join } from 'node:path'

const CLAUDE_CONFIG_DIRECTORY = '.claude'

export function claudeGlobalDir(harnessHome: string): string {
  return join(harnessHome, CLAUDE_CONFIG_DIRECTORY)
}

export function claudeProjectDir(cwd: string): string {
  return join(cwd, CLAUDE_CONFIG_DIRECTORY)
}
