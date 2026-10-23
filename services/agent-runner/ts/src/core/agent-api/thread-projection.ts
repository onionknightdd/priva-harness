import type { ModelInvocation } from '../event/agent-event.js'
import { isAgentName } from '../event/tool-names.js'
import { taskIsActive, type BackgroundTask, type TaskNotification } from '../resource/background-task.js'
import type { InteractionRequest, InteractionResolution } from '../resource/interaction.js'
import type { ThreadBlock, ThreadMessage, ThreadNestedAgent, ThreadToolCard } from '../resource/thread.js'
import type { WorkflowState } from '../resource/workflow.js'
import { derivedId, hasPrefix } from './ids.js'
import type { ContentBlock, Interaction, Item, Run, RunInput, StopReason, Task, Usage } from './objects.js'
import { describeTool } from './tool-kind.js'

/** What the API knows about a run beyond the rendered thread; persisted per platform session. */
export interface RunRecord {
  readonly id: string
  /** The harness run ID while the run is live; API runs use their platform ID. */
  readonly harnessRunId?: string
  /** The transcript UUID of the user message once history has been matched to this run. */
  readonly nativeUserId?: string
  /** User text, used to match a live run to its transcript message after a restart. */
  readonly text?: string
  readonly messageId?: string
  readonly source?: 'api' | 'web' | 'terminal'
  readonly content?: readonly ContentBlock[]
  readonly model?: string
  readonly createdAt?: string
  readonly outcome?: RunOutcome
  /** Set once the run appeared in the thread; only API runs never seen there are shown on their own. */
  readonly visible?: true
  /** The caller lets this API run pause for interactions; without it they are declined as unattended. */
  readonly allowInterrupt?: true
  readonly idempotency?: {
    readonly key: string
    readonly requestHash: string
    /** The first response, returned again for a retried request. */
    readonly accepted: { readonly messageId: string; readonly status: 'queued' | 'in_progress'; readonly lastEventSeq: number }
  }
}

export interface RunOutcome {
  readonly status: 'completed' | 'failed' | 'cancelled' | 'interrupted'
  readonly stopReason: StopReason
  readonly error?: { readonly code: string; readonly message: string }
  readonly usage?: Usage
  readonly durationMs?: number
  readonly completedAt: string
  readonly interruptedBy?: string
}

export interface ResolvedInteraction {
  readonly resolution: InteractionResolution
  readonly runId?: string
}

export interface ThreadProjectionInput {
  readonly messages: readonly ThreadMessage[]
  readonly tasks: readonly BackgroundTask[]
  readonly pendingInteractions: readonly InteractionRequest[]
  readonly resolvedInteractions: readonly ResolvedInteraction[]
  /** Set while a turn is live; the last main-thread run is then in progress. */
  readonly activeRunId: string | undefined
  /** Tools whose input is complete and that have started executing. */
  readonly executingToolIds: ReadonlySet<string>
  readonly liveUsage: ReadonlyMap<string, Usage>
  readonly runs: readonly RunRecord[]
  /** API runs accepted but not yet visible in the thread; they are in progress. */
  readonly launching: ReadonlySet<string>
  readonly relativePath: (absolute: string) => string
}

export interface ProjectedRun {
  readonly run: Run
  readonly items: readonly Item[]
  /** An API run shown from its record because the thread does not contain it. */
  readonly synthesized?: true
}

export interface ObjectGraph {
  readonly runs: readonly ProjectedRun[]
  /** Runs of subagent threads keyed by thread ID, in order. */
  readonly threads: ReadonlyMap<string, readonly ProjectedRun[]>
  readonly tasks: readonly Task[]
  readonly interactions: readonly Interaction[]
  /** Transcript messages newly matched to recorded runs; callers persist them. */
  readonly claims: readonly { readonly runId: string; readonly nativeUserId: string }[]
}

interface Segment {
  readonly key: string
  readonly user?: ThreadMessage
  readonly notification?: TaskNotification
  readonly createdAt: string
  readonly entries: SegmentEntry[]
  /** When the first assistant message of the run appeared. */
  startedAt: string | undefined
  streaming: boolean
  error: string | undefined
  durationMs: number | undefined
}

