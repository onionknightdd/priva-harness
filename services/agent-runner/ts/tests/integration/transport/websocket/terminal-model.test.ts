import { expect, it } from 'vitest'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { TerminalAttachment } from '../../../../src/core/contract/terminal-service.js'
import { modelMessage, nativeClaudeAvailable, nativeClaudeFixture } from '../../../fixtures/terminal/claude-tui-fixture.js'

it.skipIf(!nativeClaudeAvailable())('remaps inherited and explicit family-alias agents when the composer switches models', async () => {
  const agents = ['Explore', 'haiku', 'sonnet', 'opus', 'fable']
  const children: { turn: string; agent: string; model: string }[] = []
  const launched = new Set<string>()
  const fixture = await nativeClaudeFixture((body, reply) => {
    const child = /explore-model-child:(\w+):(\w+)/u.exec(JSON.stringify(body.messages.find((message) => message.role === 'user')?.content))
    if (child) {
      children.push({ turn: child[1] ?? '', agent: child[2] ?? '', model: body.model })
      return modelMessage(body, reply, [{ type: 'text', text: 'Exploration complete.' }], `child-${children.length}`)
    }
    const turn = [...JSON.stringify(body.messages).matchAll(/explore-model-parent:(\w+)/gu)].at(-1)?.[1]
    const agent = agents.find((agent) => !launched.has(`${turn}-${agent}`))
    if (turn && agent && body.tools?.some((tool) => tool['name'] === 'Agent')) {
      launched.add(`${turn}-${agent}`)
      return modelMessage(body, reply, [{ type: 'tool_use', id: `${agent}-${turn}`, name: 'Agent', input: {
        subagent_type: agent === 'Explore' ? 'Explore' : 'general-purpose', description: 'Check selected model',
        prompt: `explore-model-child:${turn}:${agent} Reply OK without tools.`, run_in_background: false,
        ...(agent === 'Explore' ? {} : { model: agent }),
      } }], `launch-${turn}-${agent}`)
    }
    return modelMessage(body, reply, [{ type: 'text', text: 'Done.' }])
  })
  try {
    await mkdir(join(fixture.root, '.claude'))
    const projectSettings = '{"env":{"ANTHROPIC_DEFAULT_HAIKU_MODEL":"project-haiku"}}'
    await writeFile(join(fixture.root, '.claude', 'settings.json'), projectSettings)
    await writeFile(join(fixture.configDir, 'settings.json'), '{"env":{"KEEP":"value","ANTHROPIC_DEFAULT_OPUS_MODEL":"old-opus"}}')
    let instance: string | undefined
    for (const turn of ['first', 'second']) {
      fixture.send(`explore-model-parent:${turn}`, turn, `custom-model-${turn}`)
      await expect.poll(() => fixture.frames.some((frame) => frame.type === 'run.completed' && frame.runId === turn), { timeout: 30000 }).toBe(true)
      const turnChildren = children.filter((child) => child.turn === turn)
      expect(turnChildren.map((child) => child.agent).sort()).toEqual([...agents].sort())
      for (const child of turnChildren) expect(child.model).toBe(`custom-model-${turn}`)
      const current = (await fixture.terminals.state(fixture.ref))?.instanceId
      expect(current).toBeDefined()
      expect(current).not.toBe(instance)
      instance = current
      expect(JSON.parse(await readFile(join(fixture.configDir, 'settings.json'), 'utf8'))).toMatchObject({
        model: `custom-model-${turn}`, env: { KEEP: 'value',
          ANTHROPIC_DEFAULT_OPUS_MODEL: `custom-model-${turn}`, ANTHROPIC_DEFAULT_SONNET_MODEL: `custom-model-${turn}`,
          ANTHROPIC_DEFAULT_HAIKU_MODEL: `custom-model-${turn}`, ANTHROPIC_DEFAULT_FABLE_MODEL: `custom-model-${turn}` },
      })
    }
    expect(await readFile(join(fixture.root, '.claude', 'settings.json'), 'utf8')).toBe(projectSettings)
    expect(fixture.sdkOpen).not.toHaveBeenCalled()
  } catch (error) {
    console.error(await fixture.terminals.capture(fixture.ref), children,
      fixture.frames.filter((frame) => frame.type === 'error' || frame.type === 'run.failed'))
    throw error
  } finally { await fixture.dispose() }
}, 60000)

