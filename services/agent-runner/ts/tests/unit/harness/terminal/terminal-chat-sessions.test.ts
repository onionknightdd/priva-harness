import { afterEach, describe, expect, it, vi } from 'vitest'

import type { TerminalComposer, TerminalInput, TerminalService, TerminalSessionState, TerminalStatus, TerminalTelemetry } from '../../../../src/core/contract/terminal-service.js'
import type { AgentEvent, StreamFrame } from '../../../../src/core/event/agent-event.js'
import { SessionStream } from '../../../../src/harness/session/session-stream.js'
import { AgentHarness } from '../../../../src/harness/agent-harness.js'
import { SessionTerminals } from '../../../../src/harness/terminal/session-terminals.js'
import { TerminalChatSessions, type TerminalChatSessionsOptions } from '../../../../src/harness/terminal/terminal-chat-sessions.js'
import { RunLedger } from '../../../../src/harness/run/run-ledger.js'
import { MemoryDataRecorder } from '../../../support/memory-data-recorder.js'
import { emptyContextUsage } from '../../../../src/core/resource/context-usage.js'
import { FakeAgentProvider } from '../../../support/fake-agent-provider.js'
import { testRunSpec } from '../../../support/run-spec.js'
import { claudePromptText } from '../../../../src/provider/claude/claude-prompt-text.js'
import { withVisualizeInstructions } from '../../../../src/core/tool/visualize-mode.js'
import type { AgentProvider } from '../../../../src/core/contract/agent-provider.js'

const drivers: TerminalChatSessions[] = []
afterEach(async () => { for (const driver of drivers.splice(0)) await driver.dispose() })

function setup(timeout = 1000, options: Partial<TerminalChatSessionsOptions> = {}, providerId: 'claude' | 'pi' = 'claude') {
  const ref = { provider: providerId, id: 'terminal-session' } as const
  const spec = testRunSpec({ provider: providerId })
  let state: TerminalSessionState | undefined = { sessionId: ref.id, instanceId: 'instance', cwd: spec.cwd, event: 'ready', phase: 'idle', updatedAt: 1 }
  const provider = Object.assign(new FakeAgentProvider(providerId, []), {
    terminalLaunch: vi.fn(() => Promise.resolve({ command: 'claude', args: [], cwd: spec.cwd, env: {}, cols: 120, rows: 40 })),
    readTerminalSpec: vi.fn(() => Promise.resolve(spec)),
    parseTerminalComposer: vi.fn<(screen: string) => TerminalComposer | undefined>(),
    terminalPromptText: vi.fn(claudePromptText),
    readTerminalTelemetry: vi.fn<() => Promise<TerminalTelemetry>>().mockResolvedValue({ offset: 0, events: [] }),
    readTerminalState: vi.fn(() => Promise.resolve(state)),
    recordTerminalState: vi.fn((_dir: string, next: TerminalSessionState) => { state = next; return Promise.resolve() }),
    submitTerminalInput: vi.fn(async (input: TerminalInput, text: string) => { await input.paste(text); await input.sendKeys(['Enter']) }),
  })
  const service = {
    rebind: vi.fn<TerminalService['rebind']>(), keyForTerminal: vi.fn<TerminalService['keyForTerminal']>(), restart: vi.fn<TerminalService['restart']>(),
    scratchDir: vi.fn<TerminalService['scratchDir']>().mockResolvedValue('/scratch'),
    ensure: vi.fn<TerminalService['ensure']>(), isAlive: vi.fn<TerminalService['isAlive']>().mockResolvedValue(true),
    attach: vi.fn<TerminalService['attach']>(), paste: vi.fn<TerminalService['paste']>().mockResolvedValue(),
    sendKeys: vi.fn<TerminalService['sendKeys']>().mockResolvedValue(), capture: vi.fn<TerminalService['capture']>(),
    close: vi.fn<TerminalService['close']>(), dispose: vi.fn<TerminalService['dispose']>(),
  } satisfies TerminalService
  const terminals = new SessionTerminals({ providers: { claude: new FakeAgentProvider('claude', []), pi: new FakeAgentProvider('pi', []), [providerId]: provider }, terminals: service })
  const stream = new SessionStream(ref)
  const frames: StreamFrame[] = []
  stream.subscribe((frame) => frames.push(frame))
  const refresh = vi.fn(() => Promise.resolve())
  const released = vi.fn(() => Promise.resolve())
  const driver = new TerminalChatSessions({ terminals, eventsUrl: () => 'http://localhost/events',
    stream: () => stream, beforeOpen: () => Promise.resolve(), observe: () => Promise.resolve(released), refresh, confirmationTimeoutMs: timeout, ...options })
  drivers.push(driver)
  const event = async (event: TerminalSessionState['event'], prompt?: string, source?: string) => {
    state = { sessionId: ref.id, instanceId: 'instance', cwd: spec.cwd, event, updatedAt: (state?.updatedAt ?? 0) + 1,
      phase: event === 'prompt' ? 'running' : event === 'exit' ? 'exited' : 'idle', ...(prompt === undefined ? {} : { prompt }),
      ...(source === undefined ? {} : { source }) }
    await driver.event(ref, state)
  }
  const submit = (text: string, runId: string) => driver.submit(ref, { text }, spec, runId)
  return { driver, ref, spec, provider, service, terminals, stream, frames, refresh, released, event, submit,
    clearState: () => { state = undefined } }
}

