import { expect, it } from 'vitest'
import { nativeClaudeAvailable, nativeClaudeFixture, modelMessage } from '../../../fixtures/terminal/claude-tui-fixture.js'
import { MemoryDataRecorder } from '../../../support/memory-data-recorder.js'

it.skipIf(!nativeClaudeAvailable()).each(['bubble', 'tui'])('settles persisted native usage on interruption and excludes it from the next turn (%s)', async (input) => {
  let calls = 0
  const recorder = new MemoryDataRecorder()
  const fixture = await nativeClaudeFixture((body, reply) => {
    calls++
    if (calls === 2) {
      reply.hijack()
      reply.raw.writeHead(200, { 'content-type': 'text/event-stream' })
      reply.raw.write(': waiting for interruption\n\n')
      return
    }
    return modelMessage(body, reply, calls === 1
      ? [{ type: 'tool_use', id: 'before-interrupt', name: 'Bash', input: { command: "printf 'usage-probe'" } }]
      : [{ type: 'text', text: 'Next turn completed' }], `interrupt-${calls}`)
  }, recorder)
  try {
    fixture.send('Run the fixture, then keep working', 'interrupted')
    await expect.poll(() => calls, { timeout: 30000 }).toBe(2)
    if (input === 'bubble') fixture.socket.send(JSON.stringify({ type: 'run.abort', harness: 'claude', sessionId: fixture.ref.id, runId: 'interrupted' }))
    else {
      await fixture.terminals.sendKeys(fixture.ref, ['Escape'])
      await fixture.harness.terminalInput(fixture.ref, Buffer.from('\x1b'))
    }
    await expect.poll(() => recorder.ofKind('run.finished').some((record) => record.runId === 'interrupted'), { timeout: 10000 }).toBe(true)
    const interrupted = recorder.ofKind('run.finished').find((record) => record.runId === 'interrupted')
    expect(interrupted).toMatchObject({ outcome: 'aborted', numTurns: 1,
      usage: { input: 10, output: 5 }, byModel: { 'claude-sonnet-4-6': { input: 10, output: 5 } } })
    expect(interrupted?.costUsd).toBeGreaterThan(0)
    fixture.send('Continue with a new turn', 'next-turn')
    await expect.poll(() => recorder.ofKind('run.finished').some((record) => record.runId === 'next-turn'), { timeout: 15000 }).toBe(true)
    expect(recorder.ofKind('run.finished')).toHaveLength(2)
    expect(recorder.ofKind('run.finished')[1]).toMatchObject({ outcome: 'completed', numTurns: 1, usage: { input: 10, output: 5 } })
    expect(fixture.sdkOpen).not.toHaveBeenCalled()
  } catch (error) {
    if (fixture.ref.id) console.error(await fixture.terminals.capture(fixture.ref))
    console.error(recorder.ofKind('run.finished'), fixture.frames.filter((frame) => frame.type === 'error'))
    throw error
  } finally { await fixture.dispose() }
}, 60000)
