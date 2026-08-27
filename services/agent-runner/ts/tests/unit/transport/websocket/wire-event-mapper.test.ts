import { describe, expect, it } from 'vitest'

import { STREAM_PROTOCOL_VERSION } from '../../../../src/core/event/agent-event.js'
import { encodeEvent } from '../../../../src/core/event/encode-event.js'
import { EnvelopeStamper } from '../../../../src/harness/run/envelope-stamper.js'
import { parseClientFrame, parseInitFrame, sessionTargetFromInit } from '../../../../src/transport/websocket/schema/run-frames.js'

describe('run frames', () => {
  it('accepts init text, model, harness, and cwd', () => {
    expect(parseInitFrame({
      type: 'init',
      text: 'hi',
      model: 'gateway:llama3',
      harness: 'pi',
      cwd: '/work/repo',
    })).toEqual({
      ok: true,
      frame: {
        type: 'init',
        text: 'hi',
        model: 'gateway:llama3',
        harness: 'pi',
        cwd: '/work/repo',
      },
    })
  })

  it('maps resume and fork session targets', () => {
    const resumed = parseInitFrame({
      type: 'init',
      text: 'hi',
      model: 'p:m',
      harness: 'claude',
      cwd: '/work/repo',
      sessionId: 'sess-1',
      effort: 'high',
    })
    expect(resumed.ok).toBe(true)
    if (resumed.ok) {
      expect(sessionTargetFromInit(resumed.frame)).toEqual({
        kind: 'resume',
        session: { provider: 'claude', id: 'sess-1' },
      })
    }

    const forked = parseInitFrame({
      type: 'init',
      text: 'hi',
      model: 'p:m',
      harness: 'claude',
      cwd: '/work/repo',
      sessionId: 'sess-1',
      fork: true,
    })
    expect(forked.ok).toBe(true)
    if (forked.ok) {
      expect(sessionTargetFromInit(forked.frame)).toEqual({
        kind: 'fork',
        source: { provider: 'claude', id: 'sess-1' },
      })
    }

    const resumedPi = parseInitFrame({
      type: 'init',
      text: 'hi',
      model: 'p:m',
      harness: 'pi',
      cwd: '/work/repo',
      sessionId: 'pi-1',
    })
    expect(resumedPi.ok).toBe(true)
    if (resumedPi.ok) {
      expect(sessionTargetFromInit(resumedPi.frame)).toEqual({
        kind: 'resume',
        session: { provider: 'pi', id: 'pi-1' },
      })
    }
  })

  it('rejects empty init text, missing model, unknown harness, and invalid resume', () => {
    expect(parseInitFrame({ type: 'init', text: '  ' }).ok).toBe(false)
    expect(parseInitFrame({ type: 'init', text: 'hi', harness: 'claude' }).ok).toBe(false)
    expect(parseInitFrame({
      type: 'init',
      text: 'hi',
      model: 'gateway:llama3',
      harness: 'deepseek',
    }).ok).toBe(false)
    expect(parseInitFrame({
      type: 'init',
      text: 'hi',
      model: 'p:m',
      harness: 'claude',
    }).ok).toBe(false)
    expect(parseInitFrame({
      type: 'init',
      text: 'hi',
      model: 'p:m',
      harness: 'claude',
      cwd: '/work',
      fork: true,
    }).ok).toBe(false)
    expect(parseInitFrame({
      type: 'init',
      text: 'hi',
      model: 'p:m',
      harness: 'pi',
      cwd: '/work',
      sessionId: 'sess-1',
      fork: true,
    })).toMatchObject({
      ok: false,
      message: 'Pi does not support fork',
    })
    expect(parseInitFrame({ type: 'abort' }).ok).toBe(false)
  })

  it('parses attach and abort client frames', () => {
    expect(parseClientFrame({
      type: 'attach',
      harness: 'claude',
      sessionId: 'sess-1',
      sinceSeq: 4,
    })).toEqual({
      ok: true,
      frame: {
        type: 'attach',
        harness: 'claude',
        sessionId: 'sess-1',
        sinceSeq: 4,
      },
    })
    expect(parseClientFrame({
      type: 'abort',
      harness: 'pi',
      runId: 'run-1',
    })).toEqual({
      ok: true,
      frame: {
        type: 'abort',
        harness: 'pi',
        runId: 'run-1',
      },
    })
    expect(parseClientFrame({ type: 'attach', harness: 'claude' }).ok).toBe(false)
  })

  it('accepts promptSuggestions on init and ignores queueBehavior', () => {
    expect(parseInitFrame({
      type: 'init',
      text: 'hi',
      model: 'p:m',
      harness: 'pi',
      cwd: '/work',
      queueBehavior: 'steer',
      promptSuggestions: false,
    })).toEqual({
      ok: true,
      frame: {
        type: 'init',
        text: 'hi',
        model: 'p:m',
        harness: 'pi',
        cwd: '/work',
        promptSuggestions: false,
      },
    })
  })

  it('rejects invalid promptSuggestions', () => {
    expect(parseInitFrame({
      type: 'init',
      text: 'hi',
      model: 'p:m',
      harness: 'claude',
      cwd: '/work',
      promptSuggestions: 'yes',
    })).toMatchObject({
      ok: false,
      message: 'Init promptSuggestions must be a boolean',
    })
  })

  it('encodes the same JSON payload the websocket sends', () => {
    const stamper = new EnvelopeStamper('run-1', 'claude', () => 1)
    const frame = stamper.stamp({ type: 'run.started', model: 'm' })
    expect(JSON.parse(encodeEvent(frame))).toEqual({
      type: 'run.started',
      model: 'm',
      v: STREAM_PROTOCOL_VERSION,
      runId: 'run-1',
      seq: 1,
      ts: 1,
      harness: 'claude',
    })
  })
})
