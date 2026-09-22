import { describe, expect, it, vi } from 'vitest'

import type { ProviderSessionStore } from '../../../../src/core/contract/provider-session-store.js'
import type { ThreadReplayItem } from '../../../../src/core/resource/thread.js'
import { SessionError } from '../../../../src/core/resource/session.js'
import { AgentHarness } from '../../../../src/harness/agent-harness.js'
import { SessionStream } from '../../../../src/harness/session/session-stream.js'
import { TerminalHistoryMirror } from '../../../../src/harness/terminal/terminal-history-mirror.js'
import { FakeAgentProvider } from '../../../support/fake-agent-provider.js'
import { FakeSessionStore } from '../../../support/fake-session-store.js'

const ref = { provider: 'claude', id: 'native-session' } as const
const user = (id: string, content: string): ThreadReplayItem => ({ kind: 'user', id, content, createdAt: '2026-09-22T00:00:00.000Z' })

function setup() {
  let changed: () => void = () => undefined
  const unwatch = vi.fn()
  const store = Object.assign(new FakeSessionStore(), {
    watch: vi.fn<NonNullable<ProviderSessionStore['watch']>>().mockImplementation((_ref, _cwd, listener) => {
      changed = listener
      return Promise.resolve(unwatch)
    }),
  })
  const replay = vi.spyOn(store, 'replay').mockResolvedValue([])
  const stream = new SessionStream(ref)
  return { store, stream, replay, unwatch, changed: () => changed(), mirror: new TerminalHistoryMirror(store, stream) }
}

describe('terminal transcript synchronization', () => {
  it('waits for a new transcript, publishes updates to existing subscribers and ignores unchanged content', async () => {
    const { stream, replay, mirror, changed, unwatch } = setup()
    replay.mockRejectedValueOnce(new SessionError('session-not-found', 'not written yet'))
    const frames: string[] = []
    const unsubscribe = stream.subscribe((frame) => frames.push(frame.type))
    await mirror.start('/work')
    expect(frames).toEqual(['session.snapshot'])
    replay.mockResolvedValue([user('u1', 'TUI 中文消息 🚀')])
    changed()
    await mirror.refresh()
    expect(stream.snapshot().messages).toMatchObject([{ id: 'u1', content: 'TUI 中文消息 🚀' }])
    expect(frames).toEqual(['session.snapshot', 'session.snapshot'])
    const seq = stream.snapshot().seq
    await mirror.refresh()
    expect(stream.snapshot().seq).toBe(seq)
    await mirror.stop()
    expect(unwatch).toHaveBeenCalledOnce()
    replay.mockClear()
    changed()
    await mirror.refresh()
    expect(replay).not.toHaveBeenCalled()
    unsubscribe()
  })

  it('reads again when the transcript changes during an in-flight replay', async () => {
    const { stream, replay, mirror, changed } = setup()
    await mirror.start('/work')
    let finish!: (items: readonly ThreadReplayItem[]) => void
    replay.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve }))
    const pending = mirror.refresh()
    await vi.waitFor(() => expect(finish).toBeDefined())
    changed()
    replay.mockResolvedValue([user('u1', 'first'), user('u2', 'second')])
    finish([user('u1', 'first')])
    await pending
    expect(stream.snapshot().messages.map((message) => message.content)).toEqual(['first', 'second'])
    await mirror.stop()
  })

  it('reports read failures and recovers on a later change without clearing known history', async () => {
    const { stream, replay, mirror } = setup()
    replay.mockResolvedValue([user('u1', 'kept')])
    await mirror.start('/work')
    const frames: unknown[] = []
    const unsubscribe = stream.subscribe((frame) => frames.push(frame))
    replay.mockRejectedValueOnce(new Error('read denied'))
    await mirror.refresh()
    expect(frames.at(-1)).toMatchObject({ type: 'error', code: 'terminal.history', message: 'Could not sync terminal messages: read denied' })
    expect(stream.snapshot().messages[0]?.content).toBe('kept')
    replay.mockResolvedValue([user('u1', 'kept'), user('u2', 'recovered')])
    await mirror.refresh()
    expect(stream.snapshot().messages).toHaveLength(2)
    await mirror.stop()
    unsubscribe()
  })

  it('shares one observer across terminal viewers and cleans it up after the last disconnect', async () => {
    const { store, unwatch } = setup()
    const provider = new FakeAgentProvider('claude', [], store)
    const harness = new AgentHarness({ providers: { claude: provider, pi: new FakeAgentProvider('pi', []) }, cwd: '/work' })
    const [first, second] = await Promise.all([
      harness.observeTerminalHistory(ref, '/work'), harness.observeTerminalHistory(ref, '/work'),
    ])
    expect(store.watch).toHaveBeenCalledOnce()
    await first()
    expect(unwatch).not.toHaveBeenCalled()
    await second()
    expect(unwatch).toHaveBeenCalledOnce()
    await second()
    expect(unwatch).toHaveBeenCalledOnce()
    await harness.disposePool()
  })
})
