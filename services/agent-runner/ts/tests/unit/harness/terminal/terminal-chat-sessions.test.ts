import { afterEach, describe, expect, it, vi } from 'vitest'

import type { TerminalComposer, TerminalInput, TerminalService, TerminalSessionState } from '../../../../src/core/contract/terminal-service.js'
import type { StreamFrame } from '../../../../src/core/event/agent-event.js'
import { SessionStream } from '../../../../src/harness/session/session-stream.js'
import { AgentHarness } from '../../../../src/harness/agent-harness.js'
import { SessionTerminals } from '../../../../src/harness/terminal/session-terminals.js'
import { TerminalChatSessions } from '../../../../src/harness/terminal/terminal-chat-sessions.js'
import { FakeAgentProvider } from '../../../support/fake-agent-provider.js'
import { testRunSpec } from '../../../support/run-spec.js'

const drivers: TerminalChatSessions[] = []
afterEach(async () => { for (const driver of drivers.splice(0)) await driver.dispose() })

function setup(timeout = 1000) {
  const ref = { provider: 'claude', id: 'terminal-session' } as const
  const spec = testRunSpec()
  let state: TerminalSessionState | undefined = { sessionId: ref.id, instanceId: 'instance', cwd: spec.cwd, event: 'ready', phase: 'idle', updatedAt: 1 }
  const provider = Object.assign(new FakeAgentProvider('claude', []), {
    terminalLaunch: vi.fn(() => Promise.resolve({ command: 'claude', args: [], cwd: spec.cwd, env: {}, cols: 120, rows: 40 })),
    readTerminalSpec: vi.fn(() => Promise.resolve(spec)),
    parseTerminalComposer: vi.fn<(screen: string) => TerminalComposer | undefined>(),
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
  const terminals = new SessionTerminals({ providers: { claude: provider, pi: new FakeAgentProvider('pi', []) }, terminals: service })
  const stream = new SessionStream(ref)
  const frames: StreamFrame[] = []
  stream.subscribe((frame) => frames.push(frame))
  const refresh = vi.fn(() => Promise.resolve())
  const released = vi.fn(() => Promise.resolve())
  const driver = new TerminalChatSessions({ terminals, eventsUrl: () => 'http://localhost/events',
    stream: () => stream, beforeOpen: () => Promise.resolve(), observe: () => Promise.resolve(released), refresh, confirmationTimeoutMs: timeout })
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
      expect(provider.targets).toEqual([{ kind: 'new', provider: 'claude' }])
      expect(service.ensure).not.toHaveBeenCalled()
      expect(events[0]).toMatchObject({ type: 'run.started' })
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
    await expect(submit('hello', 'r')).rejects.toThrow('terminal exited')
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
