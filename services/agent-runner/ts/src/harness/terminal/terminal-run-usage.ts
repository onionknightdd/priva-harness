import type { ProviderSessionStore } from '../../core/contract/provider-session-store.js'
import type { SessionRef } from '../../core/contract/agent-provider.js'
import type { ModelTokenUsage, RunAccounting, TokenUsage } from '../../core/event/agent-event.js'
import { asRecord, numberField, stringField } from '../../core/event/json-record.js'
import { SessionError } from '../../core/resource/session.js'

export type TerminalUsageSnapshot = ReadonlyMap<string, { model: string; usage: TokenUsage }>

/** Native transcripts split one API message into several blocks with the same id. */
export async function readTerminalUsage(store: ProviderSessionStore, ref: SessionRef): Promise<TerminalUsageSnapshot> {
  const snapshot = new Map<string, { model: string; usage: TokenUsage }>()
  let messages
  try { messages = await store.messages(ref) }
  catch (error) { if (error instanceof SessionError && error.kind === 'session-not-found') return snapshot; throw error }
  for (const row of messages) {
    if (row.type !== 'assistant') continue
    const message = asRecord(row.message) ?? {}, raw = asRecord(message['usage'])
    const model = stringField(message, 'model'), id = stringField(message, 'id') ?? row.uuid
    if (!model || !raw || model === '<synthetic>') continue
    const key = `${row.parentToolUseId ?? ''}:${id}`
    const usage = { input: numberField(raw, 'input_tokens') ?? 0, output: numberField(raw, 'output_tokens') ?? 0,
      cacheRead: numberField(raw, 'cache_read_input_tokens') ?? 0, cacheWrite: numberField(raw, 'cache_creation_input_tokens') ?? 0 }
    const previous = snapshot.get(key)?.usage
    snapshot.set(key, { model, usage: { input: Math.max(previous?.input ?? 0, usage.input), output: Math.max(previous?.output ?? 0, usage.output),
      cacheRead: Math.max(previous?.cacheRead ?? 0, usage.cacheRead), cacheWrite: Math.max(previous?.cacheWrite ?? 0, usage.cacheWrite) } })
  }
  return snapshot
}

export function terminalUsageDelta(before: TerminalUsageSnapshot, after: TerminalUsageSnapshot): RunAccounting {
  const byModel: Record<string, ModelTokenUsage> = {}
  let numTurns = 0
  const total = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }
  for (const [id, { model, usage }] of after) {
    const previous = before.get(id)?.usage
    const delta = { input: Math.max(0, usage.input - (previous?.input ?? 0)), output: Math.max(0, usage.output - (previous?.output ?? 0)),
      cacheRead: Math.max(0, (usage.cacheRead ?? 0) - (previous?.cacheRead ?? 0)), cacheWrite: Math.max(0, (usage.cacheWrite ?? 0) - (previous?.cacheWrite ?? 0)) }
    if (previous && !Object.values(delta).some(Boolean)) continue
    if (!previous) numTurns++
    const current = byModel[model] ?? { input: 0, output: 0 }
    byModel[model] = { input: current.input + delta.input, output: current.output + delta.output,
      cacheRead: (current.cacheRead ?? 0) + delta.cacheRead, cacheWrite: (current.cacheWrite ?? 0) + delta.cacheWrite }
    for (const key of ['input', 'output', 'cacheRead', 'cacheWrite'] as const) total[key] += delta[key]
  }
  return { usage: total, byModel, numTurns }
}
