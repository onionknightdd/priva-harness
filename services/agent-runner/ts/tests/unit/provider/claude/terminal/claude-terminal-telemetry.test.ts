import { mkdtemp, writeFile, appendFile, rename, rm, utimes } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { mapTerminalHook, readClaudeTerminalTelemetry, terminalStatus } from '../../../../../src/provider/claude/terminal/claude-terminal-telemetry.js'

it('uses current input and cache occupancy for context, separately from cumulative cost', () => {
  const status = terminalStatus({ instanceId: 'i', session_id: 's', model: { id: 'm' }, effort: { level: 'high' },
    workspace: { current_dir: '/new' }, context_window: { context_window_size: 200000, total_input_tokens: 900, current_usage: {
      input_tokens: 10, output_tokens: 30, cache_creation_input_tokens: 20, cache_read_input_tokens: 40,
    } }, cost: { total_cost_usd: 0.01, total_api_duration_ms: 15 } })
  expect(status).toMatchObject({ model: 'm', cwd: '/new', effort: 'high', context: { used: 70, limit: 200000 }, costUsd: 0.01, apiDurationMs: 15 })
})

it('retains partial UTF-8 journal bytes and rejects events from a replaced process', async () => {
  const root = await mkdtemp(join(tmpdir(), 'telemetry-'))
  try {
    await writeFile(join(root, 'claude-terminal-instance'), 'new')
    const raw = { instanceId: 'new', session_id: 's', hook_event_name: 'PostToolUse', tool_use_id: 't', tool_name: 'Bash', tool_response: '中文' }
    const bytes = Buffer.from(`${JSON.stringify(raw)}\n`)
    const end = bytes.indexOf(Buffer.from('中文')) + 1
    const journal = join(root, 'claude-terminal-events.jsonl')
    await writeFile(journal, bytes.subarray(0, end))
    expect(await readClaudeTerminalTelemetry(root, 0)).toEqual({ offset: 0, events: [] })
    await appendFile(journal, bytes.subarray(end))
    await appendFile(journal, `${JSON.stringify({ ...raw, instanceId: 'old' })}\n`)
    const batch = await readClaudeTerminalTelemetry(root, 0)
    expect(batch.events).toHaveLength(1)
    expect(batch.events[0]?.event).toMatchObject({ type: 'tool.completed', output: '中文', ok: true })
    expect((await readClaudeTerminalTelemetry(root, batch.offset)).events).toEqual([])
  } finally { await rm(root, { recursive: true, force: true }) }
})

it('follows the status line and a relaunch between polls of a quiet terminal', async () => {
  const root = await mkdtemp(join(tmpdir(), 'telemetry-'))
  // Written long before the poll, as on an idle terminal.
  const settled = new Date(Date.now() - 60_000)
  const write = async (name: string, content: string) => {
    const path = join(root, name), next = `${path}.next`
    await writeFile(next, content)
    await utimes(next, settled, settled)
    await rename(next, path)
  }
  const status = (instanceId: string, model: string) => JSON.stringify({ instanceId, session_id: 's', model: { id: model } })
  try {
    await write('claude-terminal-instance', 'first')
    await write('claude-terminal-run-spec.json', JSON.stringify({ cwd: '/work', profileId: 'profile-a' }))
    await write('claude-terminal-status.json', status('first', 'model-a'))
    await write('claude-terminal-events.jsonl', '')

    const quiet = await readClaudeTerminalTelemetry(root, 0)
    expect(quiet).toMatchObject({ offset: 0, events: [], status: { model: 'model-a', cwd: '/work', profileId: 'profile-a' } })
    expect(await readClaudeTerminalTelemetry(root, 0)).toEqual(quiet)

    await write('claude-terminal-status.json', status('first', 'model-b'))
    await write('claude-terminal-run-spec.json', JSON.stringify({ cwd: '/work', profileId: 'profile-b' }))
    expect((await readClaudeTerminalTelemetry(root, 0)).status).toMatchObject({ model: 'model-b', profileId: 'profile-b' })

    // A relaunch replaces the instance; the previous process's status no longer applies.
    await write('claude-terminal-instance', 'second')
    expect(await readClaudeTerminalTelemetry(root, 0)).toEqual({ offset: 0, events: [] })
  } finally { await rm(root, { recursive: true, force: true }) }
})

it('maps native permissions-independent tool failures, agents, compaction and background membership', () => {
  const raw = { instanceId: 'i', session_id: 's' }
  expect(mapTerminalHook({ ...raw, hook_event_name: 'PostToolUse', tool_use_id: 'jsx', tool_name: 'mcp__agentWorkshop__visualize',
    tool_response: { content: [{ type: 'text', text: '<button>JSX</button>' }], isError: false } })[0]?.event)
    .toMatchObject({ type: 'tool.completed', output: '<button>JSX</button>', ok: true })
  expect(mapTerminalHook({ ...raw, hook_event_name: 'PostToolUseFailure', tool_use_id: 't', tool_name: 'Read', error: 'missing', agent_id: 'child' })[0]?.event)
    .toMatchObject({ type: 'tool.completed', ok: false, output: 'missing', agentId: 'child' })
  expect(mapTerminalHook({ ...raw, hook_event_name: 'SubagentStart', agent_id: 'child', agent_type: 'Explore' })[0]?.event).toMatchObject({ type: 'agent.started', name: 'Explore' })
  expect(mapTerminalHook({ ...raw, hook_event_name: 'PostCompact', compact_summary: 'summary' })[0]?.event).toEqual({ type: 'session.compacted', summary: 'summary' })
  expect(mapTerminalHook({ ...raw, hook_event_name: 'Stop', background_tasks: [{ id: 'job', type: 'local_bash', status: 'running' }] })[0]?.event)
    .toMatchObject({ type: 'tasks.snapshot', tasks: [{ taskId: 'job', control: 'terminal', kind: 'bash', status: 'running' }] })
})

it('keeps native question answers and MCP elicitation decisions structured', () => {
  const raw = { instanceId: 'i', session_id: 's' }
  const events = mapTerminalHook({ ...raw, hook_event_name: 'PostToolUse', tool_use_id: 'ask', tool_name: 'AskUserQuestion',
    tool_response: { questions: [{ question: 'Color?', options: [{ label: 'Blue' }] }], answers: { 'Color?': 'Blue' } } })
  expect(events[1]?.event).toMatchObject({ type: 'permission.resolved', resolution: { decision: 'allow', reason: 'answered',
    request: { toolUseId: 'ask' }, answers: { q0: { selected: [], text: 'Blue' } } } })
  expect(mapTerminalHook({ ...raw, hook_event_name: 'ElicitationResult', mcp_server_name: 'form', elicitation_id: 'e', action: 'accept', content: { count: 0 } })[0]?.event)
    .toEqual({ type: 'ext', vendor: 'claude', name: 'elicitation.result', data: { serverName: 'form', elicitationId: 'e', action: 'accept', content: { count: 0 } } })
})
