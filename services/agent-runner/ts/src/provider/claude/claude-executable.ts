import { existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'

/**
 * Locate the Claude Code binary that ships with the installed Agent SDK.
 *
 * The SDK resolves `@anthropic-ai/claude-agent-sdk-<platform>-<arch>[-musl]`
 * for its own `query()` subprocess. The interactive terminal must run the
 * very same binary so both drivers agree on transcript format, hook names
 * and TUI wording; a separately installed `claude` on PATH is not used.
 */
export function resolveBundledClaudeExecutable(
  platform: NodeJS.Platform = process.platform,
  arch: string = process.arch,
): string | undefined {
  const require = createRequire(import.meta.url)
  const suffix = platform === 'win32' ? '.exe' : ''
  const candidates = platform === 'linux'
    ? [`linux-${arch}`, `linux-${arch}-musl`]
    : [`${platform}-${arch}`]
  for (const candidate of candidates) {
    try {
      const manifest = require.resolve(`@anthropic-ai/claude-agent-sdk-${candidate}/package.json`)
      const binary = join(dirname(manifest), `claude${suffix}`)
      if (existsSync(binary)) return binary
    } catch {
      continue
    }
  }
  return undefined
}
