import { describe, expect, it } from 'vitest'

import { durableEventSchema } from '../../../../src/core/agent-api/events.js'
import { diffGraph, emptyProjectionMemory, graphMemory, newSessionMemory, sessionStatusOf } from '../../../../src/core/agent-api/graph-diff.js'
import { derivedId } from '../../../../src/core/agent-api/ids.js'
import { projectThread, threadId, toolItemId, type RunRecord, type ThreadProjectionInput } from '../../../../src/core/agent-api/thread-projection.js'
import type { BackgroundTask } from '../../../../src/core/resource/background-task.js'
import type { InteractionRequest } from '../../../../src/core/resource/interaction.js'
import type { ThreadMessage } from '../../../../src/core/resource/thread.js'

const AT = '2026-10-22T00:20:00.000Z'

function input(messages: readonly ThreadMessage[], extra: Partial<ThreadProjectionInput> = {}): ThreadProjectionInput {
  return {
    messages, tasks: [], pendingInteractions: [], resolvedInteractions: [], activeRunId: undefined,
    executingToolIds: new Set(), liveUsage: new Map(), runs: [], launching: new Set(),
    relativePath: (path) => path.replace('/work/', ''), ...extra,
  }
}

const user = (id: string, content: string): ThreadMessage => ({ id, role: 'user', content, createdAt: AT, status: 'complete' })

