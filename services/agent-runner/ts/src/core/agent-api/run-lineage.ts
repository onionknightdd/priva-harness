import type { Interaction } from './objects.js'
import type { ObjectGraph } from './thread-projection.js'

/**
 * A run followed by the runs whose subagents started its thread, ending at
 * the main-thread run. Empty when the chain does not reach the main thread.
 */
export function runLineage(graph: ObjectGraph, runId: string): string[] {
  const starters = new Map<string, string>()
  const threadOf = new Map<string, string>()
  for (const { run, items } of [...graph.runs, ...[...graph.threads.values()].flat()]) {
    if (run.thread_id !== undefined) threadOf.set(run.id, run.thread_id)
    for (const item of items) if (item.type === 'subagent') starters.set(item.thread_id, run.id)
  }
  const lineage = [runId]
  for (let thread = threadOf.get(runId); thread !== undefined; thread = threadOf.get(lineage.at(-1) ?? '')) {
    const starter = starters.get(thread)
    if (starter === undefined || lineage.includes(starter)) return []
    lineage.push(starter)
  }
  return graph.runs.some(({ run }) => run.id === lineage.at(-1)) ? lineage : []
}

/** Interactions without a tool call belong to the main-thread run in progress. */
export function interactionLineage(graph: ObjectGraph, interaction: Interaction): string[] {
  if (interaction.run_id !== undefined) return runLineage(graph, interaction.run_id)
  const active = [...graph.runs].reverse().find(({ run }) => run.status === 'in_progress')
  return active === undefined ? [] : [active.run.id]
}

/** Pending interactions raised by the run or by the subagent threads it started. */
export function pendingInteractionsOf(graph: ObjectGraph, runId: string): Interaction[] {
  return graph.interactions.filter((interaction) => interaction.status === 'pending' && interactionLineage(graph, interaction).includes(runId))
}
