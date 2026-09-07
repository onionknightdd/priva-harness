import { asRecord, stringField } from '../../../core/event/json-record.js'
import type { SessionMessage } from '../../../core/resource/session.js'

// A sidechain without an owning Agent call must never become a main user turn.
// Workflow workers are read by the workflow detail endpoint, not this stream.
export function ownedSubagentMessages(main: readonly SessionMessage[], groups: readonly { agentId: string; messages: readonly SessionMessage[] }[]): SessionMessage[] {
  const calls = new Set<string>()
  const parents = new Map<string, string>()
  const all = [...main, ...groups.flatMap((group) => group.messages)]
  for (const row of all) {
    const content = asRecord(row.message)?.['content']
    if (!Array.isArray(content)) continue
    for (const raw of content) {
      const block = asRecord(raw)
      const name = stringField(block ?? {}, 'name')?.toLowerCase()
      const id = stringField(block ?? {}, 'id')
      if (block?.['type'] === 'tool_use' && id && (name === 'agent' || name === 'task')) calls.add(id)
    }
  }
  for (const row of all) {
    const message = asRecord(row.message) ?? {}
    const result = asRecord(message['tool_use_result'] ?? message['toolUseResult']) ?? {}
    const content = message['content']
    if (!Array.isArray(content)) continue
    for (const raw of content) {
      const block = asRecord(raw) ?? {}
      const id = stringField(block, 'tool_use_id')
      if (block['type'] !== 'tool_result' || !id || !calls.has(id)) continue
      const body = block['content']
      const text = typeof body === 'string' ? body : JSON.stringify(body ?? '')
      const agentId = stringField(result, 'agentId') ?? stringField(result, 'agent_id') ?? /\bagentId:\s*([\w-]+)/.exec(text)?.[1]
      if (agentId) parents.set(agentId, id)
    }
  }
  const reachable = new Set<string>()
  const addCalls = (rows: readonly SessionMessage[]) => {
    for (const row of rows) {
      const content = asRecord(row.message)?.['content']
      if (!Array.isArray(content)) continue
      for (const raw of content) {
        const block = asRecord(raw) ?? {}
        const id = stringField(block, 'id')
        if (id && calls.has(id)) reachable.add(id)
      }
    }
  }
  addCalls(main)
  const ordered: typeof groups[number][] = []
  const included = new Set<string>()
  let previousSize = -1
  while (previousSize !== reachable.size) {
    previousSize = reachable.size
    for (const group of groups) {
      const parent = group.messages.find((row) => row.parentToolUseId)?.parentToolUseId ?? parents.get(group.agentId)
      if (parent && reachable.has(parent) && !included.has(group.agentId)) {
        included.add(group.agentId)
        ordered.push(group)
        addCalls(group.messages)
      }
    }
  }
  const seen = new Set(main.map((row) => row.uuid).filter(Boolean))
  return ordered.flatMap(({ agentId, messages }) => messages.flatMap((row) => {
    const parent = (row.parentToolUseId === "" ? undefined : row.parentToolUseId) ?? parents.get(agentId)
    if (!parent || !reachable.has(parent) || (row.uuid && seen.has(row.uuid))) return []
    if (row.uuid) seen.add(row.uuid)
    return [{ ...row, parentToolUseId: parent }]
  }))
}
