import { describe, expect, it } from 'vitest'

import { STREAM_PROTOCOL_VERSION } from '../../../../src/core/event/agent-event.js'
import { encodeEvent } from '../../../../src/core/event/encode-event.js'

describe('encodeEvent', () => {
  it('serializes a stream frame as a single JSON object', () => {
    const json = encodeEvent({
      v: STREAM_PROTOCOL_VERSION,
      type: 'run.started',
      runId: 'run-1',
      seq: 1,
      ts: 10,
      harness: 'claude',
      model: 'm',
    })

    expect(JSON.parse(json)).toEqual({
      v: 1,
      type: 'run.started',
      runId: 'run-1',
      seq: 1,
      ts: 10,
      harness: 'claude',
      model: 'm',
    })
    expect(json.startsWith('data:')).toBe(false)
  })
})
