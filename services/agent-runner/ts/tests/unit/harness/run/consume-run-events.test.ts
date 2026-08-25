import { describe, expect, it } from 'vitest'

import type { AgentEvent } from '../../../../src/core/event/agent-event.js'
import { consumeRunEvents } from '../../../../src/harness/run/consume-run-events.js'
import { BackgroundDrainTracker } from '../../../../src/harness/run/background-drain.js'

async function* fromEvents(events: AgentEvent[], pauseAfter?: number): AsyncGenerator<AgentEvent> {
  for (const [index, event] of events.entries()) {
    if (pauseAfter !== undefined && index === pauseAfter) {
      await new Promise((resolve) => setTimeout(resolve, 30))
    }
    yield event
  }
}

async function collect(source: AsyncIterable<AgentEvent>): Promise<AgentEvent[]> {
  const events: AgentEvent[] = []
  for await (const event of source) events.push(event)
  return events
}

describe('consumeRunEvents', () => {
  it('closes on the first run.completed when there is no background work', async () => {
    const events = await collect(
      consumeRunEvents(
        fromEvents([
          { type: 'assistant.delta', messageId: 'm', blockId: 'b', index: 0, text: 'Hi' },
          { type: 'run.completed', model: 'm', durationMs: 1 },
          { type: 'assistant.delta', messageId: 'm', blockId: 'b', index: 0, text: 'late' },
        ]),
      ),
    )
    expect(events.map((event) => event.type)).toEqual(['assistant.delta', 'run.completed'])
  })

  it('keeps reading after the first run.completed while a workflow is outstanding', async () => {
    const drain = new BackgroundDrainTracker({ idleMs: 200, settleMs: 20 })
    const events = await collect(
      consumeRunEvents(
        fromEvents(
          [
            { type: 'tool.started', id: 'wf-1', name: 'workflow', messageId: 'm', blockId: 'wf-1', index: 0 },
            { type: 'run.completed', model: 'm', durationMs: 1 },
            { type: 'workflow.progress', workflowToolUseId: 'wf-1', taskId: 't1' },
            { type: 'workflow.completed', workflowToolUseId: 'wf-1', status: 'completed' },
          ],
          2,
        ),
        { drain },
      ),
    )
    expect(events.map((event) => event.type)).toEqual([
      'tool.started',
      'run.completed',
      'workflow.progress',
      'workflow.completed',
    ])
  })

  it('closes immediately on run.failed', async () => {
    const events = await collect(
      consumeRunEvents(
        fromEvents([
          { type: 'run.failed', message: 'boom', model: 'm' },
          { type: 'assistant.delta', messageId: 'm', blockId: 'b', index: 0, text: 'late' },
        ]),
      ),
    )
    expect(events.map((event) => event.type)).toEqual(['run.failed'])
  })
})
