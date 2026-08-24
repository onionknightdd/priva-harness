import { describe, expect, it } from 'vitest'

import { parseInitFrame, sessionTargetFromInit, toServerFrame } from '../../../../src/transport/websocket/schema/run-frames.js'

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

  it('accepts queueBehavior and promptSuggestions on init', () => {
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
        queueBehavior: 'steer',
        promptSuggestions: false,
      },
    })
  })

  it('rejects invalid queueBehavior and promptSuggestions', () => {
    expect(parseInitFrame({
      type: 'init',
      text: 'hi',
      model: 'p:m',
      harness: 'pi',
      cwd: '/work',
      queueBehavior: 'later',
    })).toMatchObject({
      ok: false,
      message: 'Init queueBehavior must be follow-up, steer, or interrupt',
    })
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

  it('stamps runId onto an AgentEvent without adding seq', () => {
    expect(toServerFrame({ type: 'run', event: 'started' }, 'run-1')).toEqual({
      type: 'run',
      event: 'started',
      runId: 'run-1',
    })
    expect(toServerFrame({ type: 'run', event: 'started' }, 'run-1')).not.toHaveProperty('seq')
  })
})
