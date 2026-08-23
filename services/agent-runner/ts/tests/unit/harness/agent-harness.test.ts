import { describe, expect, it } from 'vitest'

import type { AgentEvent } from '../../../src/core/event/agent-event.js'
import { AgentHarness } from '../../../src/harness/agent-harness.js'
import { FakeAgentProvider } from '../../support/fake-agent-provider.js'
import { testRunSpec } from '../../support/run-spec.js'

describe('AgentHarness', () => {
  it('emits run.started, forwards provider events, and releases the runtime', async () => {
    const provider = new FakeAgentProvider('claude', [
      { type: 'assistant', event: 'text_delta', text: 'Hi' },
      {
        type: 'run',
        event: 'completed',
        sessionId: 'sess-1',
        harnessProvider: 'claude',
        model: 'm',
        durationMs: 1,
      },
    ])
    const harness = new AgentHarness({
      providers: {
        claude: provider,
        bambuddy: new FakeAgentProvider('bambuddy', []),
      },
      cwd: '/tmp',
    })
    const events: AgentEvent[] = []
    for await (const event of harness.run(
      { text: 'hi' },
      { signal: new AbortController().signal },
      testRunSpec({ cwd: '/tmp' }),
    )) {
      events.push(event)
    }

    expect(events[0]).toEqual({ type: 'run', event: 'started' })
    expect(events[1]).toEqual({ type: 'assistant', event: 'text_delta', text: 'Hi' })
    expect(events[2]).toMatchObject({ type: 'run', event: 'completed', sessionId: 'sess-1' })
    expect(provider.released).toEqual(['dispose'])
    expect(provider.targets).toEqual([{ kind: 'new', provider: 'claude' }])
  })

  it('opens a resume or fork session target from run options', async () => {
    const provider = new FakeAgentProvider('claude', [
      {
        type: 'run',
        event: 'completed',
        sessionId: 'sess-2',
        harnessProvider: 'claude',
        model: 'm',
        durationMs: 1,
      },
    ])
    const harness = new AgentHarness({
      providers: {
        claude: provider,
        bambuddy: new FakeAgentProvider('bambuddy', []),
      },
      cwd: '/tmp',
    })

    const resumed: AgentEvent[] = []
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
    const forked: AgentEvent[] = []
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
})