type SegmentEntry =
  | { readonly kind: 'block'; readonly block: ThreadBlock; readonly message: ThreadMessage }
  | { readonly kind: 'compaction'; readonly message: ThreadMessage; readonly trigger: 'auto' | 'manual' }

const NO_RESPONSE = 'No response requested.'

export function projectThread(input: ThreadProjectionInput): ObjectGraph {
  const context = new ProjectionContext(input)
  const segments = segmentMain(input.messages)
  const runs = segments.map((segment, index) => context.mainRun(segment, index === segments.length - 1))
  runs.push(...context.unseenApiRuns(new Set(runs.map(({ run }) => run.id))))
  const tasks = input.tasks.map((task) => context.task(task))
  const interactions = [
    ...input.pendingInteractions.map((request) => context.interaction(request, undefined, undefined)),
    ...input.resolvedInteractions.map(({ resolution, runId }) => context.interaction(resolution.request, resolution, runId)),
  ]
  return { runs, threads: context.threads, tasks, interactions, claims: context.claims }
}

function segmentMain(messages: readonly ThreadMessage[]): Segment[] {
  const segments: Segment[] = []
  let current: Segment | undefined
  const open = (key: string, createdAt: string, extra: Partial<Pick<Segment, 'user' | 'notification'>> = {}): Segment => {
    current = { key, createdAt, entries: [], startedAt: undefined, streaming: false, error: undefined, durationMs: undefined, ...extra }
    segments.push(current)
    return current
  }
  for (const message of messages) {
    if (message.role === 'user') {
      if (message.compact !== undefined && message.id.startsWith('compact:')) {
        const target = current ?? open(`compact:${message.id}`, message.createdAt)
        target.entries.push({ kind: 'compaction', message, trigger: 'auto' })
        continue
      }
      const segment = open(`user:${message.id}`, message.createdAt, { user: message })
      if (message.compact !== undefined) segment.entries.push({ kind: 'compaction', message, trigger: 'manual' })
      continue
    }
    let touched = current ?? open(`assistant:${message.id}`, message.createdAt)
    touched.startedAt ??= message.createdAt
    for (const block of [...(message.blocks ?? [])].sort((left, right) => left.index - right.index)) {
      if (block.type === 'task_notification') {
        // A batch of notifications delivered together starts one run.
        if (touched.notification !== undefined && touched.entries.length === 0) continue
        touched = open(`notification:${block.notification.id}`, block.notification.createdAt ?? message.createdAt, { notification: block.notification })
        touched.startedAt = touched.createdAt
        continue
      }
      touched.entries.push({ kind: 'block', block, message })
    }
    touched.streaming = message.status === 'streaming'
    if (message.status === 'error') touched.error = message.content.trim() || 'Run failed'
    if (message.durationMs !== undefined) touched.durationMs = message.durationMs
  }
  return segments
}

class ProjectionContext {
  readonly threads = new Map<string, ProjectedRun[]>()
  readonly claims: { runId: string; nativeUserId: string }[] = []
  private readonly toolRuns = new Map<string, string>()
  private readonly claimed = new Set<string>()
  private claimFloor = ''
  private readonly workflows = new Map<string, WorkflowState>()
  private readonly deniedTools = new Set<string>()
  private readonly awaitingTools: ReadonlySet<string>

  constructor(private readonly input: ThreadProjectionInput) {
    this.awaitingTools = new Set(input.pendingInteractions.flatMap((request) => request.toolUseId === undefined ? [] : [request.toolUseId]))
    for (const message of input.messages) {
      for (const workflow of message.workflows ?? []) if (workflow.taskId) this.workflows.set(workflow.taskId, workflow)
    }
    for (const { resolution } of input.resolvedInteractions) {
      if (resolution.decision === 'deny' && resolution.request.toolUseId) this.deniedTools.add(resolution.request.toolUseId)
    }
  }