describe('TerminalChatSessions', () => {
  it.each((['claude', 'pi'] as const).flatMap((provider) => [false, true].flatMap((visualizeMode) =>
    (['idle', 'running'] as const).map((phase) => ({ provider, visualizeMode, phase })),
  )))('attaches and reconnects viewers using the live configuration ($provider, visualize=$visualizeMode, $phase)', async ({ provider: providerId, visualizeMode, phase }) => {
    const validateMode = vi.fn<NonNullable<TerminalChatSessionsOptions['validateMode']>>().mockResolvedValue()
    const { driver, ref, spec, provider, service, stream, frames, event } = setup(1000, { validateMode }, providerId)
    const liveSpec = { ...spec, visualizeMode, systemInstructions: withVisualizeInstructions(spec.systemInstructions ?? '', visualizeMode) }
    const requested = { ...spec, visualizeMode: !visualizeMode, systemInstructions: withVisualizeInstructions(spec.systemInstructions ?? '', !visualizeMode) }
    provider.readTerminalSpec.mockResolvedValue(liveSpec)
    provider.readTerminalState.mockResolvedValue({ sessionId: ref.id, instanceId: 'instance', cwd: spec.cwd,
      event: 'ready', phase, updatedAt: 1 })
    const configureTerminal = vi.fn<NonNullable<AgentProvider['configureTerminal']>>().mockResolvedValue('restart')
    Object.assign(provider, { configureTerminal, structuredTerminal: providerId === 'pi' })
    stream.publish({ type: 'task.updated', task: { taskId: 'background', kind: 'bash', status: 'running' } })

    for (let viewer = 0; viewer < 2; viewer += 1) {
      await expect(driver.open({ kind: 'resume', session: ref }, requested, { cols: 100, rows: 30 }, 'view')).resolves.toEqual({ session: ref, adopted: true })
    }
    await event('prompt', 'Continue with the live tools')
    expect(validateMode).toHaveBeenLastCalledWith(ref, liveSpec)
    expect(configureTerminal).not.toHaveBeenCalled()
    expect(provider.terminalLaunch).not.toHaveBeenCalled()
    expect(service.restart).not.toHaveBeenCalled()
    expect(service.sendKeys).not.toHaveBeenCalled()
    expect(frames.some((frame) => frame.type === 'run.aborted' || frame.type === 'error')).toBe(false)
  })

  it('keeps run-start prompt checks and immutable mode checks when viewers attach', async () => {
    const { driver, ref, spec, service, event } = setup()
    await event('prompt', 'Keep running')
    await expect(driver.open({ kind: 'resume', session: ref }, { ...spec, visualizeMode: true,
      systemInstructions: withVisualizeInstructions(spec.systemInstructions ?? '', true) }, { cols: 120, rows: 40 })).rejects.toMatchObject({ kind: 'session-busy' })
    await expect(driver.open({ kind: 'resume', session: ref }, { ...spec, runMode: 'agent' },
      { cols: 120, rows: 40 }, 'view')).rejects.toMatchObject({ kind: 'session-busy' })
    expect(service.restart).not.toHaveBeenCalled()
  })

  it('keeps a visualize configuration queued behind the active reply when a viewer reconnects', async () => {
    const { driver, ref, spec, provider, service, event, stream, frames } = setup()
    const nextSpec = { ...spec, visualizeMode: true, systemInstructions: withVisualizeInstructions(spec.systemInstructions ?? '', true) }
    const configureTerminal = vi.fn<NonNullable<AgentProvider['configureTerminal']>>().mockResolvedValue('applied')
    Object.assign(provider, { configureTerminal })
    provider.readTerminalTelemetry.mockResolvedValue({ offset: 0, events: [], status: {
      sessionId: ref.id, instanceId: 'instance', model: spec.model, cwd: spec.cwd, context: { ...emptyContextUsage(), limit: 200000 },
    } })
    await event('prompt', 'An active reply')
    const runId = stream.snapshot().activeRunId
    await driver.configure(ref, nextSpec, 'visualize-change')
    await driver.open({ kind: 'resume', session: ref }, nextSpec, { cols: 120, rows: 40 }, 'view')
    expect(stream.snapshot().activeRunId).toBe(runId)
    expect(configureTerminal).not.toHaveBeenCalled()
    expect(service.sendKeys).not.toHaveBeenCalled()
    await event('stop')
    await expect.poll(() => frames.find((frame) => frame.type === 'session.config' && frame.requestId === 'visualize-change')).toBeDefined()
    expect(configureTerminal.mock.calls.map((call) => call[2])).toEqual([nextSpec])
    expect(frames.some((frame) => frame.type === 'run.aborted' || frame.type === 'error')).toBe(false)
  })

  it('acknowledges a native paste envelope without timing out or replaying the bubble', async () => {
    const { submit, event, service, frames, stream, provider } = setup(100)
    const text = '后台启动一个子agent , 每秒echo 1, 执行30s'
    const wrapped = `\n\n<pasted_content id="6985">\n${text}\n</pasted_content id="6985">\n`
    provider.submitTerminalInput.mockImplementation(async (input, prompt) => {
      await input.paste(prompt)
      await event('prompt', wrapped)
      await input.sendKeys(['Enter'])
    })
    await submit(text, 'pasted')
    await expect.poll(() => service.sendKeys.mock.calls.length).toBe(1)
    const delays = vi.fn()
    const timer = setTimeout(delays, 150)
    try {
      await expect.poll(() => delays.mock.calls.length).toBe(1)
      expect(provider.terminalPromptText).toHaveBeenCalledWith(wrapped)
      expect(stream.snapshot().activeRunId).toBe('pasted')
      expect(frames.some((frame) => frame.type === 'run.failed')).toBe(false)
      expect(service.paste).toHaveBeenCalledTimes(1)
      expect(service.paste).toHaveBeenCalledWith('claude:terminal-session', text)
    } finally { clearTimeout(timer) }
    await event('stop')
    await expect.poll(() => frames.some((frame) => frame.type === 'run.completed' && frame.runId === 'pasted')).toBe(true)
  })

  it('acknowledges an image chip as the submitted text and keeps a single user message', async () => {
    const { submit, event, frames, stream, provider } = setup(100)
    const text = '看这张图'
    provider.submitTerminalInput.mockImplementation(async (input, prompt) => {
      await input.paste(prompt)
      stream.replaceHistory([{ id: 'native-user', role: 'user', content: `[Image #1] ${text}`, createdAt: new Date(0).toISOString(), status: 'complete' }])
      await event('prompt', `[Image #1] ${text}`)
      await input.sendKeys(['Enter'])
    })
    await submit(text, 'image')
    await expect.poll(() => stream.snapshot().messages.some((message) => message.id === 'native-user')).toBe(true)
    const delays = vi.fn()
    const timer = setTimeout(delays, 150)
    try {
      await expect.poll(() => delays.mock.calls.length).toBe(1)
      expect(frames.some((frame) => frame.type === 'run.failed')).toBe(false)
      expect(stream.snapshot().activeRunId).toBe('image')
      expect(stream.snapshot().messages.filter((message) => message.role === 'user')).toMatchObject([
        { id: 'native-user', content: `[Image #1] ${text}` },
      ])
    } finally { clearTimeout(timer) }
  })

  it.each([{ source: 'system', notification: true }, { source: 'user', notification: false },
    { source: undefined, notification: true }, { source: undefined, notification: false }])('uses native input provenance for notifications without hiding pasted XML ($source, notification=$notification)', async ({ source, notification }) => {
    const { event, stream, frames, refresh } = setup()
    const xml = '<task-notification><task-id>worker</task-id><tool-use-id>agent-tool</tool-use-id><status>completed</status><result>Worker output</result></task-notification>'
    const task = { taskId: 'worker', toolUseId: 'agent-tool', kind: 'agent', status: 'completed', result: 'Worker output' } as const
    const history = [{ id: 'launch', role: 'assistant', content: 'Started', createdAt: new Date(0).toISOString(), status: 'complete', blocks: [
      { type: 'tool_use', id: 'agent-tool', name: 'Agent', blockId: 'agent-tool', index: 0 },
      { type: 'text', blockId: 'started', index: 1, text: 'Started' },
      ...(notification ? [{ type: 'task_notification', blockId: 'notice', index: 2,
        notification: { id: 'notice', task, createdAt: new Date(2).toISOString() } } as const] : []),
    ] }] as const
    refresh.mockImplementation(() => { stream.replaceHistory([...history, ...(notification ? [] : [{ id: 'human', role: 'user',
      content: xml, createdAt: new Date(2).toISOString(), status: 'complete' } as const])]); return Promise.resolve() })
    await event('prompt', xml, source)
    const started = frames.find((frame) => frame.type === 'run.started')
    expect(started?.type).toBe('run.started')
    expect(started).not.toHaveProperty('userMessage')
    stream.publishTerminalText({ sessionId: 'terminal-session', turnId: 'turn', messageId: 'display', index: 0, text: 'Worker finished', final: true })
    expect(stream.snapshot().messages.filter((message) => message.role === 'user')).toHaveLength(notification ? 0 : 1)
    if (notification) {
      expect(stream.snapshot().messages).toHaveLength(1)
      expect(stream.snapshot().messages[0]).toMatchObject({ id: 'launch', content: 'Worker finished' })
      expect(frames.filter((frame) => frame.type === 'session.snapshot').flatMap((frame) => frame.messages)
        .some((message) => message.role === 'user' && message.content === xml)).toBe(false)
    } else expect(stream.snapshot().messages.find((message) => message.role === 'user')).toMatchObject({ id: 'human', content: xml })
  })

  it('mirrors late native suggestions, deduplicates polling, and clears hints for drafts, work and exit', async () => {
    const { driver, ref, spec, provider, service, stream, frames, event } = setup()
    provider.parseTerminalComposer.mockReturnValue({ text: '' })
    await driver.open({ kind: 'resume', session: ref }, spec, { cols: 120, rows: 40 })
    provider.parseTerminalComposer.mockReturnValue({ text: '', suggestion: 'native suggestion' })
    await expect.poll(() => stream.snapshot().prompts, { timeout: 2500 }).toEqual(['native suggestion'])
    expect(service.capture).toHaveBeenCalledWith('claude:terminal-session', { styled: true })
    await driver.open({ kind: 'resume', session: ref }, spec, { cols: 120, rows: 40 })
    expect(frames.filter((frame) => frame.type === 'suggestion.prompts')).toHaveLength(1)
    provider.parseTerminalComposer.mockReturnValue({ text: 'native draft' })
    await expect.poll(() => stream.snapshot().prompts, { timeout: 2500 }).toEqual([])
    provider.parseTerminalComposer.mockReturnValue({ text: '', suggestion: 'native suggestion' })
    await driver.open({ kind: 'resume', session: ref }, spec, { cols: 120, rows: 40 })
    expect(stream.snapshot().prompts).toEqual(['native suggestion'])
    await event('prompt', 'next turn')
    expect(stream.snapshot().prompts).toEqual([])
    await event('exit')
    expect(stream.snapshot().prompts).toEqual([])
  }, 7000)

  it('honors the native input-suggestion preference', async () => {
    const { driver, ref, spec, provider, stream } = setup()
    provider.readTerminalSpec.mockResolvedValue({ ...spec, promptSuggestions: false })
    provider.parseTerminalComposer.mockReturnValue({ text: '', suggestion: 'hidden suggestion' })
    await driver.open({ kind: 'resume', session: ref }, spec, { cols: 120, rows: 40 })
    expect(stream.snapshot().prompts).toEqual([])
  })

  it('discards a composer capture that finishes after a native turn starts', async () => {
    const { driver, ref, spec, provider, service, stream, event } = setup()
    let resolveCapture: (screen: string) => void = () => undefined
    service.capture.mockImplementationOnce(() => new Promise<string>((resolve) => { resolveCapture = resolve }))
    provider.parseTerminalComposer.mockReturnValue({ text: '', suggestion: 'stale suggestion' })
    const opened = driver.open({ kind: 'resume', session: ref }, spec, { cols: 120, rows: 40 })
    await expect.poll(() => service.capture.mock.calls.length).toBe(1)
    await event('prompt', 'native input')
    resolveCapture('old screen')
    await opened
    expect(stream.snapshot().prompts).toEqual([])
  })
  it.each(['bubble', 'escape', 'ctrl-c'])('settles interrupted usage once after the final native status (%s)', async (input) => {
    const recorder = new MemoryDataRecorder()
    const accounting = vi.fn().mockResolvedValue({ usage: { input: 10, output: 5 }, byModel: { m: { input: 10, output: 5 } }, numTurns: 1 })
    const { event, provider, driver, ref, frames, refresh } = setup(1000, {
      ledger: (session, runId, turn, spec, sessionTarget) => new RunLedger(recorder, { sessionId: session.id, runId, turn, spec, sessionTarget, source: 'web' }),
      accounting: () => Promise.resolve(accounting),
    })
    const status = { sessionId: ref.id, instanceId: 'instance', model: 'm', cwd: '/workspace', context: emptyContextUsage(),
      updatedAt: 1, costUsd: 0.1, apiDurationMs: 100 }
    provider.readTerminalTelemetry.mockResolvedValue({ offset: 0, events: [], status })
    await event('prompt', 'working')
    refresh.mockImplementation(async () => { expect(provider.readTerminalTelemetry).toHaveBeenCalled(); await Promise.resolve() })
    const timer = setTimeout(() => provider.readTerminalTelemetry.mockResolvedValue({ offset: 0, events: [],
      status: { ...status, updatedAt: Date.now() + 1, costUsd: 0.13, apiDurationMs: 150 } }), 100)
    try {
      if (input === 'bubble') await driver.abort(ref)
      else await driver.input(ref, Buffer.from(input === 'escape' ? '\x1b' : '\x03'))
    } finally { clearTimeout(timer) }
    await event('stop')
    expect(accounting).toHaveBeenCalledTimes(1)
    expect(frames.filter((frame) => frame.type === 'run.aborted')).toHaveLength(1)
    expect(recorder.ofKind('run.finished')).toEqual([expect.objectContaining({ outcome: 'aborted',
      usage: { input: 10, output: 5 }, byModel: { m: { input: 10, output: 5 } }, numTurns: 1,
      costUsd: expect.closeTo(0.03) as number, apiDurationMs: 50 })])
  })

  it('keeps the interrupted outcome and reports accounting failure explicitly', async () => {
    const { driver, ref, event, frames } = setup(1000, { accounting: () => Promise.resolve(() => Promise.reject(new Error('usage unreadable'))) })
    await event('prompt', 'working')
    await driver.abort(ref)
    expect(frames).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'error', code: 'terminal.completion', message: expect.stringContaining('usage unreadable') as string }),
      expect.objectContaining({ type: 'run.aborted' }),
    ]))
    expect(frames.some((frame) => frame.type === 'run.failed')).toBe(false)
  })

  it.each([false, true])('settles only confirmed positive cost when interruption does not refresh status (reported=%s)', async (reported) => {
    const { provider, event, driver, ref, frames } = setup(1000, {
      accounting: () => Promise.resolve(() => Promise.resolve({ usage: { input: 10, output: 5 } })),
    })
    const status = { sessionId: ref.id, instanceId: 'instance', model: 'm', cwd: '/work', context: emptyContextUsage(),
      updatedAt: Date.now() - 1000, costUsd: 0.1, apiDurationMs: 100 }
    provider.readTerminalTelemetry.mockResolvedValue({ offset: 0, events: [], status })
    await event('prompt', 'working')
    if (reported) provider.readTerminalTelemetry.mockResolvedValue({ offset: 0, events: [], status: {
      ...status, updatedAt: Date.now() - 1, costUsd: 0.13, apiDurationMs: 150,
    } })
    await driver.abort(ref)
    const result = frames.find((frame) => frame.type === 'run.aborted')
    expect(result).toMatchObject({ usage: { input: 10, output: 5 } })
    if (reported) expect(result).toMatchObject({ costUsd: expect.closeTo(0.03) as number, apiDurationMs: 50 })
    else {
      expect(result).not.toHaveProperty('costUsd')
      expect(result).not.toHaveProperty('apiDurationMs')
    }
  })

  it('mirrors generic tool approval and leaves URL elicitation in the native UI', async () => {
    const { driver, ref, spec, frames, stream } = setup()
    const pending = driver.question(ref, { sessionId: ref.id, instanceId: 'instance', cwd: spec.cwd, tool: 'Read',
      toolUseId: 'read-file', input: { file_path: '/workspace/file' } }, new AbortController().signal)
    await expect.poll(() => stream.snapshot().interactions?.length).toBe(1)
    const frame = frames.find((item) => item.type === 'permission.requested')
    if (frame?.type !== 'permission.requested') throw new Error('Approval is missing')
    expect(frame.request.kind).toBe('tool')
    driver.respondPermission(ref, { requestId: frame.request.requestId, decision: 'allow' })
    expect(await pending).toEqual({ hookSpecificOutput: { hookEventName: 'PermissionRequest', decision: {
      behavior: 'allow', updatedInput: { file_path: '/workspace/file' },
    } } })
    expect(await driver.elicitation(ref, { sessionId: ref.id, instanceId: 'instance', cwd: spec.cwd,
      serverName: 'login', message: 'Continue authentication', mode: 'url' }, new AbortController().signal)).toEqual({})
    expect(frames.at(-1)).toMatchObject({ type: 'terminal.focus' })
  })

  it('settles the bubble with an error if the final transcript cannot be refreshed', async () => {
    const { event, refresh, frames, stream } = setup()
    await event('prompt', 'native work')
    refresh.mockRejectedValueOnce(new Error('transcript unreadable'))
    await event('stop')
    await expect.poll(() => frames.some((frame) => frame.type === 'run.failed' && frame.message.includes('transcript unreadable'))).toBe(true)
    expect(stream.snapshot().activeRunId).toBeUndefined()
  })

  it('keeps programmatic Claude runs on the SDK even when the UI terminal driver is configured', async () => {
    const { provider, terminals, service, spec } = setup()
    service.isAlive.mockResolvedValue(false)
    const harness = new AgentHarness({ providers: { claude: provider, pi: new FakeAgentProvider('pi', []) }, cwd: spec.cwd })
    harness.configureTerminalChats(terminals, () => 'http://localhost/events')
    try {
      const events: StreamFrame[] = []
      for await (const event of harness.run({ text: 'programmatic' }, { signal: new AbortController().signal }, spec,
        { source: 'subagent-test', keepRuntimeWarm: false })) events.push(event)
      expect(provider.targets).toEqual([{ kind: 'new', provider: 'claude', sessionId: expect.any(String) as string }])
      expect(service.ensure).not.toHaveBeenCalled()
      expect(events[0]).toMatchObject({ type: 'session.config', config: { runMode: 'code' } })
      expect(events[1]).toMatchObject({ type: 'run.started' })
      expect(events[0]).not.toHaveProperty('driver', 'terminal')
    } finally { await harness.disposePool() }
  })

  it('queues bubble messages behind native work and never treats an old idle event as completion', async () => {
    const { event, submit, service, frames, stream } = setup()
    await event('prompt', 'native first')
    await submit('第一条气泡\n第二行', 'bubble-1')
    await submit('second bubble', 'bubble-2')
    expect(service.paste).not.toHaveBeenCalled()
    await event('stop')
    await expect.poll(() => service.paste.mock.calls.length).toBe(1)
    expect(service.paste).toHaveBeenLastCalledWith('claude:terminal-session', '第一条气泡\n第二行')
    await submit('same request replay', 'bubble-1')
    expect(stream.snapshot().activeRunId).toBe('bubble-1')
    await event('prompt', '第一条气泡\n第二行\n')
    await event('stop')
    await expect.poll(() => service.paste.mock.calls.length).toBe(2)
    expect(service.paste).toHaveBeenLastCalledWith('claude:terminal-session', 'second bubble')
    expect(frames.filter((frame) => frame.runId === 'bubble-1' && frame.type === 'run.completed')).toHaveLength(1)
    expect(service.sendKeys).toHaveBeenNthCalledWith(1, 'claude:terminal-session', ['Enter'])
  })

  it('flushes the native transcript before completion, retaining the active run through snapshots', async () => {
    const { submit, event, service, refresh, frames, stream } = setup()
    await submit('hello', 'bubble')
    await expect.poll(() => service.paste.mock.calls.length).toBe(1)
    await event('prompt', 'hello')
    refresh.mockImplementation(() => {
      stream.replaceHistory([
        { id: 'native-user', role: 'user', content: 'hello', status: 'complete', createdAt: new Date().toISOString() },
        { id: 'native-assistant', role: 'assistant', content: 'reply', status: 'complete', createdAt: new Date().toISOString() },
      ])
      return Promise.resolve()
    })
    await event('stop')
    await expect.poll(() => frames.some((frame) => frame.type === 'run.completed')).toBe(true)
    const snapshotIndex = frames.map((frame) => frame.type).lastIndexOf('session.snapshot')
    const completeIndex = frames.findIndex((frame) => frame.type === 'run.completed')
    expect(snapshotIndex).toBeLessThan(completeIndex)
    expect(frames[snapshotIndex]).toMatchObject({ activeRunId: 'bubble' })
    expect(stream.snapshot().messages.map((message) => message.id)).toEqual(['native-user', 'native-assistant'])
    expect(stream.snapshot().activeRunId).toBeUndefined()
  })

  it('aborts the same TUI and persists idle because Claude does not send Stop on interruption', async () => {
    const { submit, event, service, provider, driver, ref, stream, frames } = setup()
    await submit('working', 'bubble')
    await expect.poll(() => service.paste.mock.calls.length).toBe(1)
    await event('prompt', 'working')
    await driver.input(ref, Buffer.from('\x1b[A'))
    expect(stream.snapshot().activeRunId).toBe('bubble')
    expect(await driver.abort(ref, 'wrong-run')).toBe(false)
    expect(await driver.abort(ref, 'bubble')).toBe(true)
    expect(service.sendKeys).toHaveBeenLastCalledWith('claude:terminal-session', ['Escape'])
    expect(provider.recordTerminalState).toHaveBeenCalledWith('/scratch', expect.objectContaining({ phase: 'idle' }))
    expect(frames.filter((frame) => frame.type === 'run.aborted')).toHaveLength(1)
    expect(stream.snapshot().activeRunId).toBeUndefined()
  })

  it('reports injection failure and a missing acknowledgement without replaying the prompt', async () => {
    const { submit, service, frames, event } = setup(20)
    service.paste.mockRejectedValueOnce(new Error('pane disappeared'))
    await submit('fail paste', 'failed')
    await expect.poll(() => frames.some((frame) => frame.type === 'run.failed' && frame.runId === 'failed')).toBe(true)
    await event('ready')
    await submit('unacknowledged', 'timeout')
    await expect.poll(() => frames.some((frame) => frame.type === 'run.failed' && frame.runId === 'timeout')).toBe(true)
    expect(service.paste).toHaveBeenCalledTimes(2)
  })

  it('refuses a terminal without a lifecycle bridge or one that exited instead of falling back to the SDK', async () => {
    const { submit, clearState, service } = setup()
    clearState()
    await expect(submit('hello', 'r')).rejects.toThrow('reopen Terminal once')
    service.isAlive.mockResolvedValue(false)
    await expect(submit('hello', 'r')).rejects.toThrow('Terminal exited')
    expect(service.paste).not.toHaveBeenCalled()
  })

  it('fails active and queued messages when the terminal exits', async () => {
    const { submit, event, frames, service } = setup()
    await submit('active', 'a')
    await expect.poll(() => service.paste.mock.calls.length).toBe(1)
    await event('prompt', 'active')
    await submit('queued', 'b')
    await event('exit')
    expect(frames).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'run.failed', runId: 'a' }),
      expect.objectContaining({ type: 'error', code: 'run.start', runId: 'b' }),
    ]))
    expect(service.paste).toHaveBeenCalledTimes(1)
  })
})

