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
        pi: new FakeAgentProvider('pi', []),
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
  })
})
