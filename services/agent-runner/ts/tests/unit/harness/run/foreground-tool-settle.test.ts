import { describe, expect, it } from 'vitest'
import { ForegroundToolSettle } from '../../../../src/harness/run/foreground-tool-settle.js'
describe('ForegroundToolSettle', () => {
  it('does not close while an image_gen or image_edit call is still running', () => {
    let now = 0
    const drain = new ForegroundToolSettle({
      imageFollowUpSettleMs: 10,
      now: () => now,
    })
    drain.observe({
      type: 'tool.started',
      id: 'img-1',
      name: 'image_gen',
      messageId: 'm',
      blockId: 'img-1',
      index: 0,
    })
    expect(drain.hasOutstanding()).toBe(true)
    expect(drain.shouldClose(true)).toBe(false)
    expect(drain.remainingWaitMs(true)).toBeUndefined()
    drain.observe({
      type: 'tool.completed',
      id: 'img-1',
      name: 'image_gen',
      ok: true,
      output: '/work/.images/a.png',
    })
    expect(drain.hasOutstanding()).toBe(false)
    expect(drain.shouldClose(true)).toBe(false)
    now = 10
    expect(drain.shouldClose(true)).toBe(true)
  })

})
