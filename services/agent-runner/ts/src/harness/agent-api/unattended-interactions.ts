import { derivedId } from '../../core/agent-api/ids.js'
import { interactionLineage } from '../../core/agent-api/run-lineage.js'
import type { InteractionResponse } from '../../core/resource/interaction.js'
import type { SessionStream } from '../session/session-stream.js'
import type { SessionProjector } from './session-projector.js'

export interface UnattendedInteractionsOptions {
  readonly stream: SessionStream
  readonly projector: SessionProjector
  /** Interactions are only declined while the API drives the session; WebUI users answer their own. */
  readonly drivenByApi: () => Promise<boolean>
  readonly respond: (response: InteractionResponse) => void
  readonly onError: (error: unknown) => void
}

/**
 * Declines interactions nobody is waiting to answer (`allow_interrupt` is
 * false by default). Only a main-thread API run sent with `allow_interrupt`
 * keeps its interactions, including those of the subagents it started; runs
 * started by background task results have no caller and never do.
 */
export function declineUnattended(options: UnattendedInteractionsOptions): () => void {
  const reviewed = new Set<string>()
  const pendingIds = (): Set<string> => new Set((options.stream.snapshot().interactions ?? []).map((request) => request.requestId))

  const decide = async (requestId: string): Promise<void> => {
    if (!await options.drivenByApi() || !pendingIds().has(requestId)) return
    const { graph } = options.projector.current()
    const interaction = graph.interactions.find((candidate) => candidate.id === derivedId('int', requestId))
    const main = interaction === undefined ? undefined : interactionLineage(graph, interaction).at(-1)
    const owner = options.projector.runRecords().find((record) => record.id === main)
    if (owner?.source === 'api' && owner.allowInterrupt === true) return
    options.respond({ requestId, decision: 'deny', reason: 'unattended' })
  }

  const review = (): void => {
    const pending = pendingIds()
    for (const id of reviewed) if (!pending.has(id)) reviewed.delete(id)
    for (const id of pending) {
      if (reviewed.has(id)) continue
      reviewed.add(id)
      // The stream notifies listeners synchronously; answering after them keeps every listener's order intact.
      queueMicrotask(() => { decide(id).catch(options.onError) })
    }
  }

  return options.stream.subscribe((frame) => {
    if (frame.type === 'permission.requested' || frame.type === 'session.snapshot') review()
  })
}
