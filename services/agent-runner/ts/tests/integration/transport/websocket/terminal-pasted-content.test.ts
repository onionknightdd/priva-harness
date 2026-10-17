import { WebSocket } from 'ws'
import { expect, it } from 'vitest'

import type { StreamFrame } from '../../../../src/core/event/agent-event.js'
import { modelMessage, nativeClaudeAvailable, nativeClaudeFixture } from '../../../fixtures/terminal/claude-tui-fixture.js'

it.skipIf(!nativeClaudeAvailable())('reconciles a real native paste during generation, on completion, and after reconnect', async () => {
  let release: () => void = () => undefined
  let calls = 0
  const answer = new Promise<void>((resolve) => { release = resolve })
  const fixture = await nativeClaudeFixture(async (body, reply) => {
    await answer
    return modelMessage(body, reply, [{ type: 'text', text: 'Native paste accepted' }], `paste-${++calls}`)
  })
  let reconnected: WebSocket | undefined
  try {
    // Claude Code 2.1.301 sends bracketed terminal pastes as plain prompt text.
    // Older transcripts may still contain <pasted_content> envelopes; the decoder
    // covers those without this live path emitting one.
    const text = '后台启动一个子agent , 每秒echo 1, 执行30s'
    fixture.send(text, 'pasted')
    await expect.poll(() => fixture.requests.length, { timeout: 15000 }).toBe(1)
    const content = fixture.requests[0]?.messages.at(-1)?.content
    const modelText = typeof content === 'string' ? content : content?.map((block) => typeof block['text'] === 'string' ? block['text'] : '').join('')
    expect(modelText).toContain(text)
    expect(modelText).not.toContain('<pasted_content')
    const snapshot = () => fixture.harness.sessionStream(fixture.ref).snapshot()
    await expect.poll(() => snapshot().messages.find((message) => message.role === 'user')?.id).not.toBe('pasted:user')
    expect(snapshot().messages.filter((message) => message.role === 'user').map((message) => message.content)).toEqual([text])
    expect(snapshot().messages.filter((message) => message.role === 'assistant')).toHaveLength(1)
    release()
    await expect.poll(() => fixture.frames.some((frame) => frame.type === 'run.completed' && frame.runId === 'pasted'), { timeout: 15000 }).toBe(true)
    expect(snapshot().messages.map((message) => message.content)).toEqual([text, 'Native paste accepted'])
    fixture.socket.close()
    reconnected = new WebSocket(`${fixture.base}/session`)
    const frames: StreamFrame[] = []
    reconnected.on('message', (raw) => frames.push(JSON.parse(Buffer.isBuffer(raw) ? raw.toString('utf8') : Buffer.from(raw as ArrayBuffer).toString('utf8')) as StreamFrame))
    await new Promise<void>((resolve) => reconnected?.once('open', resolve))
    reconnected.send(JSON.stringify({ type: 'session.subscribe', harness: 'claude', sessionId: fixture.ref.id }))
    await expect.poll(() => frames.find((frame) => frame.type === 'session.snapshot')?.messages.map((message) => message.content))
      .toEqual([text, 'Native paste accepted'])
    // The same words submitted again in the native TUI are a distinct turn.
    await fixture.terminals.submit(fixture.ref, `${text}\n`, new AbortController().signal)
    await expect.poll(() => fixture.requests.length, { timeout: 15000 }).toBe(2)
    await expect.poll(() => snapshot().activeRunId, { timeout: 15000 }).toBeUndefined()
    expect(snapshot().messages.map((message) => message.content)).toEqual([text, 'Native paste accepted', text, 'Native paste accepted'])
    expect(fixture.frames.some((frame) => frame.type === 'run.failed')).toBe(false)
    expect(fixture.sdkOpen).not.toHaveBeenCalled()
  } finally { release(); reconnected?.close(); await fixture.dispose() }
}, 45000)
