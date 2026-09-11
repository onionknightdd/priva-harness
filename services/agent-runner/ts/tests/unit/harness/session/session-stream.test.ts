import { describe, expect, it } from 'vitest'
import { SessionStream } from '../../../../src/harness/session/session-stream.js'
import type { StreamFrame } from '../../../../src/core/event/agent-event.js'

describe('session stream', () => {
  it('serializes task persistence and restores confirmed terminal states after a process restart', async () => {
    const writes: unknown[] = []
    const stream = new SessionStream({ provider: 'claude', id: 's' }, [], 4096,
      (tasks) => { writes.push(tasks); return Promise.resolve() })
    stream.publish({ type: 'task.updated', task: { taskId: 'job', toolUseId: 'tool', kind: 'bash', status: 'running' } })
    stream.publish({ type: 'task.notification', task: { taskId: 'job', kind: 'bash', status: 'cancelled' } })
    await stream.flush()
    expect(writes).toHaveLength(2)
    const restored = new SessionStream(stream.session, [], 4096, undefined, stream.tasks.list())
    expect(restored.snapshot().tasks[0]).toMatchObject({ toolUseId: 'tool', status: 'cancelled', stopRequested: false })
  })

  it('updates the original task card across replies and snapshots without inventing a model run', () => {
    const stream = new SessionStream({ provider: 'claude', id: 's' })
    stream.publish({ type: 'run.started' }, 'one')
    stream.publish({ type: 'tool.started', messageId: 'm', blockId: 't', id: 't', name: 'bash' }, 'one')
    stream.publish({ type: 'task.updated', task: { taskId: 'job', toolUseId: 't', kind: 'bash', status: 'running' } }, 'one')
    stream.publish({ type: 'run.completed', model: 'm', durationMs: 1 }, 'one')
    stream.publish({ type: 'run.started' }, 'two')
    stream.publish({ type: 'task.notification', task: { taskId: 'job', kind: 'bash', status: 'completed', summary: 'done' } }, 'two')
    stream.publish({ type: 'run.completed', model: 'm', durationMs: 1 }, 'two')
    const snapshot = stream.snapshot()
    expect(snapshot.activeRunId).toBeUndefined()
    expect(snapshot.tasks).toMatchObject([{ originRunId: 'one', toolUseId: 't', status: 'completed' }])
    expect(snapshot.messages[0]?.blocks?.[0]).toMatchObject({ tool: { backgroundTask: { status: 'completed' } } })
    expect(snapshot.messages).toHaveLength(1)
  })

  it('replays with a session cursor and resets coherently on overflow or process change', () => {
    const stream = new SessionStream({ provider: 'claude', id: 's' }, [], 2)
    const first = stream.publish({ type: 'run.started' }, 'one')
    stream.publish({ type: 'run.completed', model: 'm', durationMs: 1 }, 'one')
    const replay: StreamFrame[] = []
    const stop = stream.subscribe((frame) => replay.push(frame), { streamId: first.streamId ?? '', seq: first.seq })
    expect(replay.map((frame) => frame.type)).toEqual(['run.completed'])
    stop()
    stream.publish({ type: 'task.updated', task: { taskId: 'long-monitor', kind: 'monitor', status: 'running' } })
    const reset: StreamFrame[] = []
    stream.subscribe((frame) => reset.push(frame), { streamId: first.streamId ?? '', seq: 0 })()
    expect(reset.map((frame) => frame.type)).toEqual(['replay.gap', 'session.snapshot'])
    expect(reset[1]).toMatchObject({ tasks: [{ taskId: 'long-monitor', status: 'running' }] })
    const restarted: StreamFrame[] = []
    stream.subscribe((frame) => restarted.push(frame), { streamId: 'old-process', seq: 999 })()
    expect(restarted.map((frame) => frame.type)).toEqual(['replay.gap', 'session.snapshot'])
  })

  it('does not assume a saved unfinished job survived a process restart', () => {
    const stream = new SessionStream({ provider: 'claude', id: 's' }, [{
      id: 'm', role: 'assistant', status: 'complete', content: '', createdAt: new Date(0).toISOString(),
      blocks: [{ type: 'tool_use', id: 't', blockId: 't', index: 0, name: 'bash', tool: {
        id: 't', name: 'bash', status: 'completed', backgroundTask: { taskId: 'job', kind: 'bash', status: 'running' },
      } }],
    }])
    expect(stream.snapshot().tasks[0]?.status).toBe('unknown')
  })
})