it('keeps the native rebind visible and blocks a mismatched prompt when tasks prevent a mode restart', async () => {
  const streams = new Map<string, SessionStream>()
  const streamFor = (ref: { provider: 'claude' | 'pi'; id: string }) => {
    let stream = streams.get(ref.id)
    if (!stream) { stream = new SessionStream(ref); streams.set(ref.id, stream) }
    return stream
  }
  const { driver, ref, spec, provider, service, event } = setup(1000, {
    stream: streamFor,
    resolveRebound: (_source, _next, _reason, spec) => Promise.resolve({ ...spec, runMode: 'agent' }),
    validateMode: (_ref, spec) => spec.runMode === 'agent' ? Promise.resolve() : Promise.reject(new Error('Session mode mismatch')),
  })
  Object.assign(provider, { configureTerminal: () => Promise.resolve('restart' as const) })
  await event('ready')
  streamFor(ref).publish({ type: 'task.updated', task: { taskId: 'background', kind: 'bash', status: 'running' } })
  await expect(driver.event(ref, { sessionId: 'agent-target', instanceId: 'instance', cwd: spec.cwd,
    event: 'ready', phase: 'idle', source: 'resume', updatedAt: 3 })).rejects.toThrow('background tasks')
  expect(service.restart).not.toHaveBeenCalled()
  const next = { ...ref, id: 'agent-target' }
  expect(streamFor(next).snapshot().config?.runMode).toBe('agent')
  const replay: StreamFrame[] = []
  streamFor(ref).subscribe((frame) => replay.push(frame), { streamId: streamFor(ref).streamId, seq: 0 })
  expect(replay.some((frame) => frame.type === 'session.rebound' && frame.nextSessionId === next.id)).toBe(true)
  await expect(driver.event(next, { sessionId: next.id, instanceId: 'instance', cwd: spec.cwd,
    event: 'prompt', phase: 'running', prompt: 'must not execute', updatedAt: 4 })).rejects.toThrow('Session mode mismatch')
})


