import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { getAgentDir } from '@earendil-works/pi-coding-agent'
import stripJsonComments from 'strip-json-comments'

/** Dependency adapter for pi-code's memory extension. Pi settings never touch
 * Claude settings or managed policy; Pi's own user/project hierarchy applies. */
export function claudeConfigDir(): string { return getAgentDir() }
export function claudeSettingsChain(cwd: string, _home: string, includeProject: boolean): string[] {
  return [join(getAgentDir(), 'settings.json'), ...(includeProject ? [join(cwd, '.pi/settings.json')] : [])]
}
export function readManagedSettings(): Record<string, unknown> { return {} }
export function isProjectApprovedSilently(ctx: { isProjectTrusted?: () => boolean }): boolean {
  return ctx.isProjectTrusted?.() === true
}
export function* readSettingsChain(paths: readonly string[]): Generator<Record<string, unknown>> {
  for (const path of paths) {
    let raw: string
    try { raw = readFileSync(path, 'utf8') } catch (error) {
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT') continue
      throw error
    }
    const value: unknown = JSON.parse(stripJsonComments(raw, { trailingCommas: true }))
    if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error(`Expected a settings object in ${path}`)
    yield value as Record<string, unknown>
  }
}