it.skipIf(!nativeClaudeAvailable())('saves the composer model immediately and resumes the same conversation with new mappings', async () => {
  let calls = 0
  const fixture = await nativeClaudeFixture((body, reply) => modelMessage(body, reply, [{ type: 'text', text: `model answer ${++calls}` }], `model-${calls}`))
  let viewer: TerminalAttachment | undefined
  try {
    fixture.send('before model switch', 'first')
    await expect.poll(() => fixture.frames.some((frame) => frame.type === 'run.completed' && frame.runId === 'first'), { timeout: 30000 }).toBe(true)
    const before = await fixture.terminals.state(fixture.ref)
    viewer = await fixture.terminals.attach(fixture.ref, 120, 40)
    const exits: string[] = []
    viewer.onExit((reason) => exits.push(reason))
    const session = fixture.ref.id
    const requestsBefore = fixture.requests.length
    fixture.socket.send(JSON.stringify({ type: 'session.configure', harness: 'claude', sessionId: session,
      requestId: 'model-switch', cwd: fixture.root, model: `${fixture.profile.id}:claude-opus-4-6`, contextWindow: 200000 }))
    await expect.poll(() => fixture.frames.find((frame) => frame.type === 'session.config' && frame.requestId === 'model-switch'), { timeout: 20000 })
      .toMatchObject({ config: { model: 'claude-opus-4-6' } })
    expect(fixture.requests).toHaveLength(requestsBefore)
    expect(JSON.parse(await readFile(join(fixture.configDir, 'settings.json'), 'utf8'))).toMatchObject({
      model: 'claude-opus-4-6', env: { ANTHROPIC_DEFAULT_HAIKU_MODEL: 'claude-opus-4-6' },
    })
    fixture.send('after model switch', 'second', 'claude-opus-4-6')
    await expect.poll(() => fixture.frames.some((frame) => frame.type === 'run.completed' && frame.runId === 'second'), { timeout: 20000 }).toBe(true)
    const modelRequest = fixture.requests.find((request) => JSON.stringify(request.messages).includes('after model switch'))
    expect(modelRequest?.model).toBe('claude-opus-4-6')
    expect((await fixture.terminals.state(fixture.ref))?.instanceId).not.toBe(before?.instanceId)
    expect(fixture.ref.id).toBe(session)
    expect(JSON.stringify(modelRequest?.messages)).toContain('before model switch')
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
    fixture.send('Use extended context', 'extended', 'claude-opus-4-6', { profileId: replacement.id, effort: 'high', contextWindow: 1000000 })
    await expect.poll(() => fixture.frames.some((frame) => frame.type === 'run.completed' && frame.runId === 'extended'), { timeout: 20000 }).toBe(true)
    expect((await fixture.terminals.state(fixture.ref))?.instanceId).not.toBe(extendedInstance)
    expect(fixture.frames.filter((frame) => frame.type === 'session.config').at(-1)).toMatchObject({ config: { model: 'claude-opus-4-6[1m]', contextWindow: 1000000, context: { limit: 1000000 } } })
    const beforeConfigure = fixture.frames.filter((frame) => frame.type === 'run.started').length
    fixture.socket.send(JSON.stringify({ type: 'session.configure', harness: 'claude', sessionId: fixture.ref.id,
      requestId: 'shrink', cwd: fixture.root, model: `${replacement.id}:claude-opus-4-6`, effort: 'high', contextWindow: 200000 }))
    await expect.poll(() => fixture.frames.find((frame) => frame.type === 'session.config' && frame.requestId === 'shrink'), { timeout: 20000 })
      .toMatchObject({ config: { model: 'claude-opus-4-6', contextWindow: 200000, context: { limit: 200000 } } })
    expect(fixture.frames.filter((frame) => frame.type === 'run.started')).toHaveLength(beforeConfigure)
    expect(fixture.ref.id).toBe(session)
    expect(exits).toEqual([])
    expect(fixture.sdkOpen).not.toHaveBeenCalled()
  } catch (error) {
    console.error(await fixture.terminals.capture(fixture.ref), fixture.frames.filter((frame) => frame.type === 'error' || frame.type === 'run.failed'))
    throw error
  } finally { await viewer?.detach(); await fixture.dispose() }
}, 60000)

it.skipIf(!nativeClaudeAvailable())('supports native full model IDs and maps the native haiku choice to the composer model', async () => {
  const fixture = await nativeClaudeFixture((body, reply) => modelMessage(body, reply, [{ type: 'text', text: 'Ready to switch' }]))
  try {
    fixture.send('before native switch', 'first')
    await expect.poll(() => fixture.frames.some((frame) => frame.type === 'run.completed' && frame.runId === 'first'), { timeout: 30000 }).toBe(true)
    const runsBeforeSwitch = fixture.frames.filter((frame) => frame.type === 'run.started').length
    const instance = (await fixture.terminals.state(fixture.ref))?.instanceId
    await fixture.terminals.submit(fixture.ref, '/model claude-opus-4-6', new AbortController().signal)
    await expect.poll(() => fixture.terminals.capture(fixture.ref)).toContain('Switch model?')
    await fixture.terminals.sendKeys(fixture.ref, ['Enter'])
    await expect.poll(() => fixture.frames.filter((frame) => frame.type === 'session.config').at(-1)).toMatchObject({
      config: { model: 'claude-opus-4-6', profileId: fixture.profile.id },
    })
    expect(fixture.frames.filter((frame) => frame.type === 'run.started')).toHaveLength(runsBeforeSwitch)
    expect((await fixture.terminals.state(fixture.ref))?.instanceId).toBe(instance)
    await fixture.terminals.submit(fixture.ref, '/model haiku', new AbortController().signal)
    await expect.poll(() => fixture.frames.filter((frame) => frame.type === 'session.config').at(-1)).toMatchObject({
      config: { model: 'claude-sonnet-4-6', profileId: fixture.profile.id },
    })
    await fixture.terminals.submit(fixture.ref, 'native-alias-selection-check', new AbortController().signal)
    await expect.poll(() => fixture.requests.find((request) => JSON.stringify(request.messages).includes('native-alias-selection-check')), { timeout: 10000 })
      .toMatchObject({ model: 'claude-sonnet-4-6' })
    expect(fixture.sdkOpen).not.toHaveBeenCalled()
  } finally { await fixture.dispose() }
}, 40000)
