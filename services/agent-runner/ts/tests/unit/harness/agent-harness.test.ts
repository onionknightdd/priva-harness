import { describe, expect, it } from 'vitest'

import type { StreamFrame } from '../../../src/core/event/agent-event.js'
import { AgentHarness } from '../../../src/harness/agent-harness.js'
import { FakeAgentProvider } from '../../support/fake-agent-provider.js'
import { testRunSpec } from '../../support/run-spec.js'

describe('AgentHarness', () => {
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
    expect(events[2]).toMatchObject({ type: 'run.completed', sessionId: 'sess-1', seq: 3 })
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
})
