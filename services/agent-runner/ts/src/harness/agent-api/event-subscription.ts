import { AgentApiError } from '../../core/agent-api/errors.js'
import { isDurableEvent, type AgentApiEvent } from '../../core/agent-api/events.js'
import type { SessionProjector } from './session-projector.js'

export interface SubscriptionOptions {
  /** `now` follows only events from this moment, e.g. to stream a run about to be launched. */
  readonly after: number | 'now'
  readonly deltas: boolean
  readonly threads: 'all' | 'main'
}

export interface EventSubscription {
  close(): void
}

/** Reject a cursor the log cannot continue from (§8.6). */
export function assertCursor(projector: SessionProjector, after: number): void {
  if (after > projector.lastSeq) {
    throw new AgentApiError('cursor_invalid', `Cursor ${String(after)} is ahead of the latest event ${String(projector.lastSeq)}`, { param: 'after' })
  }
  if (after < projector.firstSeq - 1) {
    throw new AgentApiError('cursor_expired', `Cursor ${String(after)} is older than the retained events`,
      { param: 'after', details: { last_event_seq: projector.lastSeq } })
  }
}

/**
 * Durable events after the cursor, then the accumulated content of in-progress
 * items, then live events. Durable events that arrive during the replay are
 * held back and deduplicated by `seq`; deltas from that window are already
 * part of the resync content and are dropped.
 */
export async function subscribeEvents(
  projector: SessionProjector,
  options: SubscriptionOptions,
  deliver: (event: AgentApiEvent) => void,
): Promise<EventSubscription> {
  const send = (event: AgentApiEvent) => { if (accepts(event, options)) deliver(event) }
  if (options.after === 'now') {
    const unsubscribe = projector.subscribe(send)
    return { close: unsubscribe }
  }
  const after = options.after
  assertCursor(projector, after)
  const held: AgentApiEvent[] = []
  let replaying = true
  const unsubscribe = projector.subscribe((event) => {
    if (replaying) held.push(event)
    else send(event)
  })
  try {
    let lastSeq = after
    for (const event of await projector.log.read(after)) {
      send(event)
      lastSeq = event.seq
    }
    for (const event of held) if (isDurableEvent(event) && event.seq > lastSeq) send(event)
    for (const event of projector.resync()) send(event)
  } catch (error) {
    unsubscribe()
    throw error
  }
  replaying = false
  return { close: unsubscribe }
}

/**
 * The events of one run for `stream: true`: the run itself, the threads of
 * subagents it started, the tasks it launched and session status changes.
 */
export function runScope(runId: string): { includes(event: AgentApiEvent): boolean; ends(event: AgentApiEvent): boolean } {
  const threads = new Set<string>()
  const inScope = (owner: { readonly run_id?: string | undefined; readonly thread_id?: string | undefined }) =>
    owner.run_id === runId || (owner.thread_id !== undefined && threads.has(owner.thread_id))
  return {
    includes(event) {
      switch (event.type) {
        case 'session.status_changed':
          return true
        case 'run.queued':
        case 'run.started':
        case 'run.updated':
        case 'run.completed':
          return event.run.id === runId || (event.run.thread_id !== undefined && threads.has(event.run.thread_id))
        case 'item.started':
        case 'item.updated':
        case 'item.completed':
          if (!inScope(event)) return false
          if (event.item.type === 'subagent') threads.add(event.item.thread_id)
          return true
        case 'item.delta':
        case 'interaction.requested':
        case 'interaction.resolved':
          return inScope(event)
        case 'task.started':
          return event.task.origin?.run_id === runId
        default:
          return false
      }
    },
    ends(event) {
      return event.type === 'run.completed' && event.run.id === runId
    },
  }
}

function accepts(event: AgentApiEvent, options: SubscriptionOptions): boolean {
  if (options.threads === 'main' && 'thread_id' in event && event.thread_id !== undefined) return false
  if (!options.deltas && event.type === 'item.delta') return false
  return event.type !== 'native'
}
