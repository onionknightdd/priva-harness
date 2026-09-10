import { homedir } from 'node:os'
import { isAbsolute, join } from 'node:path'

/** Claude SDK 0.3.250's project directory encoding (including long-path hash).
 * The SDK exposes settings resolution, but not its filesystem path encoder. */
export function claudeProjectKey(path: string): string {
  const normalized = process.platform === 'darwin' ? path.normalize('NFC') : path
  const readable = normalized.replace(/[^a-zA-Z0-9]/gu, '-')
  if (readable.length <= 200) return readable
  let hash = 0
  for (let i = 0; i < normalized.length; i++) hash = ((hash << 5) - hash + normalized.charCodeAt(i)) | 0
  return `${readable.slice(0, 200)}-${Math.abs(hash).toString(36)}`
}

export function claudeMemoryDirectory(claudeDir: string, project: string, override?: string): string {
  const path = override?.trim()
  if (path?.startsWith('~/')) return join(homedir(), path.slice(2))
  if (path && isAbsolute(path)) return path
  return join(claudeDir, 'projects', claudeProjectKey(project), 'memory')
}
