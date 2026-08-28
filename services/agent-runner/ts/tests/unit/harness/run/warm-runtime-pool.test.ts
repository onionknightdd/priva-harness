import { afterEach, describe, expect, it, vi } from 'vitest'

import type { AgentRuntime, ProviderRunSpec, SessionRef } from '../../../../src/core/contract/agent-provider.js'
import type { AgentEvent } from '../../../../src/core/event/agent-event.js'
import { WARM_POOL_LIMIT, WarmRuntimePool } from '../../../../src/harness/run/warm-runtime-pool.js'

function fakeRuntime(id: string): AgentRuntime & { released: string[] } {
  const released: string[] = []
  return {
    session: { provider: 'claude', id },
    released,
    run: () => ({ [Symbol.asyncIterator]: () => ({ next: () => Promise.resolve({ done: true, value: undefined }) }) }),
    abort: () => Promise.resolve(),
    release: (retention) => {
      released.push(retention)
      return Promise.resolve()
    },
  }
}

const spec: ProviderRunSpec = {
  cwd: '/work',
  provider: 'claude',
  model: 'm',
  baseUrl: 'https://example.test',
  authToken: 'secret',
  profileId: 'p1',
}

describe('WarmRuntimePool', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('defaults to five live-plus-idle slots', async () => {
    const pool = new WarmRuntimePool()
    expect(WARM_POOL_LIMIT).toBe(5)
    const parked: ReturnType<typeof fakeRuntime>[] = []
    for (let index = 0; index < 5; index += 1) {
      const runtime = fakeRuntime(`s${index}`)
      await pool.acquire({ provider: 'claude', id: `s${index}` }, spec, () => Promise.resolve(runtime))
      await pool.recycle(runtime, spec, runtime.session)
      parked.push(runtime)
    }
    expect(pool.idleCount).toBe(5)
    expect(pool.listIdle().map((session) => session.id)).toEqual([
      's0',
      's1',
      's2',
      's3',
      's4',
    ])
    const extra = fakeRuntime('extra')
    await pool.acquire({ provider: 'claude', id: 'extra' }, spec, () => Promise.resolve(extra))
    expect(parked[0]?.released).toEqual(['warm', 'dispose'])
    expect(pool.size).toBe(5)
  })

  it('reuses an idle runtime with the same spec fingerprint', async () => {
    const pool = new WarmRuntimePool({ limit: 2 })
    const first = fakeRuntime('s1')
    const acquired = await pool.acquire({ provider: 'claude', id: 's1' }, spec, () => Promise.resolve(first))
    expect(acquired).toBe(first)
    await pool.recycle(first, spec, first.session)
    expect(pool.idleCount).toBe(1)
    expect(first.released).toEqual(['warm'])
    const reused = await pool.acquire({ provider: 'claude', id: 's1' }, spec, () => Promise.resolve(fakeRuntime('other')))
    expect(reused).toBe(first)
    expect(first.released).toEqual(['warm'])
  })

  it('evicts the oldest idle runtime when the pool is full', async () => {
    const pool = new WarmRuntimePool({ limit: 2 })
    const older = fakeRuntime('old')
    const newer = fakeRuntime('new')
    await pool.acquire({ provider: 'claude', id: 'old' }, spec, () => Promise.resolve(older))
    await pool.recycle(older, spec, older.session)
    await pool.acquire({ provider: 'claude', id: 'new' }, spec, () => Promise.resolve(newer))
    await pool.recycle(newer, spec, newer.session)
    const extra = fakeRuntime('extra')
    await pool.acquire({ provider: 'claude', id: 'extra' }, spec, () => Promise.resolve(extra))
    expect(older.released).toEqual(['warm', 'dispose'])
    expect(newer.released).toEqual(['warm'])
    expect(pool.size).toBe(2)
  })

  it('disposes overflow runtimes instead of keeping them idle', async () => {
    const pool = new WarmRuntimePool({ limit: 1 })
    const busy = fakeRuntime('busy')
    await pool.acquire({ provider: 'claude', id: 'busy' }, spec, () => Promise.resolve(busy))
    const overflow = fakeRuntime('overflow')
    await pool.acquire({ provider: 'claude', id: 'overflow' }, spec, () => Promise.resolve(overflow))
    await pool.recycle(overflow, spec, overflow.session)
    expect(overflow.released).toEqual(['dispose'])
    expect(pool.busyCount).toBe(1)
    expect(pool.idleCount).toBe(0)
  })

  it('disposes idle runtimes after the idle timeout', async () => {
    vi.useFakeTimers()
    const pool = new WarmRuntimePool({ limit: 2, idleMs: 1000 })
    const runtime = fakeRuntime('s1')
    await pool.acquire({ provider: 'claude', id: 's1' }, spec, () => Promise.resolve(runtime))
    await pool.recycle(runtime, spec, runtime.session)
    await vi.advanceTimersByTimeAsync(1000)
    expect(runtime.released).toEqual(['warm', 'dispose'])
    expect(pool.size).toBe(0)
  })

  it('invalidates an idle lease when the profile or auth token changes', async () => {
    const pool = new WarmRuntimePool({ limit: 2 })
    const runtime = fakeRuntime('s1')
    await pool.acquire({ provider: 'claude', id: 's1' }, spec, () => Promise.resolve(runtime))
    await pool.recycle(runtime, spec, runtime.session)
    const replacement = fakeRuntime('s1')
    const acquired = await pool.acquire(
      { provider: 'claude', id: 's1' },
      { ...spec, profileId: 'p2', authToken: 'other-secret' },
      () => Promise.resolve(replacement),
    )
    expect(runtime.released).toEqual(['warm', 'dispose'])
    expect(acquired).toBe(replacement)
  })

  it('invalidates an idle lease when cwd or model changes', async () => {
    const pool = new WarmRuntimePool({ limit: 2 })
    const runtime = fakeRuntime('s1')
    await pool.acquire({ provider: 'claude', id: 's1' }, spec, () => Promise.resolve(runtime))
    await pool.recycle(runtime, spec, runtime.session)
    const replacement = fakeRuntime('s1')
    const acquired = await pool.acquire(
      { provider: 'claude', id: 's1' },
      { ...spec, cwd: '/other' },
      () => Promise.resolve(replacement),
    )
    expect(runtime.released).toEqual(['warm', 'dispose'])
    expect(acquired).toBe(replacement)
  })
})

describe('WarmRuntimePool idle inbound', () => {
  it('notifies onIdleEvents for a watchable runtime', async () => {
    const received: AgentEvent[][] = []
    const pool = new WarmRuntimePool({
      limit: 1,
      onIdleEvents: (_runtime, _spec, _session, events) => {
        received.push([...events])
      },
    })
    let listener: ((events: readonly AgentEvent[]) => void) | undefined
    const runtime: AgentRuntime & { listenIdle: (next: typeof listener) => void } = {
      session: { provider: 'claude', id: 's1' } satisfies SessionRef,
      run: () => ({ [Symbol.asyncIterator]: () => ({ next: () => Promise.resolve({ done: true, value: undefined }) }) }),
      abort: () => Promise.resolve(),
      release: () => Promise.resolve(),
      listenIdle: (next) => {
        listener = next
      },
    }
    await pool.acquire({ provider: 'claude', id: 's1' }, spec, () => Promise.resolve(runtime))
    await pool.recycle(runtime, spec, runtime.session)
    listener?.([{ type: 'run.started', model: 'm' }])
    expect(received).toEqual([[{ type: 'run.started', model: 'm' }]])
  })
})
