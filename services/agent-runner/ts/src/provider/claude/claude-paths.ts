import { homedir } from 'node:os'
import { join } from 'node:path'

const CLAUDE_CONFIG_DIRECTORY = '.claude'

export function claudeGlobalDir(): string {
  // The SDK has no public directory getter; match its native resolution for file readers.
  return (process.env['CLAUDE_CONFIG_DIR'] ?? join(homedir(), CLAUDE_CONFIG_DIRECTORY)).normalize('NFC')
}

export function claudeGlobalConfigFilePath(): string {
  const configDir = process.env['CLAUDE_CONFIG_DIR'] ?? ''
  return join(configDir.length > 0 ? configDir : homedir(), '.claude.json')
}

export function claudeProjectDir(cwd: string): string {
  return join(cwd, CLAUDE_CONFIG_DIRECTORY)
}