describe('structured native terminal turns', () => {
  function structuredSetup(options: Partial<TerminalChatSessionsOptions> = {}, providerId: 'claude' | 'pi' = 'claude') {
    const fixture = setup(1000, options, providerId)
    const native = {
      structuredTerminal: true,
      submitTerminalTurn: vi.fn<NonNullable<AgentProvider['submitTerminalTurn']>>().mockResolvedValue(undefined),
      abortTerminal: vi.fn().mockResolvedValue(undefined),
      respondTerminalInteraction: vi.fn().mockResolvedValue(undefined),
    }
    Object.assign(fixture.provider, native)
    let sequence = 0
    const pending: TerminalTelemetry['events'][number][] = []
    fixture.provider.readTerminalTelemetry.mockImplementation(() => Promise.resolve({ offset: sequence, events: pending.splice(0) }))
    const publish = (runId: string, ...events: AgentEvent[]) => {
      for (const event of events) pending.push({ sessionId: fixture.ref.id, instanceId: 'instance', runId, event })
      sequence += events.length
    }
    const start = (text: string) => ({ type: 'run.started' as const, model: fixture.spec.model, driver: 'terminal' as const,
      userMessage: { id: 'native-user', role: 'user' as const, content: text, createdAt: new Date().toISOString(), status: 'complete' as const } })
    return { ...fixture, native, publish, start }
  }

  it('preserves an active Pi reply and its queued visualize change across viewer reconnects', async () => {
    const { driver, ref, spec, provider, native, publish, start, stream, frames } = structuredSetup({}, 'pi')
    const nextSpec = { ...spec, visualizeMode: true, systemInstructions: withVisualizeInstructions('', true) }
    const configureTerminal = vi.fn<NonNullable<AgentProvider['configureTerminal']>>().mockResolvedValue('applied')
    Object.assign(provider, { configureTerminal })
    const readTelemetry = provider.readTerminalTelemetry.getMockImplementation()
    if (!readTelemetry) throw new Error('Missing native telemetry fixture')
    provider.readTerminalTelemetry.mockImplementation(async () => ({ ...await readTelemetry(), status: {
      sessionId: ref.id, instanceId: 'instance', model: spec.model, cwd: spec.cwd, context: { ...emptyContextUsage(), limit: 200000 },
    } }))
    publish('pi-reply', start('Keep working'))
    await driver.open({ kind: 'resume', session: ref }, spec, { cols: 120, rows: 40 }, 'view')
    await driver.configure(ref, nextSpec, 'pi-visualize-change')
    await driver.open({ kind: 'resume', session: ref }, nextSpec, { cols: 120, rows: 40 }, 'view')
    expect(stream.snapshot().activeRunId).toBe('pi-reply')
    expect(configureTerminal).not.toHaveBeenCalled()
    expect(native.abortTerminal).not.toHaveBeenCalled()
    publish('pi-reply', { type: 'run.completed', model: spec.model, durationMs: 1 })
    await expect.poll(() => frames.find((frame) => frame.type === 'session.config' && frame.requestId === 'pi-visualize-change')).toBeDefined()
    expect(configureTerminal.mock.calls.map((call) => call[2])).toEqual([nextSpec])
    expect(frames.some((frame) => frame.type === 'run.aborted' || frame.type === 'error')).toBe(false)
  })

  it.each([false, true])('acknowledges Pi native effort and preserves a later TUI selection when Chat sends stale effort (restart=%s)', async (restart) => {
    const { driver, ref, spec, provider, event, frames, native } = structuredSetup({}, 'pi')
    let status: TerminalStatus = { sessionId: ref.id, instanceId: 'instance', model: spec.model, cwd: spec.cwd,
      effort: 'max', effortLevels: ['off', 'low', 'high', 'max'], context: { ...emptyContextUsage(), limit: 200000 } }
    provider.readTerminalTelemetry.mockImplementation(() => Promise.resolve({ offset: 0, events: [], status }))
    const configureTerminal = vi.fn<NonNullable<AgentProvider['configureTerminal']>>((_input, _scratch, next) => {
      status = { ...status, effort: next.effort === 'medium' ? 'high' : next.effort ?? 'off' }
      return Promise.resolve('applied')
    })
    if (restart) configureTerminal.mockResolvedValueOnce('restart')
    Object.assign(provider, { configureTerminal })
    await event('ready')
    await expect.poll(() => frames.some((frame) => frame.type === 'session.config' && frame.config.effort === 'max')).toBe(true)
    await driver.configure(ref, { ...spec, effort: 'medium' }, 'effort-change')
    await expect.poll(() => frames.find((frame) => frame.type === 'session.config' && frame.requestId === 'effort-change')).toMatchObject({
      config: { effort: 'high', effortLevels: ['off', 'low', 'high', 'max'] },
    })
    status = { ...status, effort: 'off' }
    await expect.poll(() => frames.some((frame) => frame.type === 'session.config' && frame.config.effort === 'off')).toBe(true)
    await driver.submit(ref, { text: 'Keep the TUI choice' }, { ...spec, effort: 'high' }, 'stale-chat')
    await expect.poll(() => native.submitTerminalTurn.mock.calls.length).toBe(1)
    expect(configureTerminal.mock.calls.at(-1)?.[2].effort).toBe('off')
  })

  it('waits for an in-flight telemetry read before rebinding and records final usage once', async () => {
    const recorder = new MemoryDataRecorder()
    const { driver, ref, spec, provider, event, publish, start, frames } = structuredSetup({
      ledger: (session, runId, turn, spec, sessionTarget) => new RunLedger(recorder, { sessionId: session.id, runId, turn, spec, sessionTarget, source: 'web' }),
    })
    await event('ready')
    publish('native-old', start('old reply'))
    await expect.poll(() => frames.some((frame) => frame.type === 'run.started')).toBe(true)
    let release!: (batch: TerminalTelemetry) => void
    const gate = new Promise<TerminalTelemetry>((resolve) => { release = resolve })
    provider.readTerminalTelemetry.mockImplementationOnce(() => gate)
    const reads = provider.readTerminalTelemetry.mock.calls.length
    await expect.poll(() => provider.readTerminalTelemetry.mock.calls.length).toBeGreaterThan(reads)
    const state: TerminalSessionState = { sessionId: 'native-next', instanceId: 'instance', cwd: spec.cwd,
      event: 'ready', phase: 'idle', source: 'clear', updatedAt: 5 }
    provider.readTerminalState.mockResolvedValue(state)
    const rebound = driver.event(ref, state)
    await new Promise<void>((resolve) => setImmediate(resolve))
    try {
      expect(frames.filter((frame) => frame.type === 'run.completed' || frame.type === 'run.aborted')).toHaveLength(0)
    } finally {
      release({ offset: 3, events: [
        { sessionId: ref.id, instanceId: 'instance', runId: 'native-old', event: { type: 'run.completed', model: spec.model, durationMs: 4, usage: { input: 17, output: 3 }, costUsd: 0.04 } },
        { sessionId: ref.id, instanceId: 'instance', event: { type: 'session.rebound', nextSessionId: state.sessionId } },
      ] })
      await rebound
    }
    expect(recorder.ofKind('run.finished')).toEqual([expect.objectContaining({ outcome: 'completed', usage: { input: 17, output: 3 }, costUsd: 0.04 })])
    expect(frames.filter((frame) => frame.type === 'session.rebound')).toHaveLength(1)
  })

  it('cancels a Chat submission waiting for native startup without sending a ghost prompt', async () => {
    const { driver, ref, submit, event, native, frames, stream } = structuredSetup()
    let startupReady!: () => void
    const startup = new Promise<void>((resolve) => { startupReady = resolve })
    const sent = vi.fn()
    native.submitTerminalTurn.mockImplementation(async (_directory, text, signal) => {
      await Promise.race([startup, new Promise<void>((_resolve, reject) => {
        signal.addEventListener('abort', () => reject(new Error('Startup cancelled')), { once: true })
      })])
      signal.throwIfAborted()
      sent(text)
    })
    await event('ready')
    await submit('must not be sent', 'waiting-startup')
    await expect.poll(() => native.submitTerminalTurn.mock.calls.length).toBe(1)
    await driver.abort(ref, 'waiting-startup')
    startupReady()
    await new Promise<void>((resolve) => setImmediate(resolve))
    expect(sent).not.toHaveBeenCalled()
    expect(frames.filter((frame) => frame.type === 'run.aborted')).toHaveLength(1)
    expect(stream.snapshot().activeRunId).toBeUndefined()
    expect(frames.filter((frame) => frame.type === 'run.failed')).toHaveLength(0)
  })

  it('drains an accepted native start before deciding how cancellation is settled', async () => {
    const { driver, ref, submit, event, native, publish, start, frames } = structuredSetup()
    await event('ready')
    native.submitTerminalTurn.mockImplementation(() => { publish('accepted', start('accepted input')); return Promise.resolve() })
    await submit('accepted input', 'accepted')
    await expect.poll(() => native.submitTerminalTurn.mock.calls.length).toBe(1)
    await driver.abort(ref, 'accepted')
    expect(frames.filter((frame) => frame.type === 'run.aborted')).toHaveLength(0)
    publish('accepted', { type: 'run.aborted', usage: { input: 3, output: 2 }, costUsd: 0.01 })
    await expect.poll(() => frames.filter((frame) => frame.type === 'run.aborted').length).toBe(1)
    expect(frames.find((frame) => frame.type === 'run.aborted')).toMatchObject({ usage: { input: 3, output: 2 }, costUsd: 0.01 })
  })

  it('submits to the new native owner when state changes while Chat is sending', async () => {
    const { driver, ref, spec, provider, event, submit, native } = structuredSetup()
    await event('ready')
    const state: TerminalSessionState = { sessionId: 'next-session', instanceId: 'instance', cwd: spec.cwd,
      event: 'ready', phase: 'idle', source: 'clear', updatedAt: 5 }
    provider.readTerminalState.mockResolvedValue(state)
    await submit('after new', 'new-message')
    await expect.poll(() => native.submitTerminalTurn.mock.calls.length).toBe(1)
    expect(driver.list(ref.provider)).toEqual([expect.objectContaining({ ref: { ...ref, id: state.sessionId }, runId: 'new-message' })])
  })

  it('drains a native outcome on process exit before synthesizing a failure', async () => {
    const { driver, ref, spec, event, publish, start, frames } = structuredSetup()
    await event('ready')
    publish('last-reply', start('last reply'))
    await expect.poll(() => frames.some((frame) => frame.type === 'run.started')).toBe(true)
    publish('last-reply', { type: 'run.completed', model: spec.model, durationMs: 1, usage: { input: 11, output: 4 } })
    await driver.exited(ref, 'Terminal exited')
    expect(frames.filter((frame) => frame.type === 'run.failed')).toHaveLength(0)
    expect(frames.filter((frame) => frame.type === 'run.completed')).toEqual([expect.objectContaining({ runId: 'last-reply', usage: { input: 11, output: 4 } })])
  })

  it('acknowledges Chat by run ID and settles native usage exactly once', async () => {
    const { submit, event, publish, start, native, frames, stream, spec, service } = structuredSetup()
    await event('ready')
    await submit('from Chat', 'chat-run')
    await expect.poll(() => native.submitTerminalTurn.mock.calls.length).toBe(1)
    expect(native.submitTerminalTurn.mock.calls[0]?.slice(-1)).toEqual(['chat-run'])
    await event('prompt', 'from Chat')
    publish('chat-run', start('from Chat'), { type: 'assistant.delta', messageId: 'answer', blockId: 'text', index: 0, text: 'shared answer' },
      { type: 'run.completed', model: spec.model, durationMs: 25, costUsd: 0.02, usage: { input: 20, output: 10 } })
    await expect.poll(() => frames.filter((frame) => frame.type === 'run.completed').length).toBe(1)
    expect(frames.filter((frame) => frame.type === 'run.started')).toHaveLength(1)
    expect(frames.find((frame) => frame.type === 'run.completed')).toMatchObject({ runId: 'chat-run', costUsd: 0.02, usage: { input: 20, output: 10 } })
    expect(stream.snapshot().messages.filter((message) => message.role === 'user')).toHaveLength(1)
    expect(stream.snapshot().messages.find((message) => message.role === 'assistant')?.content).toBe('shared answer')
    expect(service.paste).not.toHaveBeenCalled()
  })

  it('projects consecutive TUI turns from durable events even after the state is already idle', async () => {
    const { event, publish, start, frames, stream, spec, native } = structuredSetup()
    await event('ready')
    publish('native-1', start('first'), { type: 'run.completed', model: spec.model, durationMs: 1 })
    await expect.poll(() => frames.filter((frame) => frame.type === 'run.completed').length).toBe(1)
    publish('native-2', start('second'), { type: 'run.completed', model: spec.model, durationMs: 1 })
    await expect.poll(() => frames.filter((frame) => frame.type === 'run.completed').length).toBe(2)
    expect(stream.snapshot().messages.filter((message) => message.role === 'user').map((message) => message.content)).toEqual(['first', 'second'])
    expect(native.submitTerminalTurn).not.toHaveBeenCalled()
  })

  it('routes answers and cancellation to the native owner and waits for its outcome', async () => {
    const { event, publish, start, frames, driver, ref, stream, native, service } = structuredSetup()
    await event('ready')
    const request = { kind: 'tool' as const, requestId: 'permission-1', tool: 'mcp__test__write', expiresAt: Date.now() + 30000 }
    publish('native-run', start('native question'), { type: 'permission.requested', request })
    await expect.poll(() => stream.snapshot().interactions?.length).toBe(1)
    expect(driver.respondPermission(ref, { requestId: request.requestId, decision: 'allow' })).toBe(true)
    await expect.poll(() => native.respondTerminalInteraction.mock.calls.length).toBe(1)
    publish('native-run', { type: 'permission.resolved', resolution: { request, decision: 'allow', reason: 'answered' } })
    await expect.poll(() => stream.snapshot().interactions?.length).toBe(0)
    await driver.abort(ref, 'native-run')
    expect(native.abortTerminal).toHaveBeenCalledTimes(1)
    expect(frames.filter((frame) => frame.type === 'run.aborted')).toHaveLength(0)
    publish('native-run', { type: 'run.aborted', message: 'Interrupted', costUsd: 0.01 })
    await expect.poll(() => frames.filter((frame) => frame.type === 'run.aborted').length).toBe(1)
    expect(service.sendKeys).not.toHaveBeenCalled()
  })
})
