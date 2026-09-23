import { open, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { isEffortLevel, type ProviderRunSpec } from '../../core/contract/agent-provider.js'
import type { TerminalActivity, TerminalStatus, TerminalTelemetry } from '../../core/contract/terminal-service.js'
import { asRecord, numberField, stringField } from '../../core/event/json-record.js'
import { emptyContextUsage } from '../../core/resource/context-usage.js'
import type { AgentEvent } from '../../core/event/agent-event.js'
import { taskKind, taskStatus } from '../../core/resource/background-task.js'
import { claudeToolOutput } from './claude-event-mapper.js'
import { questionResolutionFromToolResult } from '../../core/resource/interaction-history.js'

export async function readClaudeTerminalSpec(scratchDir: string): Promise<ProviderRunSpec | undefined> {
  return await readJson(join(scratchDir, 'claude-terminal-run-spec.json')) as ProviderRunSpec | undefined
}

export async function readClaudeTerminalTelemetry(scratchDir: string, offset: number): Promise<TerminalTelemetry> {
  const instanceId = await readFile(join(scratchDir, 'claude-terminal-instance'), 'utf8')
  const spec = await readClaudeTerminalSpec(scratchDir)
  const raw = asRecord(await readJson(join(scratchDir, 'claude-terminal-status.json')))
  const status = raw?.['instanceId'] === instanceId ? terminalStatus(raw, spec) : undefined
  let file
  try { file = await open(join(scratchDir, 'claude-terminal-events.jsonl'), 'r') }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
  if (!file) return { offset, events: [], ...(status ? { status } : {}) }
  try {
    const size = (await file.stat()).size
    const start = offset > size ? 0 : offset
    const bytes = Buffer.alloc(Math.min(size - start, 4 * 1024 * 1024))
    const { bytesRead } = await file.read(bytes, 0, bytes.length, start)
    const end = bytes.subarray(0, bytesRead).lastIndexOf(10) + 1
    const events = bytes.subarray(0, end).toString('utf8').split('\n').filter(Boolean).flatMap((line) => {
      const record = asRecord(JSON.parse(line) as unknown)
      return record?.['instanceId'] === instanceId ? mapTerminalHook(record) : []
    })
    return { offset: start + end, events, ...(status ? { status } : {}) }
  } finally { await file.close() }
}

export function terminalStatus(raw: Record<string, unknown>, spec?: ProviderRunSpec): TerminalStatus | undefined {
  const model = stringField(asRecord(raw['model']) ?? {}, 'id')
  const sessionId = stringField(raw, 'session_id')
  const instanceId = stringField(raw, 'instanceId')
  if (!model || !sessionId || !instanceId) return undefined
  const effort = asRecord(raw['effort'])?.['level']
  const window = asRecord(raw['context_window']) ?? {}
  const usage = asRecord(window['current_usage'])
  const cost = asRecord(raw['cost']) ?? {}
  const limit = numberField(window, 'context_window_size') ?? null
  // Context is the latest input, not cumulative billing and not output tokens.
  const used = usage ? ['input_tokens', 'cache_creation_input_tokens', 'cache_read_input_tokens']
    .reduce((sum, key) => sum + (numberField(usage, key) ?? 0), 0) : null
  const costUsd = numberField(cost, 'total_cost_usd')
  const apiDurationMs = numberField(cost, 'total_api_duration_ms')
  return { instanceId, sessionId, model: limit !== null && limit >= 1000000 && !model.endsWith('[1m]') ? `${model}[1m]` : model,
    cwd: stringField(asRecord(raw['workspace']) ?? {}, 'current_dir') ?? spec?.cwd ?? '',
    ...(typeof raw['updatedAt'] === 'number' ? { updatedAt: raw['updatedAt'] } : {}),
    ...(isEffortLevel(effort) ? { effort } : {}), ...(spec?.profileId ? { profileId: spec.profileId } : {}),
    context: { ...emptyContextUsage(), used, limit },
    ...(costUsd === undefined ? {} : { costUsd }), ...(apiDurationMs === undefined ? {} : { apiDurationMs }) }
}

export function mapTerminalHook(raw: Record<string, unknown>): TerminalActivity[] {
  const sessionId = stringField(raw, 'session_id'), instanceId = stringField(raw, 'instanceId')
  if (!sessionId || !instanceId) return []
  const agentId = stringField(raw, 'agent_id')
  const channel = agentId ? { agentId } : {}
  const id = stringField(raw, 'tool_use_id') ?? ''
  const name = stringField(raw, 'tool_name') ?? ''
  const durationMs = numberField(raw, 'duration_ms')
  let event: AgentEvent | undefined
  switch (raw['hook_event_name']) {
    case 'Stop': {
      if (agentId || !Array.isArray(raw['background_tasks'])) break
      event = { type: 'tasks.snapshot', tasks: raw['background_tasks'].flatMap((value) => {
        const task = asRecord(value) ?? {}, taskId = stringField(task, 'id')
        return taskId ? [{ taskId, control: 'terminal' as const, kind: taskKind(stringField(task, 'type') ?? ''),
          status: taskStatus(task['status']), ...(typeof task['description'] === 'string' ? { description: task['description'] } : {}) }] : []
      }) }
      break
    }
    case 'PreToolUse': event = { type: 'tool.started', id, name, input: raw['tool_input'], messageId: id, blockId: id, ...channel }; break
    case 'PostToolUse': case 'PostToolUseFailure': {
      const response = raw['tool_response']
      const content = asRecord(response)?.['content'] ?? response
      event = { type: 'tool.completed', id, name, ok: raw['hook_event_name'] === 'PostToolUse' && asRecord(response)?.['isError'] !== true,
        output: stringField(raw, 'error') ?? claudeToolOutput({ content }, { tool_use_result: response }, {}, name),
        ...(durationMs === undefined ? {} : { durationMs }), ...channel }
      const resolution = questionResolutionFromToolResult(id, name, response, !event.ok)
      return [{ sessionId, instanceId, event }, ...(resolution ? [{ sessionId, instanceId, event: { type: 'permission.resolved' as const, resolution } }] : [])]
    }
    case 'PreCompact': if (!agentId) event = { type: 'session.compacting' }; break
    case 'ElicitationResult': event = { type: 'ext', vendor: 'claude', name: 'elicitation.result', data: {
      serverName: raw['mcp_server_name'], elicitationId: raw['elicitation_id'], action: raw['action'], content: raw['content'],
    } }; break
    case 'PostCompact': if (!agentId) event = { type: 'session.compacted', summary: stringField(raw, 'compact_summary') ?? '' }; break
    case 'SubagentStart': if (agentId) event = { type: 'agent.started', agentId, name: stringField(raw, 'agent_type') ?? 'Agent' }; break
    case 'SubagentStop': if (agentId) event = { type: 'agent.completed', agentId, ok: true }; break
    case 'CwdChanged': return [{ sessionId, instanceId, event: { type: 'ext', vendor: 'claude', name: 'cwd.changed' }, cwd: stringField(raw, 'new_cwd') ?? '' }]
  }
  return event ? [{ sessionId, instanceId, event }] : []
}

async function readJson(path: string): Promise<unknown> {
  try { return JSON.parse(await readFile(path, 'utf8')) as unknown }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; return undefined }
}
