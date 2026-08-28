import type { AgentRuntime, ProviderRunSpec, SessionRef } from '../../core/contract/agent-provider.js'
import type { AgentEvent } from '../../core/event/agent-event.js'
import { sessionRefKey } from '../../core/resource/session.js'

export const WARM_POOL_LIMIT = 5
export const WARM_IDLE_MS = 10 * 60 * 1000

export function identityFingerprint(spec: ProviderRunSpec): string {
  return [
    spec.provider,
    spec.cwd,
    spec.profileId ?? '',
    spec.baseUrl,
    spec.authToken,
  ].join('|')
}

export function canApplyWarmRunSpec(
  current: ProviderRunSpec,
  next: ProviderRunSpec,
): boolean {
  return identityFingerprint(current) === identityFingerprint(next)
    && current.effort === next.effort
    && current.modelContext === next.modelContext
    && current.promptSuggestions === next.promptSuggestions
}

export interface IdleWatchable {
  listenIdle(listener: ((events: readonly AgentEvent[]) => void) | undefined): void
}

function isIdleWatchable(runtime: AgentRuntime): runtime is AgentRuntime & IdleWatchable {
  return typeof (runtime as unknown as IdleWatchable).listenIdle === 'function'
}

interface WarmLease {
  readonly runtime: AgentRuntime
  readonly spec: ProviderRunSpec
  readonly session: SessionRef
  idleSince: number
  timer: ReturnType<typeof setTimeout> | undefined
}

export interface WarmRuntimePoolOptions {
  readonly limit?: number
  readonly idleMs?: number
  readonly now?: () => number
  readonly onIdleEvents?: (
    runtime: AgentRuntime,
    spec: ProviderRunSpec,
    session: SessionRef,
    events: readonly AgentEvent[],
  ) => void
}

export class WarmRuntimePool {
  private readonly limit: number
  private readonly idleMs: number
  private readonly now: () => number
  private readonly onIdleEvents: WarmRuntimePoolOptions['onIdleEvents']
  private readonly idle = new Map<string, WarmLease>()
  private readonly busy = new Set<AgentRuntime>()
  private readonly overflow = new Set<AgentRuntime>()

  constructor(options: WarmRuntimePoolOptions = {}) {
    this.limit = options.limit ?? WARM_POOL_LIMIT
    this.idleMs = options.idleMs ?? WARM_IDLE_MS
    this.now = options.now ?? Date.now
    this.onIdleEvents = options.onIdleEvents
  }

  async acquire(
    session: SessionRef | undefined,
    spec: ProviderRunSpec,
    open: () => Promise<AgentRuntime>,
  ): Promise<AgentRuntime> {
    if (session !== undefined && session.id !== '') {
      const key = sessionRefKey(session)
      const lease = this.idle.get(key)
      if (lease !== undefined) {
        if (canApplyWarmRunSpec(lease.spec, spec)) {
          try {
            await lease.runtime.applyRunSpec(spec)
            this.clearTimer(lease)
            this.idle.delete(key)
            if (isIdleWatchable(lease.runtime)) lease.runtime.listenIdle(undefined)
            this.busy.add(lease.runtime)
            return lease.runtime
          } catch {
            await this.evict(key)
          }
        } else {
          await this.evict(key)
        }
      }
    }
    while (this.size >= this.limit && this.idle.size > 0) {
      const oldest = this.oldestIdleKey()
      if (oldest === undefined) break
      await this.evict(oldest)
    }
    const overflow = this.size >= this.limit
    const runtime = await open()
    this.busy.add(runtime)
    if (overflow) this.overflow.add(runtime)
    return runtime
  }

  claim(runtime: AgentRuntime): void {
    for (const [key, lease] of this.idle) {
      if (lease.runtime !== runtime) continue
      this.clearTimer(lease)
      this.idle.delete(key)
      this.busy.add(runtime)
      return
    }
    this.busy.add(runtime)
  }

  async recycle(
    runtime: AgentRuntime,
    spec: ProviderRunSpec,
    session: SessionRef,
  ): Promise<void> {
    this.busy.delete(runtime)
    if (this.overflow.delete(runtime) || session.id === '') {
      await runtime.release('dispose')
      return
    }
    while (this.size >= this.limit && this.idle.size > 0) {
      const oldest = this.oldestIdleKey()
      if (oldest === undefined) break
      await this.evict(oldest)
    }
    if (this.size >= this.limit) {
      await runtime.release('dispose')
      return
    }
    const key = sessionRefKey(session)
    const existing = this.idle.get(key)
    if (existing !== undefined && existing.runtime !== runtime) {
      await this.evict(key)
    }
    const lease: WarmLease = {
      runtime,
      spec,
      session,
      idleSince: this.now(),
      timer: undefined,
    }
    lease.timer = setTimeout(() => {
      void this.evict(key)
    }, this.idleMs)
    this.idle.set(key, lease)
    await runtime.release('warm')
    if (isIdleWatchable(runtime) && this.onIdleEvents !== undefined) {
      runtime.listenIdle((events) => {
        lease.idleSince = this.now()
        this.clearTimer(lease)
        lease.timer = setTimeout(() => {
          void this.evict(key)
        }, this.idleMs)
        this.onIdleEvents?.(runtime, spec, session, events)
      })
    }
  }

  async disposeAll(): Promise<void> {
    const keys = [...this.idle.keys()]
    for (const key of keys) await this.evict(key)
  }

  get size(): number {
    return this.idle.size + this.busy.size
  }

  listIdle(): readonly SessionRef[] {
    return [...this.idle.values()].map((lease) => lease.session)
  }

  get idleCount(): number {
    return this.idle.size
  }

  get busyCount(): number {
    return this.busy.size
  }

  private oldestIdleKey(): string | undefined {
    let oldest: { key: string; at: number } | undefined
    for (const [key, lease] of this.idle) {
      if (oldest === undefined || lease.idleSince < oldest.at) {
        oldest = { key, at: lease.idleSince }
      }
    }
    return oldest?.key
  }

  private async evict(key: string): Promise<void> {
    const lease = this.idle.get(key)
    if (lease === undefined) return
    this.idle.delete(key)
    this.clearTimer(lease)
    if (isIdleWatchable(lease.runtime)) lease.runtime.listenIdle(undefined)
    await lease.runtime.release('dispose')
  }

  private clearTimer(lease: WarmLease): void {
    if (lease.timer !== undefined) clearTimeout(lease.timer)
    lease.timer = undefined
  }
}