  mainRun(segment: Segment, last: boolean): ProjectedRun {
    const { id, record } = this.identify(segment)
    const inProgress = last && this.input.activeRunId !== undefined && (segment.streaming || segment.entries.length === 0)
    const outcome = record?.outcome
    const status: Run['status'] = inProgress ? 'in_progress'
      : outcome?.status ?? (segment.error === undefined ? 'completed' : 'failed')
    const items = this.items(segment.entries, id, status === 'in_progress')
    const usage = outcome?.usage ?? this.input.liveUsage.get(id)
    const durationMs = outcome?.durationMs ?? segment.durationMs
    const output = status === 'in_progress' ? undefined : outputText(items)
    const run: Run = {
      id,
      status,
      ...(record?.model === undefined ? {} : { model: record.model }),
      input: this.runInput(segment, record),
      ...(status === 'in_progress' ? {} : { stop_reason: outcome?.stopReason ?? (status === 'failed' ? 'error' : 'end_turn') }),
      ...(output === undefined ? {} : { output_text: output }),
      ...(outcome?.interruptedBy === undefined ? {} : { interrupted_by: { message_id: outcome.interruptedBy } }),
      ...(status === 'failed' ? { error: outcome?.error ?? { code: 'run_failed', message: segment.error ?? 'Run failed' } } : {}),
      ...(usage === undefined ? {} : { usage }),
      ...(status === 'in_progress' || durationMs === undefined ? {} : { duration_ms: durationMs }),
      created_at: record?.createdAt ?? segment.createdAt,
      ...(segment.startedAt === undefined ? {} : { started_at: segment.startedAt }),
      ...(outcome === undefined ? {} : { completed_at: outcome.completedAt }),
    }
    return { run, items }
  }

  /**
   * API runs the thread does not show: still launching, or ended before the
   * provider wrote anything (for example a runtime that failed to start).
   */
  unseenApiRuns(seen: ReadonlySet<string>): ProjectedRun[] {
    return this.input.runs.filter((record) => record.source === 'api' && record.visible !== true && !seen.has(record.id)).map((record) => {
      const outcome = record.outcome ?? (this.input.launching.has(record.id) ? undefined
        : { status: 'failed' as const, stopReason: 'error' as const, error: { code: 'run_lost', message: 'The run ended without a result' }, completedAt: record.createdAt ?? new Date(0).toISOString() })
      const status = outcome?.status ?? 'in_progress'
      const run: Run = {
        id: record.id,
        status,
        ...(record.model === undefined ? {} : { model: record.model }),
        input: record.messageId === undefined ? null : { type: 'user_message', message_id: record.messageId, source: 'api', content: [...record.content ?? []] },
        ...(outcome === undefined ? {} : { stop_reason: outcome.stopReason }),
        ...(outcome?.error === undefined ? {} : { error: outcome.error }),
        ...(outcome?.usage === undefined ? {} : { usage: outcome.usage }),
        ...(outcome?.durationMs === undefined ? {} : { duration_ms: outcome.durationMs }),
        created_at: record.createdAt ?? new Date(0).toISOString(),
        ...(outcome === undefined ? {} : { completed_at: outcome.completedAt }),
      }
      return { run, items: [], synthesized: true as const }
    })
  }

  task(task: BackgroundTask): Task {
    const workflow = this.workflows.get(task.taskId)
    const terminal = !taskIsActive(task)
    const outputPath = task.outputFile === undefined ? undefined : this.input.relativePath(task.outputFile)
    const originRun = task.toolUseId === undefined ? undefined : this.toolRuns.get(task.toolUseId)
    return {
      id: derivedId('task', task.taskId),
      kind: task.kind === 'bash' ? 'shell' : task.kind,
      status: task.status,
      ...(task.description === undefined ? {} : { description: task.description }),
      ...(task.kind === 'agent' && task.toolUseId !== undefined ? { thread_id: threadId(task.toolUseId) } : {}),
      ...(originRun === undefined ? {} : { origin: { run_id: originRun, ...(task.toolUseId === undefined ? {} : { item_id: toolItemId(task.toolUseId) }) } }),
      ...(workflow === undefined ? {} : { workflow: {
        ...(workflow.name === undefined ? {} : { name: workflow.name }),
        phases: workflow.phases.map((phase) => ({ index: phase.index, title: phase.title })),
        agents: workflow.agents.map((agent) => ({
          label: agent.label,
          ...(agent.phaseIndex === undefined ? {} : { phase_index: agent.phaseIndex }),
          ...(agent.agentId === undefined ? {} : { thread_id: derivedId('thr', `workflow:${agent.agentId}`) }),
          status: agent.state,
          ...(agent.lastToolName === undefined ? {} : { last_tool: agent.lastToolName }),
          ...(agent.tokens === undefined ? {} : { tokens: agent.tokens }),
          ...(agent.durationMs === undefined ? {} : { duration_ms: agent.durationMs }),
        })),
      } }),
      ...(terminal && task.summary !== undefined ? { result: {
        summary: task.summary,
        ...(outputPath === undefined || outputPath.startsWith('..') ? {} : { output_path: outputPath }),
      } } : {}),
      ...(task.tokens === undefined ? {} : { usage: { total_tokens: task.tokens } }),
      stop_requested: task.stopRequested === true,
      ...(terminal && task.updatedAt !== undefined ? { completed_at: new Date(task.updatedAt).toISOString() } : {}),
      ...(task.durationMs === undefined ? {} : { duration_ms: task.durationMs }),
    }
  }

