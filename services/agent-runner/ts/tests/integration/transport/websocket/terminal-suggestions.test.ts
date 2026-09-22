import { expect, it } from 'vitest'

import { modelMessage, nativeClaudeAvailable, nativeClaudeFixture } from '../../../fixtures/terminal/claude-tui-fixture.js'

it.skipIf(!nativeClaudeAvailable())('preserves a real multiline native draft while submitting a different bubble message', async () => {
  let calls = 0
  const fixture = await nativeClaudeFixture((body, reply) => modelMessage(body, reply,
    [{ type: 'text', text: `Answer ${++calls}` }], `draft-${calls}`))
  try {
    fixture.send('First message', 'first')
    await expect.poll(() => fixture.frames.some((frame) => frame.type === 'run.completed' && frame.runId === 'first'), { timeout: 15000 }).toBe(true)
    const draft = '保留第一行\n保留第二行 👋'
    await fixture.terminals.paste(fixture.ref, draft)
    await expect.poll(async () => (await fixture.terminals.composer(fixture.ref))?.text).toContain('保留第一行')
    fixture.send('A separate message', 'second')
    await expect.poll(() => fixture.frames.some((frame) => frame.type === 'run.completed' && frame.runId === 'second'), { timeout: 15000 }).toBe(true)
    expect(JSON.stringify(fixture.requests.at(-1)?.messages)).toContain('A separate message')
    expect(JSON.stringify(fixture.requests.at(-1)?.messages)).not.toContain('保留第一行')
    // Claude restores the stashed draft after submission. Continuation rows
    // have the native composer's two-column visual indentation.
    await expect.poll(async () => (await fixture.terminals.composer(fixture.ref))?.text)
      .toBe('保留第一行\n  保留第二行 👋')
    expect(fixture.frames.some((frame) => frame.type === 'run.failed')).toBe(false)
  } catch (error) {
    throw new Error(`${String(error)}\n${await fixture.terminals.capture(fixture.ref, { styled: true })}`, { cause: error })
  } finally { await fixture.dispose() }
}, 35000)
