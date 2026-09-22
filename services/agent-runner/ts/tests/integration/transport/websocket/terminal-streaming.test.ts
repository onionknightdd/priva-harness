import { expect, it } from 'vitest'
import { WebSocket } from 'ws'
import type { StreamFrame } from '../../../../src/core/event/agent-event.js'
import { nativeClaudeAvailable, nativeClaudeFixture } from '../../../fixtures/terminal/claude-tui-fixture.js'

it.skipIf(!nativeClaudeAvailable())('streams native text before response completion and reconciles reconnect/history without duplication', async () => {
  let second!: () => void, finish!: () => void
  const next = new Promise<void>((resolve) => { second = resolve })
  const done = new Promise<void>((resolve) => { finish = resolve })
  const fixture = await nativeClaudeFixture(async (body, reply) => {
    reply.hijack()
    reply.raw.writeHead(200, { 'content-type': 'text/event-stream' })
    const emit = (event: Record<string, unknown>) => reply.raw.write(`event: ${String(event['type'])}\ndata: ${JSON.stringify(event)}\n\n`)
    emit({ type: 'message_start', message: { id: 'native-stream', type: 'message', role: 'assistant', model: body.model,
      content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 10, output_tokens: 0 } } })
    emit({ type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } })
    emit({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: '第一段中文。\n' } })
    await next
    emit({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: '第二段中文。\n' } })
    await done
    emit({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: '结尾。' } })
    emit({ type: 'content_block_stop', index: 0 })
    emit({ type: 'message_delta', delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: 20 } })
    emit({ type: 'message_stop' }); reply.raw.end()
  })
  let reader: WebSocket | undefined
  try {
    fixture.send('分段回复', 'streaming')
    const messages = () => fixture.harness.sessionStream(fixture.ref).snapshot().messages
    await expect.poll(() => messages().some((message) => message.content.includes('第一段中文。')), { timeout: 30000 }).toBe(true)
    expect(fixture.frames.some((frame) => frame.type === 'run.completed')).toBe(false)
    second()
    await expect.poll(() => fixture.frames.some((frame) => frame.type === 'assistant.delta' && frame.text.includes('第二段中文。')), { timeout: 5000 }).toBe(true)
    const reconnected: StreamFrame[] = []
    reader = new WebSocket(`${fixture.base}/session`)
    reader.on('message', (raw) => reconnected.push(JSON.parse(Buffer.isBuffer(raw) ? raw.toString('utf8') : Buffer.from(raw as ArrayBuffer).toString('utf8')) as StreamFrame))
    await new Promise<void>((resolve) => reader?.once('open', resolve))
    reader.send(JSON.stringify({ type: 'session.subscribe', harness: 'claude', sessionId: fixture.ref.id, sinceSeq: 0 }))
    await expect.poll(() => reconnected.some((frame) => frame.type === 'session.snapshot' && frame.messages.some((message) => message.content.includes('第二段中文。')))).toBe(true)
    finish()
    await expect.poll(() => fixture.frames.some((frame) => frame.type === 'run.completed'), { timeout: 10000 }).toBe(true)
    await expect.poll(() => messages().filter((message) => message.role === 'assistant').map((message) => message.content)).toEqual(['第一段中文。\n第二段中文。\n结尾。'])
    expect(messages().filter((message) => message.role === 'user')).toHaveLength(1)
    expect(fixture.sdkOpen).not.toHaveBeenCalled()
  } catch (error) {
    console.error(await fixture.terminals.capture(fixture.ref), fixture.frames.filter((frame) => ['error', 'run.failed'].includes(frame.type)))
    throw error
  } finally { second(); finish(); reader?.close(); await fixture.dispose() }
}, 60000)
