import { AgentApiError } from '../../core/agent-api/errors.js'
import { isDurableEvent } from '../../core/agent-api/events.js'
import { isTerminalRun } from '../../core/agent-api/graph-diff.js'
import { pendingInteractionsOf, runLineage } from '../../core/agent-api/run-lineage.js'
import type { RunResult } from '../../core/agent-api/responses.js'
import type { SessionProjector } from './session-projector.js'

/** Stays below common proxy timeouts so a waiting caller gets the API's 202 rather than a gateway error. */
export const MAX_WAIT_MS = 60_000

export interface RunWait {
  readonly result: RunResult
  /** The run ended, or paused on interactions its caller allowed to interrupt it. */
  readonly settled: boolean
}

/** The run and its pending interactions as the projector currently sees them. */
export function currentRun(projector: SessionProjector, runId: string): RunWait {
  const { graph } = projector.current()
  const projected = [...graph.runs, ...[...graph.threads.values()].flat()].find(({ run }) => run.id === runId)
  if (projected === undefined) throw new AgentApiError('not_found', `Run ${runId} not found`)
  const result: RunResult = { run: projected.run, interactions: pendingInteractionsOf(graph, runId) }
  const main = runLineage(graph, runId).at(-1)
  const interruptible = projector.runRecords().some((record) => record.id === main && record.allowInterrupt === true)
  return { result, settled: isTerminalRun(projected.run) || (interruptible && result.interactions.length > 0) }
}

/** Resolves once the run settles, or with its current state when the time is up or the caller goes away. */
export function waitForRun(projector: SessionProjector, runId: string, options: { readonly timeoutMs: number; readonly signal?: AbortSignal | undefined }): Promise<RunWait> {
  const initial = currentRun(projector, runId)
  if (initial.settled || options.signal?.aborted === true) return Promise.resolve(initial)
  return new Promise((resolve, reject) => {
    const finish = (): void => {
      clearTimeout(timer)
      unsubscribe()
      options.signal?.removeEventListener('abort', finish)
      try {
        resolve(currentRun(projector, runId))
      } catch (error) {
        reject(error instanceof Error ? error : new Error(String(error)))
      }
    }
    const timer = setTimeout(finish, options.timeoutMs)
    const unsubscribe = projector.subscribe((event) => {
      if (!isDurableEvent(event)) return
      let settled: boolean
      try {
        settled = currentRun(projector, runId).settled
      } catch {
        // `finish` reports why the run can no longer be read.
        settled = true
      }
      if (settled) finish()
    })
    options.signal?.addEventListener('abort', finish, { once: true })
  })
}
