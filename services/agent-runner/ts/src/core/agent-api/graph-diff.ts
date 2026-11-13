import type { DurableEventDraft } from './events.js'
import type { Interaction, Item, Run, SessionSettings, SessionStatus, Task } from './objects.js'
import type { ObjectGraph, ProjectedRun } from './thread-projection.js'

/**
 * What the event log has already said about each object. `T` marks objects
 * whose terminal event was emitted; they never produce events again.
 */
export interface ProjectionMemory {
  readonly objects: Readonly<Record<string, string>>
  readonly status: string | null
  readonly settings: string | null
}

export function emptyProjectionMemory(): ProjectionMemory {
  return { objects: {}, status: null, settings: null }
}

/** A session created by the API starts idle; its first event is the first change. */
export function newSessionMemory(): ProjectionMemory {
  const graph: ObjectGraph = { runs: [], threads: new Map(), tasks: [], interactions: [], claims: [] }
  return graphMemory(graph, sessionStatusOf(graph), undefined)
}

/** Memory for a graph that is already known to the client, e.g. history it reads with GET. */
export function graphMemory(graph: ObjectGraph, status: SessionStatus, settings: SessionSettings | undefined): ProjectionMemory {
  return diffGraph(emptyProjectionMemory(), graph, status, settings).memory
}

export function sessionStatusOf(graph: ObjectGraph): SessionStatus {
  const pending = graph.interactions.filter((interaction) => interaction.status === 'pending')
  const running = graph.runs.some(({ run }) => run.status === 'in_progress' || run.status === 'queued')
  const activeTasks = graph.tasks.filter((task) => task.status === 'pending' || task.status === 'running' || task.status === 'paused').length
  if (pending.length > 0) return { state: 'requires_action', interaction_ids: pending.map((interaction) => interaction.id), active_tasks: activeTasks }
  if (running) return { state: 'running', active_tasks: activeTasks }
  const stopReason = graph.runs.at(-1)?.run.stop_reason
  return { state: 'idle', ...(stopReason === undefined ? {} : { stop_reason: stopReason }), active_tasks: activeTasks }
}

