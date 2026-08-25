import { describe, expect, it } from 'vitest'

import { STREAM_PROTOCOL_VERSION } from '../../../../src/core/event/agent-event.js'
import { encodeSse, encodeSsePing } from '../../../../src/transport/http/encode-sse.js'

describe('encodeSse', () => {
  it('frames JSON as id plus data without an event field', () => {
    const frame = {
      v: STREAM_PROTOCOL_VERSION,
      type: 'assistant.delta' as const,
      runId: 'run-1',
      seq: 4,
      ts: 20,
      harness: 'claude',
      messageId: 'msg_1',
      blockId: 'msg_1:0',
      index: 0,
      text: 'Hi',
    }

    expect(encodeSse(frame)).toBe(
      `id: 4\ndata: ${JSON.stringify(frame)}\n\n`,
    )
    expect(encodeSse(frame).includes('event:')).toBe(false)
  })

  it('encodes keepalive as a comment ping', () => {
    expect(encodeSsePing()).toBe(':ping\n\n')
  })
})
