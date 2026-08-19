import { describe, expect, it } from 'vitest'

import { parseInitFrame, toServerFrame } from '../../../../src/transport/websocket/schema/run-frames.js'

describe('run frames', () => {
  it('accepts a non-empty init text frame', () => {
    expect(parseInitFrame({ type: 'init', text: 'hi' })).toEqual({
      ok: true,
      frame: { type: 'init', text: 'hi' },
    })
  })

  it('rejects empty init text and non-init types', () => {
    expect(parseInitFrame({ type: 'init', text: '  ' }).ok).toBe(false)
    expect(parseInitFrame({ type: 'abort' }).ok).toBe(false)
  })

  it('stamps runId onto an AgentEvent without adding seq', () => {
    expect(toServerFrame({ type: 'run', event: 'started' }, 'run-1')).toEqual({
      type: 'run',
      event: 'started',
      runId: 'run-1',
    })
    expect(toServerFrame({ type: 'run', event: 'started' }, 'run-1')).not.toHaveProperty('seq')
  })
})
