import type { AgentApiEvent, DurableEvent, DurableEventDraft, EphemeralEvent, ItemDelta } from '../../core/agent-api/events.js'
import { derivedId } from '../../core/agent-api/ids.js'
import { diffGraph, graphMemory, sessionStatusOf, type ProjectionMemory } from '../../core/agent-api/graph-diff.js'
import type { SessionStatus, Usage } from '../../core/agent-api/objects.js'
import {
  blockItemId,
  projectThread,
  toolItemId,
  type ObjectGraph,
  type ResolvedInteraction,
  type RunOutcome,
  type RunRecord,
} from '../../core/agent-api/thread-projection.js'
import type { AgentApiEventLog, AgentApiProjectionState } from '../../core/contract/agent-api-event-store.js'
import { isRunResultEvent, type RunAccounting, type StreamFrame, type TokenUsage } from '../../core/event/agent-event.js'
import type { SessionStream } from '../session/session-stream.js'

export interface SessionProjectorOptions {
  readonly sessionId: string
  readonly log: AgentApiEventLog
  readonly state: AgentApiProjectionState
  readonly save: (state: AgentApiProjectionState) => Promise<void>
  readonly relativePath: (absolute: string) => string
  readonly onError: (error: unknown) => void
}

const SAVE_DELAY_MS = 100

/**
 * Turns one session's `SessionStream` into Agent API events. The object graph
 * is recomputed from stream state and diffed, so live events and history
 * reads describe the same objects. Growing text and tool I/O travel as deltas.
 */
export class SessionProjector {
  private stream: SessionStream | undefined
  private unsubscribe: (() => void) | undefined
  private runs: RunRecord[]
  private memory: ProjectionMemory | null
  private graph: ObjectGraph = { runs: [], threads: new Map(), tasks: [], interactions: [], claims: [] }
  private itemOwners = new Map<string, { run_id: string; thread_id?: string }>()
  private readonly resolved = new Map<string, ResolvedInteraction>()
  private readonly executing = new Set<string>()
  private readonly liveUsage = new Map<string, Usage>()
  private readonly launching = new Set<string>()
  private readonly listeners = new Set<(event: AgentApiEvent) => void>()
  private saveTimer: NodeJS.Timeout | undefined
  private saving: Promise<void> = Promise.resolve()

  constructor(private readonly options: SessionProjectorOptions) {
    this.runs = [...options.state.runs]
    this.memory = options.state.memory
  }

  get lastSeq(): number { return this.options.log.lastSeq }
  get firstSeq(): number { return this.options.log.firstSeq }
  get log(): AgentApiEventLog { return this.options.log }

  /** The stream delivers its snapshot synchronously, which settles events missed while detached. */
  attach(stream: SessionStream): void {
    this.unsubscribe?.()
    this.stream = stream
    this.unsubscribe = stream.subscribe((frame) => { this.onFrame(frame) })
  }

