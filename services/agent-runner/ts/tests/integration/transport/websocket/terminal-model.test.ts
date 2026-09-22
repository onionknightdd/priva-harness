import { expect, it } from 'vitest'
import type { TerminalAttachment } from '../../../../src/core/contract/terminal-service.js'
import { modelMessage, nativeClaudeAvailable, nativeClaudeFixture } from '../../../fixtures/terminal/claude-tui-fixture.js'

it.skipIf(!nativeClaudeAvailable())('applies the bubble model selection to the same native Claude process before sending', async () => {
  let calls = 0
  const fixture = await nativeClaudeFixture((body, reply) => modelMessage(body, reply, [{ type: 'text', text: `model answer ${++calls}` }], `model-${calls}`))
  let viewer: TerminalAttachment | undefined
  try {
    fixture.send('before model switch', 'first')
    await expect.poll(() => fixture.frames.some((frame) => frame.type === 'run.completed' && frame.runId === 'first'), { timeout: 30000 }).toBe(true)
    const before = await fixture.terminals.state(fixture.ref)
    fixture.send('after model switch', 'second', 'claude-opus-4-6')
    await expect.poll(() => fixture.frames.some((frame) => frame.type === 'run.completed' && frame.runId === 'second'), { timeout: 20000 }).toBe(true)
    const modelRequest = fixture.requests.find((request) => JSON.stringify(request.messages).includes('after model switch'))
    expect(modelRequest?.model).toBe('claude-opus-4-6')
    expect((await fixture.terminals.state(fixture.ref))?.instanceId).toBe(before?.instanceId)
    viewer = await fixture.terminals.attach(fixture.ref, 120, 40)
    const exits: string[] = []
    viewer.onExit((reason) => exits.push(reason))
    const session = fixture.ref.id
    const replacement = await fixture.services.modelProfileService.createProfile({ label: 'Other profile',
      baseUrl: fixture.profile.baseUrl, authToken: 'other-fixture-token', defaultModel: 'claude-opus-4-6' })
    fixture.send('after profile switch', 'third', 'claude-opus-4-6', { profileId: replacement.id, effort: 'high' })
    await expect.poll(() => fixture.frames.some((frame) => frame.type === 'run.completed' && frame.runId === 'third'), { timeout: 20000 }).toBe(true)
    expect(fixture.ref.id).toBe(session)
    expect((await fixture.terminals.state(fixture.ref))?.instanceId).not.toBe(before?.instanceId)
    expect(JSON.stringify(fixture.requests.at(-1)?.messages)).toContain('before model switch')
    fixture.send('after effort switch', 'fourth', 'claude-opus-4-6', { profileId: replacement.id, effort: 'low' })
    await expect.poll(() => fixture.frames.some((frame) => frame.type === 'run.completed' && frame.runId === 'fourth'), { timeout: 20000 }).toBe(true)
    expect(fixture.requests.at(-1)).toMatchObject({ output_config: { effort: 'low' } })
    await fixture.terminals.submit(fixture.ref, '/effort high', new AbortController().signal)
    await expect.poll(() => fixture.terminals.capture(fixture.ref)).toContain('Change effort level?')
    await fixture.terminals.sendKeys(fixture.ref, ['Enter'])
    await expect.poll(() => fixture.frames.filter((frame) => frame.type === 'session.config').at(-1)).toMatchObject({ config: { effort: 'high', profileId: replacement.id } })
    const extendedInstance = (await fixture.terminals.state(fixture.ref))?.instanceId
    fixture.send('Use extended context', 'extended', 'claude-opus-4-6[1m]', { profileId: replacement.id, effort: 'high' })
    await expect.poll(() => fixture.frames.some((frame) => frame.type === 'run.completed' && frame.runId === 'extended'), { timeout: 20000 }).toBe(true)
    expect((await fixture.terminals.state(fixture.ref))?.instanceId).toBe(extendedInstance)
    expect(fixture.frames.filter((frame) => frame.type === 'session.config').at(-1)).toMatchObject({ config: { model: 'claude-opus-4-6[1m]', context: { limit: 1000000 } } })
    expect(exits).toEqual([])
    expect(fixture.sdkOpen).not.toHaveBeenCalled()
  } catch (error) {
    console.error(await fixture.terminals.capture(fixture.ref), fixture.frames.filter((frame) => frame.type === 'error' || frame.type === 'run.failed'))
    throw error
  } finally { await viewer?.detach(); await fixture.dispose() }
}, 60000)
