import { expect, it } from 'vitest'
import { SessionStream } from '../../../../src/harness/session/session-stream.js'
import type { ThreadMessage } from '../../../../src/core/resource/thread.js'

const user: ThreadMessage = { id: 'native-user', role: 'user', content: 'question', createdAt: new Date(0).toISOString(), status: 'complete' }
const native = (text: string): ThreadMessage => ({ id: 'native-assistant', role: 'assistant', content: text,
  createdAt: user.createdAt, status: 'complete', blocks: [{ type: 'text', blockId: 'native-text', index: 0, text }] })
const delta = (text: string, index: number, messageId = 'display-1', final = false) => ({ sessionId: 's', turnId: 'turn', messageId, index, text, final })

it('keeps streamed text through disk snapshots, reordered/duplicate flushes, tool calls, and final reconciliation', () => {
  const stream = new SessionStream({ provider: 'claude', id: 's' })
  stream.publish({ type: 'run.started', driver: 'terminal', userMessage: { ...user, id: 'r:user' } }, 'r')
  stream.replaceHistory([user])
  stream.publishTerminalText(delta('two\n', 1))
  stream.publishTerminalText(delta('one\n', 0))
  stream.publishTerminalText(delta('one\n', 0))
  expect(stream.snapshot().messages.at(-1)?.content).toBe('one\ntwo\n')
  stream.replaceHistory([user])
  expect(stream.snapshot().messages.at(-1)?.content).toBe('one\ntwo\n')
  stream.publishTerminalText(delta('', 2, 'display-1', true))
  const first = native('one\ntwo\n')
  const tool = { type: 'tool_use', blockId: 'tool', id: 'tool', name: 'Read', index: 1 } as const
  stream.replaceHistory([user, { ...first, blocks: [...(first.blocks ?? []), tool] }])
  stream.publishTerminalText(delta('last answer', 0, 'display-2', true))
  const during = stream.snapshot().messages.at(-1)
  expect(during?.blocks?.map((block) => block.type)).toEqual(['text', 'tool_use', 'text'])
  expect(during?.content).toBe('last answer')
  const final = { ...first, content: 'last answer', blocks: [...(first.blocks ?? []), tool,
    { type: 'text', blockId: 'last-native', index: 2, text: 'last answer' } as const] }
  stream.replaceHistory([user, final])
  stream.publishTerminalText(delta('last answer', 0, 'display-2', true))
  stream.publish({ type: 'run.completed', model: 'm', durationMs: 1 }, 'r')
  expect(stream.snapshot().messages).toMatchObject([user, final])
})

it('does not duplicate display deltas that arrive after their transcript or erase pending questions on a history refresh', () => {
  const stream = new SessionStream({ provider: 'claude', id: 's' })
  stream.publish({ type: 'run.started', driver: 'terminal', userMessage: { ...user, id: 'r:user' } }, 'r')
  stream.replaceHistory([user, native('saved first')])
  stream.publishTerminalText(delta('saved ', 0))
  stream.publishTerminalText(delta('first', 1, 'display-1', true))
  const request = { kind: 'question', requestId: 'ask', tool: 'AskUserQuestion', input: {}, questions: [], expiresAt: Date.now() + 10000 } as const
  stream.publish({ type: 'permission.requested', request }, 'r')
  stream.replaceHistory([user, native('saved first')])
  expect(stream.snapshot().messages.at(-1)?.content).toBe('saved first')
  expect(stream.snapshot().interactions).toEqual([request])
})

it('recovers a running native turn with a saved assistant prefix, even when the previous prompt was identical', () => {
  const currentUser = { ...user, id: 'current-user', createdAt: new Date(10).toISOString() }
  const currentAssistant = { ...native('partial'), id: 'current-assistant' }
  const stream = new SessionStream({ provider: 'claude', id: 's' }, [user, native('old answer'), currentUser, currentAssistant])
  stream.publish({ type: 'run.started', driver: 'terminal', userMessage: { ...currentUser, id: 'recovered:user', createdAt: new Date(9).toISOString() } }, 'recovered')
  stream.publishTerminalText(delta('partial', 0, 'display-1', true))
  stream.publishTerminalText(delta('continued', 0, 'display-2', true))
  expect(stream.snapshot().messages.map((message) => message.id)).toEqual(['native-user', 'native-assistant', 'current-user', 'current-assistant'])
  expect(stream.snapshot().messages.at(-1)?.content).toBe('continued')
})
