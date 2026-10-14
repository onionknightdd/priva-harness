import { expect, it } from 'vitest'
import { SessionCompaction } from '../../../../src/harness/session/session-compaction.js'
import { SessionStream } from '../../../../src/harness/session/session-stream.js'
import type { ThreadMessage } from '../../../../src/core/resource/thread.js'

const at = '2026-01-01T00:00:00.000Z'
const user = (id: string, content = 'Continue'): ThreadMessage => ({ id, role: 'user', content, createdAt: at, status: 'complete' })
const assistant = (id: string, content: string): ThreadMessage => ({ id, role: 'assistant', content, createdAt: at, status: 'complete',
  blocks: [{ type: 'text', blockId: `${id}:text`, index: 0, text: content }] })

it('does not let a failed automatic attempt claim a later successful native compaction', () => {
  const state = new SessionCompaction()
  const prompt = user('prompt')
  let messages: readonly ThreadMessage[] = [prompt]
  for (const [id, event] of [
    ['failed', { type: 'session.compacting', reason: 'auto' }],
    ['failed', { type: 'session.compaction_failed', reason: 'auto', message: 'temporary failure' }],
    ['succeeded', { type: 'session.compacting', reason: 'auto' }],
    ['succeeded', { type: 'session.compacted', reason: 'auto', summary: 'Kept context' }],
  ] as const) messages = state.apply(messages, event, 'run', prompt, id, at)?.messages ?? messages
  const native = { ...user('native-success', '/compact'), compact: { phase: 'compacted' as const, summary: 'Kept context' } }
  const result = state.reconcile([prompt, native])
  expect(result.find((message) => message.id === native.id)?.compact).toEqual(native.compact)
  expect(result.filter((message) => message.compact).map((message) => message.compact?.phase)).toEqual(['failed', 'compacted'])
})

it('keeps post-compaction display text below the marker while the native boundary is still absent', () => {
  const prompt = user('native-prompt')
  const stream = new SessionStream({ provider: 'claude', id: 's' })
  stream.startTerminalTurn('run', 'm', { ...prompt, id: 'run:user' }, false)
  stream.replaceHistory([prompt, assistant('native-before', 'Before')])
  stream.publishTerminalText({ sessionId: 's', turnId: 'turn', messageId: 'before', index: 0, text: 'Before', final: true })
  stream.publish({ type: 'session.compacting', reason: 'auto' }, 'run')
  stream.publish({ type: 'session.compacted', reason: 'auto', summary: 'Kept context' }, 'run')
  stream.publishTerminalText({ sessionId: 's', turnId: 'turn', messageId: 'after', index: 0, text: 'After', final: true })
  expect(stream.snapshot().messages.map((message) => message.content)).toEqual(['Continue', 'Before', '/compact', 'After'])
})

it('keeps an unpersisted failed marker after its turn when native user and assistant ids replace live ids', () => {
  const state = new SessionCompaction()
  const prompt = user('run:user')
  const before = assistant('run', 'Before')
  let messages: readonly ThreadMessage[] = [prompt, before]
  messages = state.apply(messages, { type: 'session.compacting', reason: 'auto' }, 'run', prompt, 'failed', at)?.messages ?? messages
  state.apply(messages, { type: 'session.compaction_failed', reason: 'auto', message: 'temporary failure' }, 'run', prompt, 'failed', at)
  const result = state.reconcile([user('native-user'), assistant('native-before', 'Before')])
  expect(result.map((message) => message.content)).toEqual(['Continue', 'Before', '/compact'])
})
