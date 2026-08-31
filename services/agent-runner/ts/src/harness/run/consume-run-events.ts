import type { AgentEvent } from '../../core/event/agent-event.js'
import { BackgroundDrainTracker } from './background-drain.js'

export interface ConsumeRunEventsOptions {
  readonly drain?: BackgroundDrainTracker
  readonly signal?: AbortSignal
}

export async function* consumeRunEvents(
  source: AsyncIterable<AgentEvent>,
  options: ConsumeRunEventsOptions = {},
): AsyncGenerator<AgentEvent> {
  const drain = options.drain ?? new BackgroundDrainTracker()
  const iterator = source[Symbol.asyncIterator]()
  let pending: Promise<IteratorResult<AgentEvent>> | undefined
  let seenResult = false
  let heldCompleted: Extract<AgentEvent, { type: 'run.completed' }> | undefined

  try {
    for (;;) {
      if (options.signal?.aborted) return
      pending ??= Promise.resolve(iterator.next())
      const waitMs = drain.remainingWaitMs(seenResult)

      let result: IteratorResult<AgentEvent>
      if (waitMs === undefined) {
        result = await pending
        pending = undefined
      } else if (waitMs <= 0) {
        if (drain.shouldClose(seenResult)) {
          if (heldCompleted !== undefined) yield heldCompleted
          return
        }
        result = await pending
        pending = undefined
      } else {
        const raced = await raceTimeout(pending, waitMs)
        if (raced === undefined) {
          if (drain.shouldClose(seenResult)) {
            if (heldCompleted !== undefined) yield heldCompleted
            return
          }
          continue
        }
        result = raced
        pending = undefined
      }

      if (result.done) {
        if (heldCompleted !== undefined) yield heldCompleted
        return
      }
      const event = result.value
      drain.observe(event)

      if (event.type === 'run.failed' || event.type === 'run.aborted' || event.type === 'error') {
        yield event
        return
      }
      if (event.type === 'run.completed') {
        seenResult = true
        if (drain.hadBackgroundWork()) {
          yield event
          if (drain.shouldClose(true)) return
          continue
        }
        if (drain.shouldClose(true)) {
          yield event
          return
        }
        heldCompleted = event
        continue
      }
      yield event
    }
  } finally {
    await iterator.return?.()
  }
}

async function raceTimeout<T>(
  pending: Promise<IteratorResult<T>>,
  ms: number,
): Promise<IteratorResult<T> | undefined> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      pending,
      new Promise<undefined>((resolve) => {
        timer = setTimeout(() => resolve(undefined), ms)
      }),
    ])
  } finally {
    if (timer !== undefined) clearTimeout(timer)
  }
}
