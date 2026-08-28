import { afterEach, describe, expect, it, vi } from 'vitest'

import type { StreamFrame } from '../../../src/core/event/agent-event.js'
import { AgentHarness } from '../../../src/harness/agent-harness.js'
import { DRAIN_SETTLE_MS } from '../../../src/harness/run/background-drain.js'
import { LiveRunRegistry } from '../../../src/harness/run/live-run-registry.js'
import { FakeAgentProvider } from '../../support/fake-agent-provider.js'
import { testRunSpec } from '../../support/run-spec.js'

describe('AgentHarness', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('emits run.started, forwards provider events, and releases the runtime', async () => {
    const provider = new FakeAgentProvider('claude', [
      {
        type: 'assistant.delta',
        messageId: 'msg_1',
        blockId: 'msg_1:0',
        index: 0,
        text: 'Hi',
      },
      {
        type: 'run.completed',
        sessionId: 'sess-1',
        model: 'm',
        durationMs: 1,
      },
    ])
    const harness = new AgentHarness({
      providers: {
        claude: provider,
        pi: new FakeAgentProvider('pi', []),
      },
      cwd: '/tmp',
    })
    const events: StreamFrame[] = []
    for await (const event of harness.run(
      { text: 'hi' },
      { signal: new AbortController().signal },
      testRunSpec({ cwd: '/tmp' }),
    )) {
      events.push(event)
    }

    expect(events[0]).toMatchObject({
      type: 'run.started',
      v: 1,
      seq: 1,
      harness: 'claude',
      model: 'm',
    })
    expect(events[0]).toHaveProperty('runId')
    expect(events[1]).toMatchObject({ type: 'assistant.delta', text: 'Hi', seq: 2, harness: 'claude' })
    expect(events[2]).toMatchObject({ type: 'run.completed', sessionId: 'session-1', seq: 3 })
    expect(provider.released).toEqual(['dispose'])
    expect(provider.targets).toEqual([{ kind: 'new', provider: 'claude' }])
  })

  it('opens a resume or fork session target from run options', async () => {
    const provider = new FakeAgentProvider('claude', [
      {
        type: 'run.completed',
        sessionId: 'sess-2',
        model: 'm',
        durationMs: 1,
      },
    ])
    const harness = new AgentHarness({
      providers: {
        claude: provider,
        pi: new FakeAgentProvider('pi', []),
      },
      cwd: '/tmp',
    })

    const resumed: StreamFrame[] = []
    for await (const event of harness.run(
      { text: 'again' },
      { signal: new AbortController().signal },
      testRunSpec({ cwd: '/work/repo' }),
      {
        session: {
          kind: 'resume',
          session: { provider: 'claude', id: 'sess-1' },
        },
      },
    )) {
      resumed.push(event)
    }
    expect(resumed.length).toBeGreaterThan(0)
    expect(provider.targets).toEqual([
      { kind: 'resume', session: { provider: 'claude', id: 'sess-1' } },
    ])
    expect(provider.specs[0]?.cwd).toBe('/work/repo')

    provider.targets.length = 0
    const forked: StreamFrame[] = []
    for await (const event of harness.run(
      { text: 'branch' },
      { signal: new AbortController().signal },
      testRunSpec({ cwd: '/work/repo' }),
      {
        session: {
          kind: 'fork',
          source: { provider: 'claude', id: 'sess-1' },
        },
      },
    )) {
      forked.push(event)
    }
    expect(forked.length).toBeGreaterThan(0)
    expect(provider.targets).toEqual([
      { kind: 'fork', source: { provider: 'claude', id: 'sess-1' } },
    ])
  })

  it('launches a live run that survives unsubscribing and rejects a busy init', async () => {
    const provider = new FakeAgentProvider('claude', [
      {
        type: 'run.completed',
        sessionId: 'sess-1',
        model: 'm',
        durationMs: 1,
      },
    ])
    let releaseGate = (): void => undefined
    provider.gate = new Promise((resolve) => {
      releaseGate = resolve
    })
    const liveRuns = new LiveRunRegistry()
    const harness = new AgentHarness({
      providers: {
        claude: provider,
        pi: new FakeAgentProvider('pi', []),
      },
      cwd: '/tmp',
      liveRuns,
    })
    const live = harness.launch(
      { text: 'hi' },
      testRunSpec({ cwd: '/tmp' }),
      { session: { kind: 'resume', session: { provider: 'claude', id: 'sess-1' } } },
    )
    expect(liveRuns.listActive()).toHaveLength(1)
    expect(() => harness.launch(
      { text: 'again' },
      testRunSpec({ cwd: '/tmp' }),
      { session: { kind: 'resume', session: { provider: 'claude', id: 'sess-1' } } },
    )).toThrow('Session has a live run')
    releaseGate()
    await live.waitForComplete()
    expect(liveRuns.listActive()).toEqual([])
    await waitForReleased(provider, ['warm'])
  })

  it('stops listing a session as running after the main turn while drain continues', async () => {
    const provider = new FakeAgentProvider('claude', [
      {
        type: 'tool.completed',
        id: 'call-a',
        name: 'agent',
        ok: true,
        output: 'launched',
        status: 'async_launched',
        agentId: 'agent-1',
      },
      {
        type: 'run.completed',
        sessionId: 'sess-drain',
        model: 'm',
        durationMs: 1,
      },
    ])
    let releaseDrain = (): void => undefined
    provider.afterEventsGate = new Promise((resolve) => {
      releaseDrain = resolve
    })
    const liveRuns = new LiveRunRegistry()
    const harness = new AgentHarness({
      providers: {
        claude: provider,
        pi: new FakeAgentProvider('pi', []),
      },
      cwd: '/tmp',
      liveRuns,
    })
    const live = harness.launch(
      { text: 'hi' },
      testRunSpec({ cwd: '/tmp' }),
      { session: { kind: 'resume', session: { provider: 'claude', id: 'sess-drain' } } },
    )
    await live.waitForComplete()
    expect(live.status).toBe('complete')
    expect(liveRuns.listActive()).toEqual([])
    expect(provider.released).toEqual([])
    releaseDrain()
    await waitForReleased(provider, ['warm'])
  })

  it('ignores leftover idle events that are not an inbound turn', async () => {
    const { provider, liveRuns, harness } = await warmAfterLaunch('sess-idle')
    provider.emitIdle([
      {
        type: 'tool.completed',
        id: 'late',
        name: 'bash',
        ok: true,
        output: 'done',
      },
    ])
    expect(liveRuns.listActive()).toEqual([])
    await harness.disposePool()
  })

  it('reaps a silent inbound promotion so the session does not stay running', async () => {
    const { provider, liveRuns, harness } = await warmAfterLaunch('sess-inbound')
    vi.useFakeTimers()
    provider.emitIdle([
      {
        type: 'assistant.delta',
        messageId: 'm',
        blockId: 'b',
        index: 0,
        text: 'hi',
      },
    ])
    expect(liveRuns.listActive()).toHaveLength(1)
    await vi.advanceTimersByTimeAsync(DRAIN_SETTLE_MS)
    expect(liveRuns.listActive()).toEqual([])
    await harness.disposePool()
  })

  it('clears an inbound live run when it is aborted', async () => {
    const { provider, liveRuns, harness } = await warmAfterLaunch('sess-abort')
    provider.emitIdle([
      {
        type: 'assistant.delta',
        messageId: 'm',
        blockId: 'b',
        index: 0,
        text: 'hi',
      },
    ])
    const inbound = liveRuns.listActive()[0]
    if (inbound === undefined) throw new Error('expected inbound live run')
    harness.abortLive(inbound.runId)
    expect(liveRuns.listActive()).toEqual([])
    await harness.disposePool()
  })

  it('forwards slash command listing to the selected provider', async () => {
    const claude = new FakeAgentProvider('claude', [])
    claude.slashCommands = [
      {
        name: 'compact',
        description: 'Compact context',
        kind: 'command',
        origin: 'builtin',
      },
    ]
    const harness = new AgentHarness({
      providers: {
        claude,
        pi: new FakeAgentProvider('pi', []),
      },
      cwd: '/tmp',
    })
    const spec = testRunSpec({ cwd: '/work/repo' })

    await expect(harness.listSlashCommands({
      provider: 'claude',
      cwd: '/work/repo',
    })).rejects.toThrow('Claude slash command listing requires a model profile')

    const catalog = await harness.listSlashCommands({
      provider: 'claude',
      cwd: '/work/repo',
      spec,
    })
    expect(catalog).toEqual({
      harness: 'claude',
      cwd: '/work/repo',
      commands: claude.slashCommands,
    })
    expect(claude.slashRequests).toEqual([{ cwd: '/work/repo', spec }])
  })
})

async function warmAfterLaunch(sessionId: string) {
  const provider = new FakeAgentProvider('claude', [
    {
      type: 'run.completed',
      sessionId,
      model: 'm',
      durationMs: 1,
    },
  ])
  const liveRuns = new LiveRunRegistry()
  const harness = new AgentHarness({
    providers: {
      claude: provider,
      pi: new FakeAgentProvider('pi', []),
    },
    cwd: '/tmp',
    liveRuns,
  })
  const live = harness.launch(
    { text: 'hi' },
    testRunSpec({ cwd: '/tmp' }),
    { session: { kind: 'resume', session: { provider: 'claude', id: sessionId } } },
  )
  await live.waitForComplete()
  await waitForReleased(provider, ['warm'])
  return { provider, liveRuns, harness }
}

async function waitForReleased(
  provider: FakeAgentProvider,
  expected: readonly string[],
): Promise<void> {
  const started = Date.now()
  while (provider.released.length < expected.length) {
    if (Date.now() - started > 1000) {
      throw new Error(`runtime was not released as ${expected.join(',')}`)
    }
    await new Promise((resolve) => {
      setTimeout(resolve, 10)
    })
  }
  expect(provider.released).toEqual(expected)
}
