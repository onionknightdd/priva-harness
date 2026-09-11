import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { AsyncQueue } from '../../../../src/core/stream/async-queue.js'
import { ClaudeRuntime, type ClaudeQuery } from '../../../../src/provider/claude/claude-runtime.js'
import type { AgentEvent } from '../../../../src/core/event/agent-event.js'
import { testRunSpec } from '../../../support/run-spec.js'

function fixture(configDir = '/tmp/claude') {
  const source = new AsyncQueue<SDKMessage>()
  const stopTask = vi.fn(() => Promise.resolve())
  const query: ClaudeQuery = {
    [Symbol.asyncIterator]: () => source.iterate()[Symbol.asyncIterator](),
    close: () => source.close(), interrupt: () => Promise.resolve(undefined), setModel: () => Promise.resolve(),
    getContextUsage: () => Promise.reject(new Error('unused')), stopTask,
  }
  const runtime = new ClaudeRuntime(testRunSpec(), { kind: 'resume', session: { provider: 'claude', id: 's' } }, configDir, ({ options }) => {
    expect(options.perTaskStopAffordance).toBe(true)
    return query
  })
  return { runtime, stopTask, push: (message: Record<string, unknown>) => source.push({ session_id: 's', ...message } as SDKMessage) }
}
async function collect(events: AsyncIterable<AgentEvent>) { const result: AgentEvent[] = []; for await (const event of events) result.push(event); return result }
const signal = new AbortController().signal
const result = { type: 'result', subtype: 'success', duration_ms: 1 }

describe('Claude background handoff', () => {
  it('delivers absorbed attachments before live continuation deltas without moving the earlier human response', async () => {
    const root = await mkdtemp(join(tmpdir(), 'claude-absorbed-'))
    const { runtime, push } = fixture(root)
    try {
      const seen: AgentEvent[] = []
      const consuming = (async () => { for await (const event of runtime.run({ text: 'Check progress' }, { signal })) seen.push(event) })()
      const before = { type: 'assistant', message: { id: 'before', content: [{ type: 'text', text: 'Checking now' }] } }
      push(before)
      await vi.waitFor(() => expect(seen.some((event) => event.type === 'assistant.message')).toBe(true))
      const attachments = [1, 3].map((id) => ({ type: 'attachment', uuid: `absorbed-${id}`, attachment: {
        type: 'queued_command', commandMode: 'task-notification',
        prompt: `<task-notification><task-id>worker-${id}</task-id><tool-use-id>tool-${id}</tool-use-id><status>completed</status><result>Actual result ${id}</result></task-notification>`,
      } }))
      await mkdir(join(root, 'projects', '-tmp'), { recursive: true })
      await writeFile(join(root, 'projects', '-tmp', 's.jsonl'), [before, ...attachments].map((record) => JSON.stringify(record)).join('\n') + '\n')
      for (const id of [1, 3]) push({ type: 'system', subtype: 'task_notification', task_id: `worker-${id}`, status: 'completed' })
      push({ type: 'stream_event', event: { type: 'message_start', message: { id: 'after' } } })
      push({ type: 'stream_event', event: { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } } })
      push({ type: 'stream_event', event: { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Both finished' } } })
      push({ type: 'assistant', message: { id: 'after', content: [{ type: 'text', text: 'Both finished' }] } })
      push(result)
      await consuming
      const deliveries = seen.filter((event) => event.type === 'task.delivered')
      expect(deliveries.map((event) => event.notification.turnId)).toEqual(['task-turn:absorbed-1', 'task-turn:absorbed-1'])
      expect(deliveries.map((event) => event.task.result)).toEqual(['Actual result 1', 'Actual result 3'])
      expect(seen.find((event) => event.type === 'assistant.message' && event.messageId === 'before')?.replyTo).toBeUndefined()
      const delta = seen.find((event) => event.type === 'assistant.delta')
      expect(delta?.replyTo).toMatchObject({ notificationIds: ['absorbed-1', 'absorbed-3'], turnId: 'task-turn:absorbed-1' })
      expect(seen.findIndex((event) => event === delta)).toBeGreaterThan(seen.findIndex((event) => event === deliveries[1]))
      expect(runtime.hasBackgroundTasks).toBe(false)
    } finally {
      await runtime.release('dispose')
      await rm(root, { recursive: true, force: true })
    }
  })

  it('buffers a completion during turn teardown and keeps tool identity for the idle follow-up', async () => {
    const { runtime, push, stopTask } = fixture()
    const idle: AgentEvent[] = []
    runtime.listenIdle((events) => idle.push(...events))
    const first = collect(runtime.run({ text: 'start' }, { signal }))
    push({ type: 'assistant', message: { model: 'm', id: 'm', content: [{ type: 'tool_use', id: 'tool', name: 'Bash', input: { run_in_background: true } }] } })
    push({ type: 'system', subtype: 'task_started', task_id: 'job', tool_use_id: 'tool', task_type: 'local_bash', is_backgrounded: true })
    push(result)
    push({ type: 'system', subtype: 'task_notification', task_id: 'job', status: 'completed', summary: 'done' })
    await first
    await runtime.release('warm')
    expect(idle).toContainEqual(expect.objectContaining({ type: 'task.notification', task: expect.objectContaining({ taskId: 'job', toolUseId: 'tool', status: 'completed' }) as unknown }))
    expect(runtime.hasBackgroundTasks).toBe(true)
    push({ type: 'user', uuid: 'notice', origin: { kind: 'task-notification' }, message: { role: 'user', content: '<task-notification><task-id>job</task-id><tool-use-id>tool</tool-use-id><status>completed</status><result>done</result></task-notification>' } })
    push({ type: 'assistant', message: { id: 'followup', content: [{ type: 'text', text: 'done' }] } })
    push(result)
    await vi.waitFor(() => expect(idle.some((event) => event.type === 'run.completed')).toBe(true))
    expect(runtime.hasBackgroundTasks).toBe(false)
    await runtime.stopTask('job')
    expect(stopTask).toHaveBeenCalledWith('job')
    await runtime.release('dispose')
  })

  it('uses native idle as the turn boundary when the runtime provides session state', async () => {
    const { runtime, push } = fixture()
    const seen: AgentEvent[] = []
    const consuming = (async () => { for await (const event of runtime.run({ text: 'start' }, { signal })) seen.push(event) })()
    push({ type: 'system', subtype: 'session_state_changed', state: 'running' })
    push(result)
    await vi.waitFor(() => expect(seen.some((event) => event.type === 'session.state')).toBe(true))
    expect(seen.some((event) => event.type === 'run.completed')).toBe(false)
    push({ type: 'system', subtype: 'session_state_changed', state: 'idle' })
    await consuming
    expect(seen.at(-1)?.type).toBe('run.completed')
    await runtime.release('dispose')
  })
})