  subscribe(listener: (event: AgentApiEvent) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  /** A fresh graph including text that so far only travelled as deltas. */
  current(): { graph: ObjectGraph; status: SessionStatus } {
    const graph = this.project()
    return { graph, status: sessionStatusOf(graph) }
  }

  /** Accumulated content of in-progress items, sent once to a reconnecting subscriber. */
  resync(): EphemeralEvent[] {
    const { graph } = this.current()
    return [...graph.runs, ...[...graph.threads.values()].flat()].flatMap(({ run, items }) => run.status !== 'in_progress' ? []
      : items.filter((item) => item.status === 'in_progress' || item.status === 'pending' || item.status === 'running')
        .map((item): EphemeralEvent => ({ type: 'item.updated', resync: true, run_id: run.id, ...(run.thread_id === undefined ? {} : { thread_id: run.thread_id }), item })))
  }

  /** Register an API run before launching it so `run.started` appears even if the provider fails to start. */
  launch(record: RunRecord): void {
    this.upsert(record)
    this.launching.add(record.id)
    this.update()
  }

  /** The provider rejected the run before it started. */
  rejected(runId: string, error: { code: string; message: string }): void {
    this.launching.delete(runId)
    this.upsert({ id: runId, outcome: { status: 'failed', stopReason: 'error', error, completedAt: new Date().toISOString() } })
    this.update()
  }

  runRecords(): readonly RunRecord[] { return this.runs }

  async dispose(): Promise<void> {
    this.unsubscribe?.()
    this.unsubscribe = undefined
    clearTimeout(this.saveTimer)
    await this.persist()
    await this.options.log.flush()
  }

  private onFrame(frame: StreamFrame): void {
    try {
      this.observe(frame)
      const delta = deltaOf(frame)
      if (delta !== undefined && this.itemOwners.has(delta.itemId)) {
        this.emitDelta(delta.itemId, delta.delta)
        return
      }
      this.update(frame.type === 'error' ? [{ type: 'session.error', error: { code: frame.code ?? 'session_error', message: frame.message } }] : [])
      if (delta !== undefined) this.emitDelta(delta.itemId, delta.delta)
    } catch (error) {
      this.options.onError(error)
    }
  }

  /** Facts the rendered thread does not keep, captured before the graph is recomputed. */
  private observe(frame: StreamFrame): void {
    if (frame.type === 'run.started' && frame.userMessage !== undefined) {
      const harnessRunId = /^(.+):user$/u.exec(frame.userMessage.id)?.[1] ?? frame.runId
      const existing = this.runs.find((record) => record.harnessRunId === harnessRunId || record.id === harnessRunId)
      this.launching.delete(existing?.id ?? '')
      this.upsert(existing === undefined
        ? { id: derivedId('run', harnessRunId), harnessRunId, text: frame.userMessage.content, createdAt: frame.userMessage.createdAt,
          source: 'web', ...(frame.model === undefined ? {} : { model: frame.model }) }
        : { id: existing.id, ...(frame.model === undefined ? {} : { model: frame.model }) })
    }
    if (frame.type === 'assistant.message') {
      for (const block of frame.blocks) if (block.type === 'tool_use') this.executing.add(block.id)
    }
    if (frame.type === 'tool.running') this.executing.add(frame.id)
    const active = this.activeRun()
    if (frame.type === 'run.usage' && active !== undefined) this.liveUsage.set(active, usageOf(frame.usage))
    if (frame.type === 'permission.resolved') {
      const toolUseId = frame.resolution.request.toolUseId
      const owner = toolUseId === undefined ? active : this.itemOwners.get(toolItemId(toolUseId))?.run_id ?? active
      this.resolved.set(frame.resolution.request.requestId, { resolution: frame.resolution, ...(owner === undefined ? {} : { runId: owner }) })
    }
    if (isRunResultEvent(frame)) {
      this.executing.clear()
      if (active !== undefined) {
        this.liveUsage.delete(active)
        this.launching.delete(active)
        this.upsert({ id: active, outcome: outcomeOf(frame) })
      }
    }
  }

  private update(extra: readonly DurableEventDraft[] = []): void {
    const graph = this.project()
    for (const { runId, nativeUserId } of graph.claims) this.upsert({ id: runId, nativeUserId })
    for (const { run, synthesized } of graph.runs) {
      if (synthesized === true) continue
      const record = this.runs.find((candidate) => candidate.id === run.id)
      if (record?.source === 'api' && record.visible !== true) this.upsert({ id: run.id, visible: true })
    }
    const status = sessionStatusOf(graph)
    if (this.memory === null) {
      // First observation of a session the API never saw: its history is read with GET, not replayed.
      this.memory = graphMemory(graph, status, undefined)
      this.scheduleSave()
    } else {
      const diff = diffGraph(this.memory, graph, status, undefined)
      this.memory = diff.memory
      const drafts = [...diff.events, ...extra]
      if (drafts.length > 0) {
        this.broadcast(this.options.log.append(drafts))
        this.scheduleSave()
      }
    }
    this.graph = graph
    this.itemOwners = owners(graph)
  }

  private project(): ObjectGraph {
    const snapshot = this.stream?.snapshot()
    return projectThread({
      messages: snapshot?.messages ?? [],
      tasks: snapshot?.tasks ?? [],
      pendingInteractions: snapshot?.interactions ?? [],
      resolvedInteractions: [...this.resolved.values()],
      activeRunId: snapshot?.activeRunId,
      executingToolIds: this.executing,
      liveUsage: this.liveUsage,
      runs: this.runs,
      launching: this.launching,
      relativePath: this.options.relativePath,
    })
  }

  private activeRun(): string | undefined {
    return [...this.graph.runs].reverse().find(({ run }) => run.status === 'in_progress')?.run.id
  }

  private emitDelta(itemId: string, delta: ItemDelta): void {
    const owner = this.itemOwners.get(itemId)
    if (owner === undefined) return
    const event: EphemeralEvent = { type: 'item.delta', ...owner, item_id: itemId, delta }
    for (const listener of this.listeners) listener(event)
  }

  private broadcast(events: readonly DurableEvent[]): void {
    for (const event of events) for (const listener of this.listeners) listener(event)
  }

  private upsert(patch: RunRecord): void {
    const index = this.runs.findIndex((record) => record.id === patch.id)
    this.runs = index < 0 ? [...this.runs, patch] : this.runs.map((record, position) => position === index ? { ...record, ...patch } : record)
    this.scheduleSave()
  }

  private scheduleSave(): void {
    if (this.saveTimer !== undefined) return
    this.saveTimer = setTimeout(() => {
      this.saveTimer = undefined
      void this.persist().catch((error: unknown) => { this.options.onError(error) })
    }, SAVE_DELAY_MS)
    this.saveTimer.unref()
  }

  private persist(): Promise<void> {
    const state: AgentApiProjectionState = { runs: this.runs, memory: this.memory }
    this.saving = this.saving.then(async () => {
      // Events precede the state that says they were sent.
      await this.options.log.flush()
      await this.options.save(state)
    })
    return this.saving
  }
}

function owners(graph: ObjectGraph): Map<string, { run_id: string; thread_id?: string }> {
  const map = new Map<string, { run_id: string; thread_id?: string }>()
  for (const { run, items } of [...graph.runs, ...[...graph.threads.values()].flat()]) {
    for (const item of items) map.set(item.id, { run_id: run.id, ...(run.thread_id === undefined ? {} : { thread_id: run.thread_id }) })
  }
  return map
}

function deltaOf(frame: StreamFrame): { itemId: string; delta: ItemDelta } | undefined {
  switch (frame.type) {
    case 'assistant.delta':
      return { itemId: blockItemId(frame.blockId || `${frame.messageId}:${String(frame.index ?? 0)}`), delta: { type: 'text', index: 0, text: frame.text } }
    case 'assistant.thinking_delta':
      return { itemId: blockItemId(frame.blockId || `${frame.messageId}:${String(frame.index ?? 0)}`), delta: { type: 'text', text: frame.text } }
    case 'tool.input_delta':
      return { itemId: toolItemId(frame.id), delta: { type: 'input_json', text: frame.chunk } }
    case 'tool.progress':
      return { itemId: toolItemId(frame.id), delta: { type: 'output', stream: frame.channel === 'stderr' ? 'stderr' : 'stdout', text: frame.chunk } }
    default:
      return undefined
  }
}

function outcomeOf(frame: Extract<StreamFrame, { type: 'run.completed' | 'run.failed' | 'run.aborted' }>): RunOutcome {
  const accounting = accountingOf(frame)
  const completedAt = new Date(frame.ts).toISOString()
  if (frame.type === 'run.completed') return { status: 'completed', stopReason: 'end_turn', completedAt, ...accounting }
  if (frame.type === 'run.aborted') return { status: 'cancelled', stopReason: 'cancelled', completedAt, ...accounting }
  const stopReason = frame.code === 'max_turns' ? 'max_turns' : frame.code === 'max_budget' ? 'budget_exceeded' : 'error'
  return { status: 'failed', stopReason, error: { code: frame.code ?? 'run_failed', message: frame.message }, completedAt, ...accounting }
}

function accountingOf(frame: RunAccounting): Pick<RunOutcome, 'usage' | 'durationMs'> {
  const usage = frame.usage === undefined ? undefined : { ...usageOf(frame.usage), ...(frame.costUsd === undefined ? {} : { cost_usd: frame.costUsd }) }
  return { ...(usage === undefined ? {} : { usage }), ...(frame.durationMs === undefined ? {} : { durationMs: frame.durationMs }) }
}

function usageOf(usage: TokenUsage): Usage {
  return {
    input_tokens: usage.input,
    output_tokens: usage.output,
    ...(usage.cacheRead === undefined ? {} : { cache_read_tokens: usage.cacheRead }),
    ...(usage.cacheWrite === undefined ? {} : { cache_write_tokens: usage.cacheWrite }),
  }
}
