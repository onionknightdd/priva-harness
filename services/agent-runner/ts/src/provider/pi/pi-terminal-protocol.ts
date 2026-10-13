import { open, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { createInterface } from 'node:readline'
import { createReadStream } from 'node:fs'
import { z } from 'zod'
import { setTimeout as delay } from 'node:timers/promises'
import type { ProviderRunSpec, SessionTarget } from '../../core/contract/agent-provider.js'
import { EFFORT_LEVELS } from '../../core/contract/agent-provider.js'
import type { TerminalActivity, TerminalSessionState, TerminalStatus, TerminalTelemetry } from '../../core/contract/terminal-service.js'
import { interactionResponseSchema } from '../../core/resource/interaction.js'

export const PI_TERMINAL_FILES = {
  launch: 'pi-launch.json', control: 'pi-control.json', state: 'pi-state.json',
  status: 'pi-status.json', events: 'pi-events.jsonl', spec: 'pi-spec.json',
} as const

export interface PiTerminalState extends TerminalSessionState {
  readonly eventOffset: number
}

export interface PiTerminalLaunchConfig {
  readonly agentDir: string
  readonly scratchDir: string
  readonly target: SessionTarget
  readonly spec: ProviderRunSpec
  readonly instanceId: string
  readonly token: string
  readonly theme: 'light' | 'dark'
}

export const piTerminalCommandSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('prompt'), text: z.string().min(1), runId: z.string().optional(), imagePaths: z.array(z.string()).optional() }),
  z.object({ type: z.literal('abort') }),
  z.object({ type: z.literal('respond'), response: interactionResponseSchema }),
  z.object({ type: z.literal('stop-task'), taskId: z.string().min(1) }),
  z.object({ type: z.literal('configure'), model: z.string().min(1), contextWindow: z.number().int().positive(), effort: z.enum(EFFORT_LEVELS).optional() }),
  z.object({ type: z.literal('reload') }),
])
export type PiTerminalCommand = z.infer<typeof piTerminalCommandSchema>

export async function readPiTerminalJson<T>(scratchDir: string, file: keyof typeof PI_TERMINAL_FILES): Promise<T | undefined> {
  try { return JSON.parse(await readFile(join(scratchDir, PI_TERMINAL_FILES[file]), 'utf8')) as T }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined; throw error }
}

export async function requestPiTerminal(scratchDir: string, command: PiTerminalCommand, signal?: AbortSignal): Promise<void> {
  const launch = await readPiTerminalJson<PiTerminalLaunchConfig>(scratchDir, 'launch')
  if (!launch) throw new Error('Pi terminal has no launch configuration')
  const deadline = signal ? AbortSignal.any([signal, AbortSignal.timeout(120000)]) : AbortSignal.timeout(120000)
  let control
  for (;;) {
    deadline.throwIfAborted()
    const state = await readPiTerminalJson<TerminalSessionState>(scratchDir, 'state')
    if (state?.instanceId === launch.instanceId && state.phase === 'exited') throw new Error('Pi terminal has exited; reopen the terminal')
    control = await readPiTerminalJson<{ port: number; token: string; instanceId: string; ready?: boolean }>(scratchDir, 'control')
    if (control?.instanceId === launch.instanceId && (control.ready || ['respond', 'abort'].includes(command.type))) break
    await delay(100, undefined, { signal: deadline })
  }
  const response = await fetch(`http://127.0.0.1:${control.port}/command`, {
    method: 'POST', headers: { authorization: `Bearer ${control.token}`, 'content-type': 'application/json' },
    body: JSON.stringify(command), signal: deadline,
  })
  if (!response.ok) throw new Error(`Pi terminal command failed: ${await response.text()}`)
}

export async function readPiTerminalTelemetry(scratchDir: string, offset: number): Promise<TerminalTelemetry> {
  const rawStatus = await readPiTerminalJson<TerminalStatus>(scratchDir, 'status')
  const state = await readPiTerminalJson<PiTerminalState>(scratchDir, 'state')
  const control = await readPiTerminalJson<{ ready?: boolean; instanceId: string }>(scratchDir, 'control')
  const startup = state?.phase === 'idle' && control?.instanceId === state.instanceId && control.ready !== true
  const status = rawStatus?.instanceId === state?.instanceId ? rawStatus : undefined
  let file
  try { file = await open(join(scratchDir, PI_TERMINAL_FILES.events), 'r') }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
  if (!file) return { offset, events: [], ...(status ? { status } : {}) }
  try {
    const size = (await file.stat()).size
    // Skip only the bytes covered by the settled snapshot. A new turn may have
    // appended events after that snapshot was read; those must still be delivered.
    const adoptingSettled = offset < 0 && state !== undefined && !startup && state.phase !== 'running'
    const settledOffset = adoptingSettled ? state.eventOffset : undefined
    if (adoptingSettled && (settledOffset === undefined || !Number.isSafeInteger(settledOffset) || settledOffset < 0 || settledOffset > size)) throw new Error('Pi terminal state has an invalid event offset')
    const start = settledOffset ?? (offset < 0 && state?.phase === 'running'
      ? await latestRunOffset(join(scratchDir, PI_TERMINAL_FILES.events), size, state.instanceId)
      : offset > size ? 0 : Math.max(0, offset))
    const bytes = Buffer.alloc(Math.min(size - start, 64 * 1024 * 1024))
    const { bytesRead } = await file.read(bytes, 0, bytes.length, start)
    const end = bytes.subarray(0, bytesRead).lastIndexOf(10) + 1
    if (bytesRead > 0 && end === 0) throw new Error('Pi terminal event exceeds the supported frame size')
    let events = bytes.subarray(0, end).toString('utf8').split('\n').filter(Boolean)
      .map((line) => JSON.parse(line) as TerminalActivity).filter((item) => item.instanceId === state?.instanceId)
    if (offset < 0 && startup) {
      events = events.filter(({ event }) => event.type === 'permission.requested' || event.type === 'permission.resolved' || event.type === 'terminal.focus')
    }
    return { offset: start + end, events, ...(status ? { status } : {}) }
  } finally { await file.close() }
}

/** Find the active run before replaying; a large history must never re-account old turns. */
async function latestRunOffset(path: string, size: number, instanceId: string | undefined): Promise<number> {
  if (!size) return 0
  const stream = createReadStream(path, { start: 0, end: size - 1 })
  const lines = createInterface({ input: stream, crlfDelay: Infinity })
  let offset = 0
  let latest = size
  try {
    for await (const line of lines) {
      if (line.includes('"run.started"')) {
        const activity = JSON.parse(line) as TerminalActivity
        if (activity.instanceId === instanceId && activity.event.type === 'run.started') latest = offset
      }
      offset += Buffer.byteLength(line) + 1
    }
  } finally { lines.close(); stream.destroy() }
  return latest
}
