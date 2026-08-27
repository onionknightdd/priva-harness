import { describe, expect, it } from 'vitest'

import { STREAM_PROTOCOL_VERSION } from '../../../../src/core/event/agent-event.js'
import { LiveRun } from '../../../../src/harness/run/live-run.js'

describe('LiveRun', () => {
  it('replays buffered frames to a late subscriber', () => {
    const live = new LiveRun({
      runId: 'run-1',
      provider: 'claude',
      cwd: '/work',
      abort: new AbortController(),
    })
    live.publish(live.stamp({ type: 'run.started', model: 'm' }))
    live.publish(live.stamp({ type: 'assistant.delta', messageId: 'm', blockId: 'b', index: 0, text: 'Hi' }))

    const received: string[] = []
    const { gap, replay } = live.subscribe((frame) => {
      received.push(frame.type)
    }, 0)
    expect(gap).toBe(false)
    expect(replay.map((frame) => frame.type)).toEqual(['run.started', 'assistant.delta'])
    expect(replay[0]).toMatchObject({
      v: STREAM_PROTOCOL_VERSION,
      runId: 'run-1',
      seq: 1,
    })

    live.publish(live.stamp({ type: 'run.completed', model: 'm', durationMs: 1 }))
    expect(received).toEqual(['run.completed'])
  })

  it('reports a replay gap when sinceSeq is behind the retained buffer', () => {
    const live = new LiveRun({
      runId: 'run-1',
      provider: 'claude',
      cwd: '/work',
      abort: new AbortController(),
    })
    live.firstSeq = 80
    live.lastSeq = 90
    for (let seq = 80; seq <= 90; seq += 1) {
      live.publish({
        type: 'assistant.delta',
        messageId: 'm',
        blockId: 'b',
        index: 0,
        text: String(seq),
        v: 1,
        runId: 'run-1',
        seq,
        ts: seq,
        harness: 'claude',
      })
    }
    const { gap, replay } = live.subscribe(() => undefined, 10)
    expect(gap).toBe(true)
    expect(replay).toEqual([])
    expect(live.gapFrame()).toMatchObject({
      type: 'replay.gap',
      firstSeq: live.firstSeq,
      lastSeq: live.lastSeq,
      runId: 'run-1',
    })
  })

  it('resolves waitForComplete after complete', async () => {
    const live = new LiveRun({
      runId: 'run-1',
      provider: 'claude',
      cwd: '/work',
      abort: new AbortController(),
    })
    const pending = live.waitForComplete()
    live.complete()
    await pending
    expect(live.status).toBe('complete')
  })
})