  interaction(request: InteractionRequest, resolution: InteractionResolution | undefined, runId: string | undefined): Interaction {
    const owner = runId ?? (request.toolUseId === undefined ? undefined : this.toolRuns.get(request.toolUseId))
    const base = {
      id: derivedId('int', request.requestId),
      ...(owner === undefined ? {} : { run_id: owner }),
      ...(request.toolUseId === undefined ? {} : { item_id: toolItemId(request.toolUseId) }),
      ...(request.title === undefined ? {} : { title: request.title }),
      ...(request.reason === undefined ? {} : { reason: request.reason }),
      expires_at: new Date(request.expiresAt).toISOString(),
      status: resolution === undefined ? 'pending' as const : 'resolved' as const,
      ...(resolution === undefined ? {} : { resolution: {
        decision: resolution.decision,
        reason: resolution.reason,
        ...(resolution.answers === undefined ? {} : { answers: Object.fromEntries(Object.entries(resolution.answers).map(([id, answer]) => [id, { selected: [...answer.selected], text: answer.text }])) }),
      } }),
    }
    if (request.kind === 'question') {
      return {
        ...base,
        type: 'question',
        questions: request.questions.map((question) => ({
          id: question.id,
          question: question.question,
          header: question.header ?? null,
          options: question.options.map((option) => ({ label: option.label, description: option.description ?? null })),
          multi_select: question.multiSelect,
          allow_custom: question.allowCustom ?? false,
          multiline: question.multiline ?? false,
          initial_text: question.initialText ?? null,
        })),
      }
    }
    return { ...base, type: 'approval', tool: describeTool(request.tool), ...(request.input === undefined ? {} : { input: request.input }) }
  }

  private identify(segment: Segment): { id: string; record: RunRecord | undefined } {
    const user = segment.user
    if (user === undefined) {
      const id = derivedId('run', segment.key)
      return { id, record: this.input.runs.find((record) => record.id === id) }
    }
    const live = /^(.+):user$/u.exec(user.id)?.[1]
    if (live !== undefined) {
      const record = this.input.runs.find((candidate) => candidate.harnessRunId === live || candidate.id === live)
      return { id: record?.id ?? (hasPrefix(live, 'run') ? live : derivedId('run', live)), record }
    }
    const nativeUserId = user.transcriptUuid ?? user.id
    const record = this.input.runs.find((candidate) => candidate.nativeUserId === nativeUserId) ?? this.claim(user, nativeUserId)
    if (record?.createdAt !== undefined && record.createdAt > this.claimFloor) this.claimFloor = record.createdAt
    return { id: record?.id ?? derivedId('run', nativeUserId), record }
  }

  /** Match a transcript message to the earliest unmatched recorded run with the same text, preserving order. */
  private claim(user: ThreadMessage, nativeUserId: string): RunRecord | undefined {
    const text = user.content.trim()
    const latest = new Date(Date.parse(user.createdAt) + 5 * 60_000).toISOString()
    const record = this.input.runs.find((candidate) => candidate.nativeUserId === undefined && !this.claimed.has(candidate.id) &&
      candidate.text?.trim() === text && (candidate.createdAt ?? '') >= this.claimFloor && (candidate.createdAt ?? '') <= latest)
    if (record === undefined) return undefined
    this.claimed.add(record.id)
    this.claims.push({ runId: record.id, nativeUserId })
    return record
  }

