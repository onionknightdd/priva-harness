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

  it('holds run.completed until the one-shot image tool returns', async () => {
    const drain = new BackgroundDrainTracker({ imageFollowUpSettleMs: 20 })
    const events = await collect(
      consumeRunEvents(
        fromEvents(
          [
            {
              type: 'tool.started',
              id: 'img-1',
              name: 'mcp__agentWorkshop__image_gen',
              messageId: 'm',
              blockId: 'img-1',
              index: 0,
            },
            { type: 'run.completed', model: 'm', durationMs: 1 },
            {
              type: 'tool.completed',
              id: 'img-1',
              name: 'mcp__agentWorkshop__image_gen',
              ok: true,
              output: '/work/.images/a.png',
            },
          ],
          2,
        ),
        { drain },
      ),
    )
    expect(events.map((event) => event.type)).toEqual([
      'tool.started',
      'tool.completed',
      'run.completed',
    ])
  })

  it('holds run.completed for same-turn text after the image tool returns', async () => {
    const drain = new BackgroundDrainTracker({ imageFollowUpSettleMs: 80 })
    const events = await collect(
      consumeRunEvents(
        fromEvents(
          [
            {
              type: 'tool.started',
              id: 'img-1',
              name: 'image_edit',
              messageId: 'm',
              blockId: 'img-1',
              index: 0,
            },
            {
              type: 'tool.completed',
              id: 'img-1',
              name: 'image_edit',
              ok: true,
              output: '/work/.images/b.png',
            },
            { type: 'run.completed', model: 'm', durationMs: 1 },
            { type: 'assistant.delta', messageId: 'm', blockId: 'b', index: 0, text: 'done' },
          ],
          3,
        ),
        { drain },
      ),
    )
    expect(events.map((event) => event.type)).toEqual([
      'tool.started',
      'tool.completed',
      'assistant.delta',
      'run.completed',
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
