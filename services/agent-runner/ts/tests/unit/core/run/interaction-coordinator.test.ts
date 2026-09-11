import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AgentEvent } from '../../../../src/core/event/agent-event.js'
import { InteractionCoordinator } from '../../../../src/core/run/interaction-coordinator.js'
import { answersByQuestion, normalizeQuestions } from '../../../../src/core/resource/interaction.js'
import { SessionStream } from '../../../../src/harness/session/session-stream.js'

function fixture(timeout = 600_000) {
  const events: AgentEvent[] = []
  const coordinator = new InteractionCoordinator((event) => events.push(event), timeout)
  const request = () => {
    const event = [...events].reverse().find((event) => event.type === 'permission.requested')
    if (event?.type !== 'permission.requested') throw new Error('Expected a request')
    return event.request
  }
  return { coordinator, events, request }
}
afterEach(() => vi.useRealTimers())

describe('interaction coordinator', () => {
  it('keeps distinct parallel requests blocked until their own response arrives', async () => {
    const { coordinator, events, request } = fixture()
    const first = coordinator.request({ kind: 'tool', tool: 'Bash', input: { command: 'first' } })
    const one = request()
    const second = coordinator.request({ kind: 'tool', tool: 'Write' })
    const two = request()
    expect(one.requestId).not.toBe(two.requestId)
    expect(events.filter((event) => event.type === 'permission.resolved')).toHaveLength(0)
    coordinator.respond({ requestId: two.requestId, decision: 'deny' })
    expect(await second).toMatchObject({ decision: 'deny', reason: 'skipped' })
    coordinator.respond({ requestId: one.requestId, decision: 'allow' })
    expect(await first).toMatchObject({ decision: 'allow', request: { input: { command: 'first' } } })
  })

  it('validates complete structured answers and preserves custom text and question identity', async () => {
    const { coordinator, request } = fixture()
    const questions = normalizeQuestions([
      { question: ' Which region? \n', header: 'Region', options: [{ label: 'Asia' }] },
      { question: 'Which features?', multiSelect: true, options: [{ label: 'A' }, { label: 'B' }] },
    ])
    const waiting = coordinator.request({ kind: 'question', tool: 'AskUserQuestion', questions })
    const requestId = request().requestId
    expect(() => coordinator.respond({ requestId, decision: 'allow', answers: {} })).toThrow('every question')
    expect(() => coordinator.respond({ requestId, decision: 'allow', answers: { q0: { selected: ['other'], text: '' }, q1: { selected: ['A'], text: '' } } })).toThrow('unknown')
    coordinator.respond({ requestId, decision: 'allow', answers: {
      q0: { selected: [], text: 'East Asia\nincluding "Japan" -> Tokyo' },
      q1: { selected: ['A', 'B'], text: 'Custom; with commas, too' },
    } })
    expect(answersByQuestion(await waiting)).toEqual({
      ' Which region? \n': 'East Asia\nincluding "Japan" -> Tokyo',
      'Which features?': 'A, B, Custom; with commas, too',
    })
  })

  it('never accepts multiple choices for a radio or mutable inputs on a tool approval', async () => {
    const { coordinator, request } = fixture()
    const waiting = coordinator.request({ kind: 'question', tool: 'AskUserQuestion', questions: normalizeQuestions([{ question: 'Q', options: [{ label: 'A' }, { label: 'B' }] }]) })
    expect(() => coordinator.respond({ requestId: request().requestId, decision: 'allow', answers: { q0: { selected: ['A', 'B'], text: '' } } })).toThrow('one answer')
    coordinator.cancelAll()
    await waiting
    const tool = coordinator.request({ kind: 'tool', tool: 'Bash' })
    expect(() => coordinator.respond({ requestId: request().requestId, decision: 'allow', answers: {} })).toThrow('cannot change')
    coordinator.cancelAll()
    await tool
  })

  it('uses the first decision across tabs and rejects truly unknown requests', async () => {
    const { coordinator, request, events } = fixture()
    const pending = coordinator.request({ kind: 'tool', tool: 'Bash' })
    const requestId = request().requestId
    coordinator.respond({ requestId, decision: 'deny' })
    expect(coordinator.respond({ requestId, decision: 'allow' }).decision).toBe('deny')
    expect((await pending).decision).toBe('deny')
    expect(events.at(-1)).toMatchObject({ type: 'permission.resolved', resolution: { decision: 'deny' } })
    expect(() => coordinator.respond({ requestId: 'unknown', decision: 'allow' })).toThrow('no longer pending')
  })

  it('denies timeout and cancellation, including already-aborted signals', async () => {
    vi.useFakeTimers()
    const { coordinator, events } = fixture(100)
    const waiting = coordinator.request({ kind: 'tool', tool: 'Bash' })
    await vi.advanceTimersByTimeAsync(100)
    expect(await waiting).toMatchObject({ decision: 'deny', reason: 'timeout' })
    const abort = new AbortController()
    const cancelled = coordinator.request({ kind: 'tool', tool: 'Bash' }, { signal: abort.signal })
    abort.abort()
    expect(await cancelled).toMatchObject({ decision: 'deny', reason: 'cancelled' })
    const before = events.length
    expect(await coordinator.request({ kind: 'tool', tool: 'Bash' }, { signal: abort.signal })).toMatchObject({ decision: 'deny', reason: 'cancelled' })
    expect(events).toHaveLength(before)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('restores outstanding requests after event buffer eviction and clears only settled ones', async () => {
    const stream = new SessionStream({ provider: 'claude', id: 'session' }, [], 1)
    const coordinator = new InteractionCoordinator((event) => stream.publish(event))
    const waiting = coordinator.request({ kind: 'tool', tool: 'Bash' })
    stream.publish({ type: 'session.state', state: 'requires_action' })
    const request = stream.snapshot().interactions?.[0]
    if (!request) throw new Error('Missing snapshot request')
    coordinator.respond({ requestId: request.requestId, decision: 'deny' })
    await waiting
    expect(stream.snapshot().interactions).toEqual([])
  })
})