describe('projectThread', () => {
  it('nests a subagent thread between the subagent item events', () => {
    const assistant: ThreadMessage = {
      id: 'a1', role: 'assistant', content: '', createdAt: AT, status: 'complete',
      blocks: [{ type: 'tool_use', blockId: 'toolu_agent', index: 0, id: 'toolu_agent', name: 'Agent',
        input: { subagent_type: 'Explore', description: 'Find totals', prompt: 'Find order totals' },
        tool: { id: 'toolu_agent', name: 'Agent', status: 'completed', ok: true, output: 'Two places', durationMs: 6400 } }],
      nestedAgents: [{ parentToolUseId: 'toolu_agent', status: 'completed', inbox: [], blocks: [
        { type: 'tool_use', blockId: 'toolu_grep', index: 0, id: 'toolu_grep', name: 'Grep', input: { pattern: 'total' },
          tool: { id: 'toolu_grep', name: 'Grep', status: 'completed', ok: true, output: 'a.ts:1' } },
      ] }],
    }
    const graph = projectThread(input([user('run-1:user', 'Look'), assistant]))
    expect(graph.runs[0]?.items[0]).toMatchObject({
      type: 'subagent', status: 'completed', agent: { name: 'Explore', description: 'Find totals' },
      thread_id: threadId('toolu_agent'), mode: 'foreground', input: { prompt: 'Find order totals' },
      output: { content: [{ type: 'text', text: 'Two places' }], is_error: false },
    })
    expect(graph.threads.get(threadId('toolu_agent'))?.[0]).toMatchObject({
      run: { thread_id: threadId('toolu_agent'), status: 'completed', input: { type: 'agent_task', item_id: toolItemId('toolu_agent') } },
      items: [{ type: 'tool_call', tool: { name: 'Grep', kind: 'search' }, status: 'completed' }],
    })
    const { events } = diffGraph(newSessionMemory(), graph, sessionStatusOf(graph), undefined)
    expect(events.map((event) => `${event.type}${'thread_id' in event && event.thread_id ? '@thread' : ''}`)).toEqual([
      'run.started', 'item.started', 'run.started@thread', 'item.started@thread', 'item.completed@thread', 'run.completed@thread',
      'item.completed', 'run.completed', 'session.status_changed',
    ])
    for (const event of events) expect(durableEventSchema.safeParse({ seq: 1, created_at: AT, ...event }).success).toBe(true)
  })

  it('starts a task_result run where a background result is delivered', () => {
    const task: BackgroundTask = { taskId: 'bg1', kind: 'bash', status: 'completed', toolUseId: 'toolu_bg', description: 'e2e', summary: 'All passed', outputFile: '/work/out.log' }
    const assistant: ThreadMessage = {
      id: 'a1', role: 'assistant', content: '', createdAt: AT, status: 'complete',
      blocks: [
        { type: 'tool_use', blockId: 'toolu_bg', index: 0, id: 'toolu_bg', name: 'Bash', input: { command: 'npm run e2e', run_in_background: true },
          tool: { id: 'toolu_bg', name: 'Bash', status: 'completed', ok: true, output: 'started', backgroundTask: task } },
        { type: 'task_notification', blockId: 'notification:n1', index: 1, notification: { id: 'n1', task } },
        { type: 'text', blockId: 'a2:0', index: 2, text: 'E2E passed.' },
      ],
    }
    const graph = projectThread(input([user('run-1:user', 'Fix it'), assistant], { tasks: [task] }))
    expect(graph.runs.map(({ run }) => run.input?.type)).toEqual(['user_message', 'task_result'])
    expect(graph.runs[0]?.items).toEqual([expect.objectContaining({ type: 'tool_call', task_id: derivedId('task', 'bg1') })])
    expect(graph.runs[1]?.run.input).toEqual({ type: 'task_result', task_id: derivedId('task', 'bg1'), status: 'completed', summary: 'All passed' })
    expect(graph.tasks[0]).toMatchObject({ kind: 'shell', status: 'completed', origin: { run_id: graph.runs[0]?.run.id, item_id: toolItemId('toolu_bg') },
      result: { summary: 'All passed', output_path: 'out.log' } })
  })

  it('keeps run IDs after a restart by matching transcript messages to recorded runs', () => {
    const runs: RunRecord[] = [{ id: 'run_api1', harnessRunId: 'run_api1', text: 'hello', source: 'api', messageId: 'msg_1', createdAt: '2026-10-22T00:19:59.000Z', visible: true }]
    const transcript: ThreadMessage = { ...user('uuid-1', 'hello'), transcriptUuid: 'uuid-1' }
    const graph = projectThread(input([transcript, { id: 'm1', role: 'assistant', content: 'hi', createdAt: AT, status: 'complete', blocks: [{ type: 'text', blockId: 'm1:0', index: 0, text: 'hi' }] }], { runs }))
    expect(graph.runs[0]?.run).toMatchObject({ id: 'run_api1', input: { message_id: 'msg_1', source: 'api' } })
    expect(graph.claims).toEqual([{ runId: 'run_api1', nativeUserId: 'uuid-1' }])
  })

  it('attaches an automatic compaction to the run it interrupted', () => {
    const graph = projectThread(input([
      user('run-1:user', 'work'),
      { id: 'run-1', role: 'assistant', content: '', createdAt: AT, status: 'complete', blocks: [{ type: 'text', blockId: 'x:0', index: 0, text: 'part one' }] },
      { id: 'compact:s:1', role: 'user', content: '/compact', createdAt: AT, status: 'complete', compact: { phase: 'compacted', summary: 'Earlier work' } },
      { id: 'run-1:after', role: 'assistant', content: '', createdAt: AT, status: 'complete', blocks: [{ type: 'text', blockId: 'y:0', index: 0, text: 'part two' }] },
    ]))
    expect(graph.runs).toHaveLength(1)
    expect(graph.runs[0]?.items.map((item) => item.type)).toEqual(['message', 'compaction', 'message'])
    expect(graph.runs[0]?.items[1]).toMatchObject({ trigger: 'auto', status: 'completed', summary: 'Earlier work' })
  })

  it('reports a pending approval, then its resolution, with matching status changes', () => {
    const request: InteractionRequest = { requestId: 'req-1', kind: 'tool', tool: 'Edit', toolUseId: 'toolu_edit', input: { file_path: 'a.ts' }, expiresAt: Date.parse(AT) }
    const assistant: ThreadMessage = { id: 'run-1', role: 'assistant', content: '', createdAt: AT, status: 'streaming',
      blocks: [{ type: 'tool_use', blockId: 'toolu_edit', index: 0, id: 'toolu_edit', name: 'Edit', input: { file_path: 'a.ts' }, tool: { id: 'toolu_edit', name: 'Edit', status: 'started' } }] }
    const messages = [user('run-1:user', 'edit'), assistant]
    // Claude asks for approval once the tool input is complete.
    const executingToolIds = new Set(['toolu_edit'])
    const running = projectThread(input(messages, { activeRunId: 'run-1' }))
    let memory = graphMemory(running, sessionStatusOf(running), undefined)

    const pending = projectThread(input(messages, { activeRunId: 'run-1', executingToolIds, pendingInteractions: [request] }))
    const asked = diffGraph(memory, pending, sessionStatusOf(pending), undefined)
    expect(asked.events.map((event) => event.type)).toEqual(['item.updated', 'interaction.requested', 'session.status_changed'])
    expect(asked.events[0]).toMatchObject({ item: { status: 'pending', input: { file_path: 'a.ts' } } })
    expect(asked.events[1]).toMatchObject({ interaction: { type: 'approval', tool: { name: 'Edit', kind: 'file_edit' }, item_id: toolItemId('toolu_edit'), status: 'pending' } })
    expect(asked.events[2]).toMatchObject({ status: { state: 'requires_action', interaction_ids: [derivedId('int', 'req-1')] } })
    memory = asked.memory

    const resolved = projectThread(input(messages, { activeRunId: 'run-1', executingToolIds, resolvedInteractions: [{ resolution: { request, decision: 'allow', reason: 'answered' } }] }))
    const answered = diffGraph(memory, resolved, sessionStatusOf(resolved), undefined)
    expect(answered.events.map((event) => event.type)).toEqual(['interaction.resolved', 'item.updated', 'session.status_changed'])
    expect(answered.events[1]).toMatchObject({ item: { status: 'running' } })
    expect(answered.events[2]).toMatchObject({ status: { state: 'running' } })
  })

  it('catches up on a run that finished while nothing was attached', () => {
    const streaming = projectThread(input([user('run-1:user', 'hi'), { id: 'run-1', role: 'assistant', content: '', createdAt: AT, status: 'streaming', blocks: [] }], { activeRunId: 'run-1' }))
    const memory = graphMemory(streaming, sessionStatusOf(streaming), undefined)
    const finished = projectThread(input([user('run-1:user', 'hi'), { id: 'run-1', role: 'assistant', content: 'done', createdAt: AT, status: 'complete',
      blocks: [{ type: 'text', blockId: 'm:0', index: 0, text: 'done' }] }]))
    const { events } = diffGraph(memory, finished, sessionStatusOf(finished), undefined)
    expect(events.map((event) => event.type)).toEqual(['item.started', 'item.completed', 'run.completed', 'session.status_changed'])
    expect(diffGraph(emptyProjectionMemory(), finished, sessionStatusOf(finished), undefined).events[0]?.type).toBe('run.started')
  })
})