  private runInput(segment: Segment, record: RunRecord | undefined): RunInput | null {
    if (segment.notification !== undefined) {
      const task = segment.notification.task
      return {
        type: 'task_result',
        task_id: derivedId('task', task.taskId),
        status: task.status,
        ...(task.summary === undefined ? {} : { summary: task.summary }),
      }
    }
    const user = segment.user
    if (user === undefined) return null
    return {
      type: 'user_message',
      message_id: record?.messageId ?? derivedId('msg', user.transcriptUuid ?? user.id),
      source: record?.source ?? 'web',
      content: record?.content !== undefined ? [...record.content] : this.userContent(user),
    }
  }

  private userContent(user: ThreadMessage): ContentBlock[] {
    const attachments = user.attachments ?? []
    const images = attachments.filter((file) => file.mimeType.startsWith('image/'))
    const files = attachments.filter((file) => !file.mimeType.startsWith('image/'))
    return [
      ...images.map((file): ContentBlock => ({ type: 'image', image_path: this.input.relativePath(file.path), media_type: file.mimeType })),
      ...(user.content.trim() === '' ? [] : [{ type: 'text' as const, text: user.content }]),
      ...files.map((file): ContentBlock => ({ type: 'file', file_path: this.input.relativePath(file.path), name: file.name, media_type: file.mimeType, size: file.size })),
    ]
  }

  private items(entries: readonly SegmentEntry[], runId: string, inProgress: boolean): Item[] {
    const items: Item[] = []
    const lastIndex = entries.length - 1
    for (const [index, entry] of entries.entries()) {
      const open = inProgress && index === lastIndex
      if (entry.kind === 'compaction') {
        items.push(compactionItem(entry.message, entry.trigger))
        continue
      }
      const item = this.blockItem(entry.block, entry.message, runId, open, inProgress)
      if (item !== undefined) items.push(item)
    }
    return items
  }

  private blockItem(block: ThreadBlock, message: ThreadMessage, runId: string, open: boolean, runActive: boolean): Item | undefined {
    switch (block.type) {
      case 'text':
        if (!open && block.text.trim() === NO_RESPONSE) return undefined
        return { id: derivedId('itm', block.blockId), type: 'message', status: open ? 'in_progress' : 'completed',
          content: [{ type: 'text', text: block.text }] }
      case 'thinking':
        return { id: derivedId('itm', block.blockId), type: 'reasoning', status: open ? 'in_progress' : 'completed',
          ...(block.text === '' ? {} : { text: block.text }),
          ...(block.durationMs === undefined ? {} : { duration_ms: block.durationMs }) }
      case 'image': {
        const url = block.url ?? (block.b64 === undefined ? undefined : `data:${block.mime ?? 'image/png'};base64,${block.b64}`)
        if (url === undefined) return undefined
        return { id: derivedId('itm', block.blockId), type: 'message', status: open ? 'in_progress' : 'completed',
          content: [{ type: 'image', image_url: url, ...(block.mime === undefined ? {} : { media_type: block.mime }), ...(block.alt === undefined ? {} : { alt: block.alt }) }] }
      }
      case 'tool_use':
        this.toolRuns.set(block.id, runId)
        return isAgentName(block.name)
          ? this.subagentItem(block, message, runActive)
          : this.toolItem(block, runActive)
      case 'task_notification':
      case 'unknown':
        return undefined
    }
  }

  private toolItem(block: Extract<ThreadBlock, { type: 'tool_use' }>, runActive: boolean): Item {
    const card = block.tool
    const status = toolStatus(card, block.id, runActive, this.input.executingToolIds, this.awaitingTools, this.deniedTools)
    // Arguments still being generated travel as input_json deltas.
    const streaming = status === 'pending' && !this.input.executingToolIds.has(block.id) && !this.awaitingTools.has(block.id)
    const input = streaming ? undefined : card?.input ?? block.input
    return {
      id: toolItemId(block.id),
      type: 'tool_call',
      status,
      tool: describeTool(card?.name ?? block.name),
      ...(input === undefined ? {} : { input }),
      ...(card?.status === 'completed' ? { output: this.toolOutput(card) } : {}),
      ...(card?.backgroundTask === undefined ? {} : { task_id: derivedId('task', card.backgroundTask.taskId) }),
      ...(card?.modelCalls?.length ? { model_calls: card.modelCalls.map(modelCall) } : {}),
      ...(card?.durationMs === undefined ? {} : { duration_ms: card.durationMs }),
    }
  }

