import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { WebSocket } from 'ws'
import type { StreamFrame } from '../../../../src/core/event/agent-event.js'
import { modelMessage, nativeClaudeAvailable, nativeClaudeFixture } from '../../../fixtures/terminal/claude-tui-fixture.js'

it.skipIf(!nativeClaudeAvailable())('renders native background notifications once throughout streaming, history refresh and reconnect', async () => {
  let finish!: () => void, finishHuman!: () => void
  const done = new Promise<void>((resolve) => { finish = resolve })
  const humanDone = new Promise<void>((resolve) => { finishHuman = resolve })
  let calls = 0
  const fixture = await nativeClaudeFixture(async (body, reply) => {
    if (++calls === 1) return modelMessage(body, reply, [{ type: 'tool_use', id: 'background-tool', name: 'Bash',
      input: { command: `while [ ! -f '${join(fixture.root, 'release-task')}' ]; do sleep 0.1; done; printf 'worker finished\\n'`,
        description: 'Background notification regression', run_in_background: true } }], 'launch')
    if (calls === 2) return modelMessage(body, reply, [{ type: 'text', text: 'Started background task.' }], 'started')
    const notificationReply = calls === 3
    reply.hijack()
    reply.raw.writeHead(200, { 'content-type': 'text/event-stream' })
    const emit = (event: Record<string, unknown>) => reply.raw.write(`event: ${String(event['type'])}\ndata: ${JSON.stringify(event)}\n\n`)
    emit({ type: 'message_start', message: { id: notificationReply ? 'notification-reply' : 'human-reply', type: 'message', role: 'assistant', model: body.model,
      content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 10, output_tokens: 0 } } })
    emit({ type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } })
    emit({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: notificationReply ? 'Background result first line.\n' : 'Human reply first line.\n' } })
    await (notificationReply ? done : humanDone)
    emit({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Result complete.' } })
    emit({ type: 'content_block_stop', index: 0 })
    emit({ type: 'message_delta', delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: 20 } })
    emit({ type: 'message_stop' })
    reply.raw.end()
  })
  let reader: WebSocket | undefined
  try {
    fixture.send('Run the background notification fixture', 'background-launch')
    await expect.poll(() => fixture.frames.some((frame) => frame.type === 'run.completed' && frame.runId === 'background-launch'), { timeout: 30000 }).toBe(true)
    await writeFile(join(fixture.root, 'release-task'), '')
    const messages = () => fixture.harness.sessionStream(fixture.ref).snapshot().messages
    await expect.poll(() => messages().some((message) => message.content.includes('Background result first line.')), { timeout: 15000 }).toBe(true)
    const started = fixture.frames.filter((frame) => frame.type === 'run.started').at(-1)
    const notificationXml = (await fixture.terminals.state(fixture.ref))?.prompt
    expect(notificationXml).toContain('<task-notification>')
    expect(started).toMatchObject({ driver: 'terminal' })
    expect(started).not.toHaveProperty('userMessage')
    expect(messages().filter((message) => message.role === 'user')).toHaveLength(1)
    expect(messages().filter((message) => message.role === 'assistant')).toHaveLength(1)
    expect(messages().flatMap((message) => message.blocks ?? []).filter((block) => block.type === 'task_notification')).toHaveLength(1)

    const reconnected: StreamFrame[] = []
    reader = new WebSocket(`${fixture.base}/session`)
    reader.on('message', (raw) => reconnected.push(JSON.parse(Buffer.isBuffer(raw) ? raw.toString('utf8') : Buffer.from(raw as ArrayBuffer).toString('utf8')) as StreamFrame))
    await new Promise<void>((resolve) => reader?.once('open', resolve))
    reader.send(JSON.stringify({ type: 'session.subscribe', harness: 'claude', sessionId: fixture.ref.id, sinceSeq: 0 }))
    await expect.poll(() => reconnected.some((frame) => frame.type === 'session.snapshot' && frame.messages.some((message) => message.content.includes('Background result first line.')))).toBe(true)
    finish()
    await expect.poll(() => fixture.frames.some((frame) => frame.type === 'run.completed' && frame.runId === started?.runId), { timeout: 10000 }).toBe(true)
    await expect.poll(() => messages().filter((message) => message.role === 'assistant').map((message) => message.content))
      .toEqual(['Background result first line.\nResult complete.'])
    const snapshots = [...fixture.frames, ...reconnected].filter((frame) => frame.type === 'session.snapshot')
    expect(snapshots.every((frame) => frame.messages.filter((message) => message.role === 'user').every((message) => message.content === 'Run the background notification fixture'))).toBe(true)
    expect(snapshots.every((frame) => frame.messages.filter((message) => message.content.includes('Background result first line.')).length <= 1)).toBe(true)

    // Native keystrokes have the same hook shape. Pasting the exact notification
    // is nevertheless human input; its native user record must remain visible.
    await fixture.terminals.submit(fixture.ref, notificationXml ?? '', new AbortController().signal)
    await expect.poll(() => messages().some((message) => message.content.includes('Human reply first line.')), { timeout: 10000 }).toBe(true)
    expect(messages().filter((message) => message.role === 'user').map((message) => message.content.trim()))
      .toEqual(['Run the background notification fixture', notificationXml?.trim()])
    expect(messages().filter((message) => message.role === 'assistant')).toHaveLength(2)
    expect(messages().at(-1)?.content).toBe('Human reply first line.\n')
    finishHuman()
    await expect.poll(() => fixture.harness.sessionStream(fixture.ref).snapshot().activeRunId, { timeout: 10000 }).toBeUndefined()
    expect(fixture.sdkOpen).not.toHaveBeenCalled()
  } catch (error) {
    console.error(await fixture.terminals.capture(fixture.ref), await fixture.terminals.state(fixture.ref),
      fixture.frames.filter((frame) => ['error', 'run.failed', 'run.started'].includes(frame.type)),
      JSON.stringify(fixture.harness.sessionStream(fixture.ref).snapshot().messages.map((message) => ({
        id: message.id, content: message.content, createdAt: message.createdAt,
        notices: message.blocks?.filter((block) => block.type === 'task_notification'),
      }))))
    throw error
  } finally {
    await writeFile(join(fixture.root, 'release-task'), '')
    finish()
    finishHuman()
    reader?.close()
    await fixture.dispose()
  }
}, 60000)
