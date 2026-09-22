import { expect, it } from 'vitest'
import { WebSocket } from 'ws'
import { modelMessage, nativeClaudeAvailable, nativeClaudeFixture } from '../../../fixtures/terminal/claude-tui-fixture.js'

it.skipIf(!nativeClaudeAvailable())('rebinds both views after bubble and native /clear while keeping old transcripts', async () => {
  let calls = 0
  const fixture = await nativeClaudeFixture((body, reply) => modelMessage(body, reply, [{ type: 'text', text: `answer ${++calls}` }], `clear-${calls}`))
  let viewer: WebSocket | undefined
  try {
    fixture.send('first session message', 'first')
    await expect.poll(() => fixture.frames.some((frame) => frame.type === 'run.completed'), { timeout: 30000 }).toBe(true)
    const original = fixture.ref
    const controls: { type: string; sessionId?: string }[] = []
    viewer = new WebSocket(`${fixture.base}/terminal?${new URLSearchParams({ harness: 'claude', sessionId: original.id,
      model: `${fixture.profile.id}:claude-sonnet-4-6`, cwd: fixture.root, cols: '120', rows: '40' }).toString()}`)
    viewer.on('message', (data, binary) => { if (!binary) controls.push(JSON.parse(Buffer.isBuffer(data) ? data.toString('utf8') : Buffer.from(data as ArrayBuffer).toString('utf8')) as { type: string; sessionId?: string }) })
    await expect.poll(() => controls.some((frame) => frame.type === 'ready')).toBe(true)
    fixture.send('/clear', 'clear-bubble')
    await expect.poll(() => fixture.ref.id !== original.id, { timeout: 10000 }).toBe(true)
    const second = fixture.ref
    await expect.poll(() => controls.some((frame) => frame.type === 'rebound' && frame.sessionId === second.id)).toBe(true)
    expect(await fixture.terminals.isAlive(second)).toBe(true)
    expect(await fixture.terminals.isAlive(original)).toBe(false)
    expect(fixture.harness.sessionStream(original).snapshot().messages.some((message) => message.content === 'first session message')).toBe(true)
    expect(fixture.harness.sessionStream(second).snapshot().messages).toHaveLength(0)
    fixture.send('second session message', 'second')
    await expect.poll(() => fixture.frames.some((frame) => frame.type === 'run.completed' && frame.runId === 'second'), { timeout: 10000 }).toBe(true)
    viewer.send(Buffer.from('/clear\r'))
    await expect.poll(() => fixture.ref.id !== second.id, { timeout: 10000 }).toBe(true)
    fixture.send('third session message', 'third')
    await expect.poll(() => fixture.frames.some((frame) => frame.type === 'run.completed' && frame.runId === 'third'), { timeout: 10000 }).toBe(true)
    await expect.poll(() => fixture.harness.sessionStream(fixture.ref).snapshot().messages.filter((message) => message.role === 'user' && !message.content.includes('<command-name>/clear')).map((message) => message.content)).toEqual(['third session message'])
    expect(fixture.sdkOpen).not.toHaveBeenCalled()
  } catch (error) {
    if (fixture.ref.id && await fixture.terminals.isAlive(fixture.ref)) console.error(await fixture.terminals.capture(fixture.ref))
    console.error(fixture.frames.filter((frame) => ['error', 'run.failed', 'session.rebound'].includes(frame.type)))
    throw error
  } finally { viewer?.close(); await fixture.dispose() }
}, 60000)