/** Durable events, in §8.5 order, that move a client from `previous` to `graph`. */
export function diffGraph(
  previous: ProjectionMemory,
  graph: ObjectGraph,
  status: SessionStatus,
  settings: SessionSettings | undefined,
): { events: DurableEventDraft[]; memory: ProjectionMemory } {
  const events: DurableEventDraft[] = []
  const objects: Record<string, string> = { ...previous.objects }
  const statusKey = JSON.stringify(status)
  const settingsKey = settings === undefined ? previous.settings : JSON.stringify(settings)
  const previousState = previous.status === null ? undefined : (JSON.parse(previous.status) as SessionStatus).state

  if (settings !== undefined && previous.settings !== null && settingsKey !== previous.settings) {
    events.push({ type: 'session.settings_changed', settings, source: 'web' })
  }
  let statusSent = false
  // Starting to run precedes run.started; leaving requires_action follows interaction.resolved.
  if (status.state === 'running' && previousState !== 'running' && previousState !== 'requires_action' && previous.status !== statusKey) {
    events.push({ type: 'session.status_changed', status })
    statusSent = true
  }

  const owned = new Map<string, Interaction[]>()
  for (const interaction of graph.interactions) {
    const key = interaction.run_id ?? ''
    owned.set(key, [...owned.get(key) ?? [], interaction])
  }
  const visitedThreads = new Set<string>()

  const emitRuns = (runs: readonly ProjectedRun[]): void => {
    for (const projected of runs) emitRun(projected)
  }

  const emitRun = ({ run, items }: ProjectedRun): void => {
    const envelope = run.thread_id === undefined ? {} : { thread_id: run.thread_id }
    const key = `run:${run.id}`
    const before = objects[key]
    if (before?.startsWith('T:') === true) return
    const terminal = isTerminalRun(run)
    const state = run.status === 'queued' ? 'Q' : terminal ? 'T' : 'O'
    const signature = JSON.stringify(run)
    if (before === undefined) {
      events.push({ type: run.status === 'queued' ? 'run.queued' : 'run.started', ...envelope, run })
    } else if (before.startsWith('Q:') && run.status !== 'queued') {
      events.push({ type: 'run.started', ...envelope, run })
    } else if (!terminal && before !== `${state}:${signature}`) {
      events.push({ type: 'run.updated', ...envelope, run })
    }
    // A resolution explains the item update that follows it; a request needs its item to exist first.
    const interactions = owned.get(run.id) ?? []
    owned.delete(run.id)
    const known = (interaction: Interaction) => objects[`interaction:${interaction.id}`] !== undefined
    for (const interaction of interactions) if (known(interaction)) emitInteraction(interaction)
    for (const item of items) emitItem(run, item)
    for (const interaction of interactions) if (!known(interaction)) emitInteraction(interaction)
    if (terminal) events.push({ type: 'run.completed', ...envelope, run })
    objects[key] = `${state}:${signature}`
  }

  const emitItem = (run: Run, item: Item): void => {
    const envelope = { run_id: run.id, ...(run.thread_id === undefined ? {} : { thread_id: run.thread_id }) }
    const key = `item:${item.id}`
    const before = objects[key]
    if (before?.startsWith('T:') === true) return
    const terminal = isTerminalItem(item)
    const signature = itemSignature(item)
    if (before === undefined) events.push({ type: 'item.started', ...envelope, item: startedItem(item) })
    else if (!terminal && before !== `O:${signature}`) events.push({ type: 'item.updated', ...envelope, item })
    if (item.type === 'subagent') {
      visitedThreads.add(item.thread_id)
      emitRuns(graph.threads.get(item.thread_id) ?? [])
    }
    if (terminal) events.push({ type: 'item.completed', ...envelope, item })
    objects[key] = `${terminal ? 'T' : 'O'}:${signature}`
  }

  const emitInteraction = (interaction: Interaction): void => {
    const envelope = {
      ...(interaction.run_id === undefined ? {} : { run_id: interaction.run_id }),
      ...(interaction.thread_id === undefined ? {} : { thread_id: interaction.thread_id }),
    }
    const key = `interaction:${interaction.id}`
    const before = objects[key]
    if (before?.startsWith('T:') === true) return
    const resolved = interaction.status === 'resolved'
    if (before === undefined) {
      events.push({ type: 'interaction.requested', ...envelope, interaction: resolved ? { ...interaction, status: 'pending', resolution: undefined } : interaction })
    }
    if (resolved) events.push({ type: 'interaction.resolved', ...envelope, interaction })
    objects[key] = `${resolved ? 'T' : 'O'}:`
  }

  const emitTask = (task: Task): void => {
    const key = `task:${task.id}`
    const before = objects[key]
    if (before?.startsWith('T:') === true) return
    const terminal = isTerminalTask(task)
    const signature = JSON.stringify(task)
    if (before === undefined) events.push({ type: 'task.started', task })
    else if (!terminal && before !== `O:${signature}`) events.push({ type: 'task.updated', task })
    if (terminal) events.push({ type: 'task.completed', task })
    objects[key] = `${terminal ? 'T' : 'O'}:${signature}`
  }

  emitRuns(graph.runs)
  for (const [thread, runs] of graph.threads) if (!visitedThreads.has(thread)) emitRuns(runs)
  for (const interactions of owned.values()) for (const interaction of interactions) emitInteraction(interaction)
  for (const task of graph.tasks) emitTask(task)
  if (!statusSent && previous.status !== statusKey) events.push({ type: 'session.status_changed', status })

  return { events: events.map(stripUndefined), memory: { objects, status: statusKey, settings: settingsKey } }
}

export function isTerminalRun(run: Run): boolean {
  return run.status !== 'queued' && run.status !== 'in_progress'
}

function isTerminalItem(item: Item): boolean {
  if (item.type === 'tool_call') return item.status !== 'pending' && item.status !== 'running'
  if (item.type === 'subagent') return item.status !== 'running'
  return item.status !== 'in_progress'
}

function isTerminalTask(task: Task): boolean {
  return task.status === 'completed' || task.status === 'failed' || task.status === 'cancelled' || task.status === 'unknown'
}

/** Growing content travels as deltas, so it neither starts an item nor counts as an update. */
function startedItem(item: Item): Item {
  if (isTerminalItem(item)) return item
  if (item.type === 'message') return { ...item, content: [] }
  if (item.type === 'reasoning') {
    const started = { ...item }
    delete started.text
    return started
  }
  return item
}

function itemSignature(item: Item): string {
  return JSON.stringify(startedItem(item))
}

function stripUndefined<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}
