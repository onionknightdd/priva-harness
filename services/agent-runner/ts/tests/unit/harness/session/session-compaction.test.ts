import { describe, expect, it } from 'vitest'
import { SessionStream } from '../../../../src/harness/session/session-stream.js'
import type { ThreadMessage } from '../../../../src/core/resource/thread.js'
import type { StreamFrame } from '../../../../src/core/event/agent-event.js'

const user = (id: string, content: string): ThreadMessage => ({ id, role: 'user', content, createdAt: '2026-10-14T00:00:00.000Z', status: 'complete' })
const markers = (stream: SessionStream) => stream.snapshot().messages.filter((message) => message.compact)
const start = (stream: SessionStream, id: string, text = '/compact') => stream.startTerminalTurn(id, 'model', user(`${id}:user`, text), false, true)

describe('session compaction identity and snapshots', () => {
  it('saves completion without a summary and preserves it through native IDs and stale history', () => {
    const stream = new SessionStream({ provider: 'claude', id: 's' })
    start(stream, 'one')
    const beginning = stream.publish({ type: 'session.compacting' }, 'one')
    expect(beginning.compactMessage).toMatchObject({ id: 'one:user', compact: { phase: 'compacting' } })
    stream.publish({ type: 'session.compacted' }, 'one')
    const native = { ...user('native', '/compact'), compact: { phase: 'queued' as const } }
    stream.replaceHistory([native])
    stream.publish({ type: 'run.completed', model: 'model', durationMs: 1 }, 'one')
    stream.replaceHistory([native])
    expect(markers(stream)).toEqual([expect.objectContaining({ id: 'native', renderId: 'one:user', compact: { phase: 'compacted' } })])
    const reconnect: StreamFrame[] = []
    stream.subscribe((frame) => reconnect.push(frame))()
    expect(reconnect).toHaveLength(1)
    const frame = reconnect[0]
    expect(frame?.type).toBe('session.snapshot')
    if (frame?.type === 'session.snapshot') expect(frame.messages).toEqual(stream.snapshot().messages)
  })

  it('appends automatic compaction after the latest output and continues below its boundary', () => {
    const old = { ...user('old', '/compact'), createdAt: '2026-10-13T00:00:00.000Z', compact: { phase: 'compacted' as const, summary: 'old summary' } }
    const stream = new SessionStream({ provider: 'pi', id: 's' }, [old])
    start(stream, 'one', 'continue working')
    stream.publish({ type: 'assistant.delta', messageId: 'before', blockId: 'before', index: 0, text: 'Before compression' }, 'one')
    const beginning = stream.publish({ type: 'session.compacting', reason: 'auto' }, 'one')
    expect(beginning.compactAfterMessageId).toBe('one')
    expect(stream.snapshot().messages.at(-1)?.id).toBe(beginning.compactMessage?.id)
    stream.publish({ type: 'session.compacted', reason: 'auto', summary: 'new summary' }, 'one')
    expect(stream.snapshot().activeRunId).toBe('one')
    expect(stream.snapshot().messages.find((message) => message.id === 'one')?.status).toBe('streaming')
    const continued = stream.publish({ type: 'assistant.delta', messageId: 'after', blockId: 'after', index: 0, text: 'After compression' }, 'one')
    expect(continued.messageTargetId).not.toBe('one')
    expect(stream.snapshot().messages.map((message) => message.content)).toEqual(['/compact', 'continue working', 'Before compression', '/compact', 'After compression'])
    expect(markers(stream).map((message) => message.compact?.summary)).toEqual(['old summary', 'new summary'])
    stream.publish({ type: 'run.completed', model: 'model', durationMs: 1 }, 'one')
    expect(stream.snapshot().messages.at(-1)?.status).toBe('complete')
  })

  it('keeps consecutive automatic operations distinct when native history arrives later', () => {
    const stream = new SessionStream({ provider: 'pi', id: 's' })
    start(stream, 'run', 'work')
    stream.publish({ type: 'session.compacting', reason: 'auto' }, 'run')
    stream.publish({ type: 'session.compacted', reason: 'auto', summary: 'first' }, 'run')
    stream.publish({ type: 'session.compacting', reason: 'auto' }, 'run')
    stream.publish({ type: 'session.compacted', reason: 'auto', summary: 'second' }, 'run')
    stream.replaceHistory([user('run:user', 'work'),
      { ...user('native-first', '/compact'), compact: { phase: 'compacted', summary: 'first' } },
      { ...user('native-second', '/compact'), compact: { phase: 'compacted', summary: 'second' } }])
    expect(markers(stream).map((message) => [message.id, message.compact?.summary])).toEqual([['native-first', 'first'], ['native-second', 'second']])
  })

  it.each(['session.compaction_failed', 'session.compaction_cancelled'] as const)('continues below an automatic %s boundary without duplicating replayed text', (type) => {
    const stream = new SessionStream({ provider: 'pi', id: 's' })
    start(stream, 'run', 'continue working')
    stream.publish({ type: 'assistant.delta', messageId: 'before', blockId: 'before', index: 0, text: 'Before compression' }, 'run')
    stream.publish({ type: 'session.compacting', reason: 'auto' }, 'run')
    stream.publish({ type, reason: 'auto', message: 'Compaction stopped' }, 'run')
    expect(stream.snapshot().activeRunId).toBe('run')
    const continued = stream.publish({ type: 'assistant.delta', messageId: 'after', blockId: 'after', index: 0, text: 'After compression' }, 'run')
    expect(continued.messageTargetId).not.toBe('run')
    expect(stream.snapshot().messages.map((message) => message.content)).toEqual(['continue working', 'Before compression', '/compact', 'After compression'])
    expect(markers(stream)[0]?.compact).toEqual({ phase: type === 'session.compaction_failed' ? 'failed' : 'cancelled', message: 'Compaction stopped' })
    stream.publish({ type: 'run.completed', model: 'model', durationMs: 1 }, 'run')

    // A failed/cancelled native attempt has no compaction entry, so replay folds
    // both answer parts into one assistant. The live boundary must split it once.
    stream.replaceHistory([user('native-user', 'continue working'), {
      id: type === 'session.compaction_failed' ? 'native-answer' : 'run', role: 'assistant', content: 'After compression', createdAt: '2026-10-14T00:00:01.000Z', status: 'complete',
      blocks: [
        { type: 'text', blockId: 'before', index: 0, text: 'Before compression' },
        { type: 'text', blockId: 'after', index: 1, text: 'After compression' },
      ],
    }])
    const messages = stream.snapshot().messages
    expect(messages.map((message) => message.content)).toEqual(['continue working', 'Before compression', '/compact', 'After compression'])
    expect(messages.flatMap((message) => (message.blocks ?? []).flatMap((block) => block.type === 'text' ? [block.text] : [])))
      .toEqual(['Before compression', 'After compression'])
    expect(messages.at(-1)?.status).toBe('complete')
  })

  it.each(['run.failed', 'run.aborted'] as const)('settles a manual command when %s arrives before compaction starts', (type) => {
    const stream = new SessionStream({ provider: 'claude', id: 's' })
    start(stream, 'run')
    const outcome = stream.publish({ type, message: 'Stopped' }, 'run')
    expect(outcome.compactMessage?.id).toBe('run:user')
    expect(markers(stream)[0]?.compact?.phase).toBe(type === 'run.failed' ? 'failed' : 'cancelled')
    stream.replaceHistory([user('run:user', '/compact')])
    expect(markers(stream)[0]?.compact?.phase).toBe(type === 'run.failed' ? 'failed' : 'cancelled')
  })

  it('publishes and snapshots terminal-only failure without a run and does not change a previous marker', () => {
    const old = { ...user('old', '/compact'), compact: { phase: 'compacted' as const, summary: 'old' } }
    const stream = new SessionStream({ provider: 'pi', id: 's' }, [old, user('recent', 'last message')])
    const beginning = stream.publish({ type: 'session.compacting', reason: 'manual' })
    const ending = stream.publish({ type: 'session.compaction_failed', reason: 'manual', message: 'Nothing to compact' })
    expect(ending.compactMessage?.id).toBe(beginning.compactMessage?.id)
    expect(ending.compactAfterMessageId).toBe('recent')
    expect(markers(stream).map((message) => message.compact?.phase)).toEqual(['compacted', 'failed'])
    expect(stream.snapshot().activeRunId).toBeUndefined()
  })

  it('does not let a later run failure undo an already completed compaction', () => {
    const stream = new SessionStream({ provider: 'pi', id: 's' })
    start(stream, 'run', 'work')
    stream.publish({ type: 'session.compacting', reason: 'auto' }, 'run')
    stream.publish({ type: 'session.compacted', summary: 'done' }, 'run')
    stream.publish({ type: 'run.failed', message: 'A later tool failed' }, 'run')
    expect(markers(stream)[0]?.compact).toEqual({ phase: 'compacted', summary: 'done' })
  })
})
