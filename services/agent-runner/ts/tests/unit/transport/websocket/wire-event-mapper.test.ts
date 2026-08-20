import { describe, expect, it } from 'vitest'

import { parseInitFrame, toServerFrame } from '../../../../src/transport/websocket/schema/run-frames.js'

describe('run frames', () => {
  it('accepts init text, model, and harness', () => {
    expect(parseInitFrame({
      type: 'init',
      text: 'hi',
      model: 'gateway:llama3',
      harness: 'bambuddy',
    })).toEqual({
      ok: true,
      frame: {
        type: 'init',
        text: 'hi',
        model: 'gateway:llama3',
        harness: 'bambuddy',
      },
    })
  })

  it('rejects empty init text, missing model, and unknown harness', () => {
    expect(parseInitFrame({ type: 'init', text: '  ' }).ok).toBe(false)
    expect(parseInitFrame({ type: 'init', text: 'hi', harness: 'claude' }).ok).toBe(false)
    expect(parseInitFrame({
      type: 'init',
      text: 'hi',
      model: 'gateway:llama3',
      harness: 'deepseek',
    }).ok).toBe(false)
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
