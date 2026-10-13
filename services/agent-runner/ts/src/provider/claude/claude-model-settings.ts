import { randomUUID } from 'node:crypto'
import { lstat, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import stripJsonComments from 'strip-json-comments'

import { asRecord } from '../../core/event/json-record.js'
import { resolveClaudeDefaultModelEnv } from '../../core/resource/provider-run-env.js'

const writes = new Map<string, Promise<void>>()

/** Persist the terminal selection without copying profile credentials into user settings. */
export async function saveClaudeModelSettings(globalConfigDir: string, model: string): Promise<void> {
  const path = resolve(globalConfigDir, 'settings.json')
  const previous = writes.get(path) ?? Promise.resolve()
  const next = previous.catch(() => undefined).then(() => updateModelSettings(path, model))
  writes.set(path, next)
  try { await next } finally { if (writes.get(path) === next) writes.delete(path) }
}

async function updateModelSettings(path: string, model: string): Promise<void> {
  let settings: Record<string, unknown> = {}
  try {
    if ((await lstat(path)).isSymbolicLink()) throw new Error(`Linked Claude settings are read-only: ${path}`)
    const parsed = asRecord(JSON.parse(stripJsonComments(await readFile(path, 'utf8'), { trailingCommas: true })) as unknown)
    if (!parsed) throw new Error(`Expected a JSON object in ${path}`)
    settings = parsed
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }
  const env = asRecord(settings['env'])
  if (settings['env'] !== undefined && !env) throw new Error(`Expected an env object in ${path}`)
  const next = { ...settings, model, env: { ...env, ...resolveClaudeDefaultModelEnv(model) } }
  if (JSON.stringify(next) === JSON.stringify(settings)) return
  await mkdir(dirname(path), { recursive: true, mode: 0o700 })
  const temp = `${path}.${randomUUID()}.tmp`
  try {
    await writeFile(temp, `${JSON.stringify(next, null, 2)}\n`, { mode: 0o600, flag: 'wx' })
    await rename(temp, path)
  } finally { await rm(temp, { force: true }) }
}
