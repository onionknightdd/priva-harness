import { describe, expect, it } from 'vitest'

import { STREAM_PROTOCOL_VERSION } from '../../../../src/core/event/agent-event.js'
import { EnvelopeStamper } from '../../../../src/harness/run/envelope-stamper.js'

describe('EnvelopeStamper', () => {
  it('stamps v, runId, seq from 1, ts, and harness, and remembers sessionId', () => {
    const stamper = new EnvelopeStamper('run-1', 'claude', () => 1000)

    const first = stamper.stamp({ type: 'run.started', model: 'm' })
    expect(first).toEqual({
      type: 'run.started',
      model: 'm',
      v: STREAM_PROTOCOL_VERSION,
      runId: 'run-1',
      seq: 1,
      ts: 1000,
      harness: 'claude',
    })
    expect(first).not.toHaveProperty('sessionId')

    const second = stamper.stamp({
      type: 'run.completed',
      sessionId: 'sess-1',
      model: 'm',
      durationMs: 3,
    })
    expect(second.seq).toBe(2)
    expect(second.sessionId).toBe('sess-1')

    const third = stamper.stamp({
      type: 'assistant.delta',
      messageId: 'msg_1',
      blockId: 'msg_1:0',
      index: 0,
      text: 'x',
    })
    expect(third.seq).toBe(3)
    expect(third.sessionId).toBe('sess-1')
  })

  it('omits empty sessionId', () => {
    const stamper = new EnvelopeStamper('run-1', 'pi', () => 1)
    const frame = stamper.stamp({
      type: 'run.completed',
      sessionId: '',
      model: 'm',
      durationMs: 1,
    })
    expect(frame).not.toHaveProperty('sessionId')
  })
})