  private subagentItem(block: Extract<ThreadBlock, { type: 'tool_use' }>, message: ThreadMessage, runActive: boolean): Item {
    const card = block.tool
    const input = record(card?.input ?? block.input)
    const nested = message.nestedAgents?.find((agent) => agent.parentToolUseId === block.id)
    const background = input['run_in_background'] === true || card?.launchStatus === 'async_launched' || card?.backgroundTask !== undefined
    const thread = threadId(block.id)
    const status = subagentStatus(card, nested, background, runActive)
    if (nested !== undefined) this.threads.set(thread, this.threadRuns(nested, block, thread, message.createdAt))
    const name = stringValue(input['subagent_type']) ?? nested?.name ?? 'agent'
    const description = stringValue(input['description'])
    return {
      id: toolItemId(block.id),
      type: 'subagent',
      status,
      agent: { name, ...(description === undefined ? {} : { description }) },
      thread_id: thread,
      mode: background ? 'background' : 'foreground',
      input: { prompt: stringValue(input['prompt']) ?? '' },
      ...(card?.status === 'completed' && card.launchStatus !== 'async_launched' ? { output: this.toolOutput(card) } : {}),
      ...(card?.backgroundTask === undefined ? {} : { task_id: derivedId('task', card.backgroundTask.taskId) }),
      ...(card?.durationMs === undefined ? {} : { duration_ms: card.durationMs }),
    }
  }

  private threadRuns(agent: ThreadNestedAgent, block: Extract<ThreadBlock, { type: 'tool_use' }>, thread: string, createdAt: string): ProjectedRun[] {
    const prompt = stringValue(record(block.tool?.input ?? block.input)['prompt']) ?? ''
    const boundaries = [...agent.inbox].sort((left, right) => (left.afterBlockCount ?? 0) - (right.afterBlockCount ?? 0))
    const blocks = [...agent.blocks].sort((left, right) => left.index - right.index)
    const groups: { key: string; input: RunInput; blocks: ThreadBlock[] }[] = [{
      key: `agent:${block.id}`,
      input: { type: 'agent_task', item_id: toolItemId(block.id), prompt },
      blocks: [],
    }]
    let next = 0
    for (const [position, item] of blocks.entries()) {
      while (next < boundaries.length && (boundaries[next]?.afterBlockCount ?? 0) <= position) {
        const inbox = boundaries[next]
        if (inbox !== undefined) groups.push({
          key: `agent:${block.id}:inbox:${inbox.deliveryId ?? String(next)}`,
          input: { type: 'inbox_message', from: { kind: inbox.source, ...(inbox.senderName === undefined ? {} : { name: inbox.senderName }) },
            content: [{ type: 'text', text: inbox.body }] },
          blocks: [],
        })
        next += 1
      }
      groups.at(-1)?.blocks.push(item)
    }
    for (const inbox of boundaries.slice(next)) {
      groups.push({ key: `agent:${block.id}:inbox:${inbox.deliveryId ?? String(next++)}`,
        input: { type: 'inbox_message', from: { kind: inbox.source, ...(inbox.senderName === undefined ? {} : { name: inbox.senderName }) },
          content: [{ type: 'text', text: inbox.body }] }, blocks: [] })
    }
    return groups.map((group, index) => {
      const id = derivedId('run', group.key)
      const lastGroup = index === groups.length - 1
      const status: Run['status'] = !lastGroup ? 'completed'
        : agent.status === 'running' ? 'in_progress' : agent.status
      const owner: ThreadMessage = { id: thread, role: 'assistant', content: '', createdAt, status: 'complete' }
      const items = group.blocks.flatMap((child, position) => {
        const item = this.blockItem(child, owner, id, status === 'in_progress' && position === group.blocks.length - 1, status === 'in_progress')
        return item === undefined ? [] : [item]
      })
      const output = status === 'in_progress' ? undefined : outputText(items)
      const run: Run = {
        id,
        thread_id: thread,
        status,
        input: group.input,
        ...(status === 'in_progress' ? {} : { stop_reason: status === 'failed' ? 'error' : status === 'cancelled' ? 'cancelled' : 'end_turn' }),
        ...(output === undefined ? {} : { output_text: output }),
        ...(status === 'failed' ? { error: { code: 'agent_failed', message: 'The subagent failed' } } : {}),
        created_at: createdAt,
      }
      return { run, items }
    })
  }

