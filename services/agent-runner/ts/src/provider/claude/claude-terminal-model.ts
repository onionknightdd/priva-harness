import { createHash, randomUUID } from 'node:crypto'
import { readFile, writeFile, rename, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { setTimeout } from 'node:timers/promises'
import { z } from 'zod'
import type { ProviderRunSpec } from '../../core/contract/agent-provider.js'
import { TerminalError, type TerminalInput } from '../../core/contract/terminal-service.js'
import { submitClaudeTerminalInput } from './claude-terminal-input.js'
import { stripVTControlCharacters } from 'node:util'
import { splitModelContext } from '../../core/resource/model-profile.js'

const selectionSchema = z.object({ model: z.string(), effort: z.string().optional(), profile: z.string() })
const statusSchema = z.object({ instanceId: z.string(), model: z.object({ id: z.string() }), effort: z.object({ level: z.string() }).optional(), context_window: z.object({ context_window_size: z.number() }).optional() })
const selectionFile = 'claude-terminal-selection.json'

function selection(spec: ProviderRunSpec) {
  return { model: spec.model, ...(spec.effort ? { effort: spec.effort } : {}),
    profile: createHash('sha256').update(JSON.stringify([spec.baseUrl, spec.authToken, spec.imageTools, spec.promptSuggestions])).digest('hex') }
}

export async function saveClaudeTerminalSelection(scratchDir: string, spec: ProviderRunSpec): Promise<void> {
  await writeFile(join(scratchDir, selectionFile), JSON.stringify(selection(spec)), { mode: 0o600 })
  const path = join(scratchDir, 'claude-terminal-run-spec.json'), temp = `${path}.${randomUUID()}.tmp`
  try {
    await writeFile(temp, JSON.stringify(spec), { mode: 0o600 })
    await rename(temp, path)
  } finally { await rm(temp, { force: true }) }
}

/** Returns restart only for environment changes that a live /model cannot apply. */
export async function configureClaudeTerminal(input: TerminalInput, scratchDir: string, spec: ProviderRunSpec, signal: AbortSignal): Promise<'applied' | 'restart'> {
  const previous = selectionSchema.parse(JSON.parse(await readFile(join(scratchDir, selectionFile), 'utf8')) as unknown)
  const next = selection(spec)
  if (previous.profile !== next.profile) return 'restart'
  const status = await readStatus(scratchDir)
  const current = status?.instanceId === await readFile(join(scratchDir, 'claude-terminal-instance'), 'utf8') ? status : previous
  if (!modelMatches(current.model, next.model)) await change(input, scratchDir, 'model', next.model, signal)
  if (next.effort && current.effort !== next.effort) await change(input, scratchDir, 'effort', next.effort, signal)
  await saveClaudeTerminalSelection(scratchDir, spec)
  return 'applied'
}

async function change(input: TerminalInput, scratchDir: string, field: 'model' | 'effort', value: string, signal: AbortSignal): Promise<void> {
  if (!value || /\s|\p{Cc}/u.test(value)) throw new TerminalError('unsupported', `Invalid Claude ${field} value`)
  await submitClaudeTerminalInput(input, `/${field} ${value}`, signal)
  const deadline = Date.now() + 15000
  const instanceId = await readFile(join(scratchDir, 'claude-terminal-instance'), 'utf8')
  const hint = field === 'model' ? 'Switch model?' : 'Change effort level?'
  let confirmed = false
  do {
    signal.throwIfAborted()
    if (!await input.isAlive()) throw new TerminalError('not-found', 'Claude exited while changing its model settings')
    const status = await readStatus(scratchDir)
    const actual = status?.[field]
    if (status?.instanceId === instanceId && (actual === value || (field === 'model' && modelMatches(actual, value)))) return
    const screen = stripVTControlCharacters(await input.capture())
    // Confirm only the cache-reset dialog caused by this exact operation.
    if (!confirmed && screen.includes(hint)) { await input.sendKeys(['Enter']); confirmed = true }
    await setTimeout(100, undefined, { signal })
  } while (Date.now() < deadline)
  throw new TerminalError('io-failure', `Claude did not confirm ${field} ${value}. Open Terminal to inspect its response.`)
}

function modelMatches(actual: string | undefined, value: string): boolean {
  const from = splitModelContext(actual), to = splitModelContext(value)
  if (to.context === '1m' && from.context !== '1m') return false
  return from.modelId === to.modelId || (/^(sonnet|opus|haiku)$/u.test(to.modelId ?? '') && Boolean(from.modelId?.includes(to.modelId ?? '')))
}

async function readStatus(scratchDir: string): Promise<{ instanceId: string; model: string; effort?: string } | undefined> {
  try {
    const status = statusSchema.parse(JSON.parse(await readFile(join(scratchDir, 'claude-terminal-status.json'), 'utf8')) as unknown)
    return { instanceId: status.instanceId, model: status.context_window && status.context_window.context_window_size >= 1000000 && !status.model.id.endsWith('[1m]') ? `${status.model.id}[1m]` : status.model.id,
      ...(status.effort ? { effort: status.effort.level } : {}) }
  }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; return undefined }
}