  private toolOutput(card: ThreadToolCard): { content: ContentBlock[]; is_error: boolean } {
    const artifacts = (card.artifacts ?? []).map((artifact): ContentBlock => artifact.mimeType.startsWith('image/')
      ? { type: 'image', image_path: this.input.relativePath(artifact.path), media_type: artifact.mimeType }
      : { type: 'file', file_path: this.input.relativePath(artifact.path), name: artifact.path.split(/[\\/]/u).at(-1) ?? artifact.path, media_type: artifact.mimeType, size: 0 })
    const text = card.output ?? ''
    return {
      content: [...artifacts, ...(text === '' ? [] : [{ type: 'text' as const, text }])],
      is_error: card.ok === false,
    }
  }
}

function toolStatus(card: ThreadToolCard | undefined, id: string, runActive: boolean, executing: ReadonlySet<string>,
  awaiting: ReadonlySet<string>, denied: ReadonlySet<string>): Extract<Item, { type: 'tool_call' }>['status'] {
  if (card?.status === 'completed') {
    if (card.ok !== false) return 'completed'
    return denied.has(id) ? 'declined' : 'failed'
  }
  if (!runActive) return 'cancelled'
  if (awaiting.has(id)) return 'pending'
  return card?.status === 'running' || executing.has(id) ? 'running' : 'pending'
}

function subagentStatus(card: ThreadToolCard | undefined, nested: ThreadNestedAgent | undefined, background: boolean, runActive: boolean): Extract<Item, { type: 'subagent' }>['status'] {
  if (nested !== undefined && nested.status !== 'running') return nested.status
  if (!background && card?.status === 'completed') return card.ok === false ? 'failed' : 'completed'
  if (background && card?.backgroundTask !== undefined) {
    const status = card.backgroundTask.status
    if (status === 'completed' || status === 'failed' || status === 'cancelled') return status
    return 'running'
  }
  return runActive || background ? 'running' : 'cancelled'
}

function outputText(items: readonly Item[]): string | undefined {
  for (const item of [...items].reverse()) {
    if (item.type !== 'message') continue
    const text = item.content.flatMap((block) => block.type === 'text' ? [block.text] : []).join('\n')
    if (text.trim() !== '') return text
  }
  return undefined
}

function compactionItem(message: ThreadMessage, trigger: 'auto' | 'manual'): Item {
  const phase = message.compact?.phase ?? 'queued'
  const status = phase === 'compacted' ? 'completed' : phase === 'failed' ? 'failed' : phase === 'cancelled' ? 'cancelled' : 'in_progress'
  const summary = message.compact?.summary
  return { id: derivedId('itm', `compact:${message.renderId ?? message.id}`), type: 'compaction', status, trigger,
    ...(summary === undefined ? {} : { summary }) }
}

function modelCall(call: ModelInvocation): NonNullable<Extract<Item, { type: 'tool_call' }>['model_calls']>[number] {
  return {
    operation: call.operation === 'generateImages' ? 'generate_images' : 'classify',
    model: call.model,
    status: call.status === 'aborted' ? 'cancelled' : call.status,
    ...(call.durationMs === undefined ? {} : { duration_ms: call.durationMs }),
    ...(call.usage === undefined ? {} : { usage: {
      input_tokens: call.usage.input, output_tokens: call.usage.output,
      ...(call.usage.cacheRead === undefined ? {} : { cache_read_tokens: call.usage.cacheRead }),
      ...(call.usage.cacheWrite === undefined ? {} : { cache_write_tokens: call.usage.cacheWrite }),
      ...(call.costUsd === undefined ? {} : { cost_usd: call.costUsd }),
    } }),
    ...(call.error === undefined ? {} : { error: call.error }),
  }
}

export function toolItemId(toolUseId: string): string {
  return derivedId('itm', `tool:${toolUseId}`)
}

export function threadId(parentToolUseId: string): string {
  return derivedId('thr', parentToolUseId)
}

export function blockItemId(blockId: string): string {
  return derivedId('itm', blockId)
}

function record(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() !== '' ? value : undefined
}
