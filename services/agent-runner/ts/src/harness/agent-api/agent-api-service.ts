import { createHash, randomUUID } from 'node:crypto'
import { isAbsolute } from 'node:path'

import { AgentApiError } from '../../core/agent-api/errors.js'
import type { AgentApiEvent } from '../../core/agent-api/events.js'
import { newSessionMemory } from '../../core/agent-api/graph-diff.js'
import { derivedId, newId } from '../../core/agent-api/ids.js'
import type { CreateSessionBody, SendMessageBody, SettingsPatch } from '../../core/agent-api/input.js'
import type { RunWithItems, Session, SessionSettings, SessionSnapshot } from '../../core/agent-api/objects.js'
import type { Capabilities, FileUploaded, MessageAccepted } from '../../core/agent-api/responses.js'
import type { ObjectGraph, ProjectedRun } from '../../core/agent-api/thread-projection.js'
import type { AgentApiEventStore } from '../../core/contract/agent-api-event-store.js'
import type { AgentApiSessionRecord, AgentApiSessionRegistry } from '../../core/contract/agent-api-session-registry.js'
import type { AgentApiWorkspace } from '../../core/contract/agent-api-workspace.js'
import {
  isClaudeEffortLevel,
  type AgentProvider,
  type ProviderId,
  type ProviderRunSpec,
  type SessionRef,
  type SessionTarget,
} from '../../core/contract/agent-provider.js'
import { DEFAULT_CONTEXT_WINDOW } from '../../core/resource/model-context.js'
import { ModelProfileError, splitModelContext } from '../../core/resource/model-profile.js'
import { SessionError, sessionRefKey, type ProviderSessionInfo } from '../../core/resource/session.js'
import type { AgentHarness } from '../agent-harness.js'
import type { AgentProfileService } from '../config/agent-profile-service.js'
import type { ModelProfileService } from '../config/model-profile-service.js'
import { buildRunSpec } from '../config/run-spec.js'
import type { LiveRun } from '../run/live-run.js'
import type { SessionService } from '../session/session-service.js'
import type { SessionStream } from '../session/session-stream.js'
import { subscribeEvents, type EventSubscription, type SubscriptionOptions } from './event-subscription.js'
import { prepareMessage } from './message-input.js'
import { currentRun, MAX_WAIT_MS, waitForRun, type RunWait } from './run-wait.js'
import { SessionProjector } from './session-projector.js'
import { declineUnattended } from './unattended-interactions.js'

/** What a send executes; how the response is delivered is the transport's concern. */
export type MessageInput = Pick<SendMessageBody, 'message' | 'delivery' | 'allow_interrupt'>

export const MAX_INLINE_BYTES = 20 * 1024 * 1024
export const MAX_QUEUED_RUNS = 3
const DEFAULT_HARNESS: ProviderId = 'claude'
const PAGE_SIZE = 20
const IDEMPOTENCY_WINDOW_MS = 24 * 60 * 60 * 1000

export interface AgentApiServiceOptions {
  readonly providers: Readonly<Record<ProviderId, AgentProvider>>
  readonly harness: AgentHarness
  readonly sessions: SessionService
  readonly registry: AgentApiSessionRegistry
  readonly events: AgentApiEventStore
  readonly workspace: AgentApiWorkspace
  readonly modelProfiles: ModelProfileService
  readonly agentProfiles: AgentProfileService
  /** Projection failures happen outside any request; they must still be visible to operators. */
  readonly reportError: (error: unknown) => void
  /** Longest `response = wait` / `GET …/runs/{run}?wait`; defaults to `MAX_WAIT_MS`. */
  readonly maxWaitMs?: number
}

/** A registered session, or a WebUI session addressed by its derived ID before the API writes to it. */
interface ResolvedSession {
  readonly record: AgentApiSessionRecord
  readonly registered: boolean
  readonly native: ProviderSessionInfo | undefined
}

/** Transport-independent facade for Agent API v1. */
export class AgentApiService {
  private readonly projectors = new Map<string, Promise<SessionProjector>>()
  private readonly loaded = new Map<string, SessionProjector>()
  private readonly attachments = new Map<string, Promise<void>>()
  private readonly declines = new Map<string, () => void>()

  constructor(private readonly options: AgentApiServiceOptions) {}

  get maxUploadBytes(): number {
    return this.options.workspace.maxUploadBytes
  }

  private get maxWaitMs(): number {
    return this.options.maxWaitMs ?? MAX_WAIT_MS
  }

  async capabilities(): Promise<Capabilities> {
    const listed = await this.options.modelProfiles.listProfiles()
    const defaultProfile = listed.profiles.find((profile) => profile.id === listed.defaultProfileId)
    return {
      api_version: 'v1',
      harnesses: ['claude', 'pi'],
      defaults: {
        harness: DEFAULT_HARNESS,
        model: defaultProfile?.defaultModel ? `${defaultProfile.id}:${defaultProfile.defaultModel}` : null,
      },
      profiles: listed.profiles.map((profile) => ({
        id: profile.id,
        label: profile.label,
        default_model: profile.defaultModel,
        image_input_models: [...profile.modelCapabilities.imageUnderstanding],
      })),
      limits: {
        max_upload_bytes: this.options.workspace.maxUploadBytes,
        max_inline_bytes: MAX_INLINE_BYTES,
        max_queued_runs: MAX_QUEUED_RUNS,
        max_wait_seconds: Math.ceil(this.maxWaitMs / 1000),
      },
      // Delivery modes other than an idle send, cancellation and interactions arrive in later layers.
      features: { websocket: false, native_events: false, interactions: false, task_stop: false, settings_update: false, deliveries: [] },
    }
  }

  async createSession(body: CreateSessionBody): Promise<AgentApiSessionRecord> {
    const harness = body.harness ?? DEFAULT_HARNESS
    const workdir = await this.options.workspace.resolveWorkdir(body.workdir ?? '')
    const settings = await this.resolveSettings(harness, undefined, body.settings, 'settings')
    const now = new Date().toISOString()
    // Claude sessions get their native UUID now, like a new WebUI chat; Pi assigns one on first open.
    const record: AgentApiSessionRecord = {
      id: newId('ses'),
      harness,
      workdir: workdir.relative,
      // Run modes are a Claude concept; Pi sessions ignore the field.
      ...(harness === 'claude' ? { runMode: body.run_mode ?? 'agent' } : {}),
      nativeId: harness === 'claude' ? randomUUID() : null,
      settings,
      createdAt: now,
      updatedAt: now,
    }
    await this.options.registry.create(record)
    // Everything this session does from now on is reported as events.
    await this.options.events.saveState(record.id, { runs: [], memory: newSessionMemory() })
    return record
  }

  async listSessions(cursor: string | undefined, limit = PAGE_SIZE): Promise<{ data: Session[]; next_cursor: string | null }> {
    const records = await this.options.registry.list()
    const registeredNative = new Set(records.flatMap((record) => record.nativeId === null ? [] : [`${record.harness}:${record.nativeId}`]))
    const resolved: ResolvedSession[] = await Promise.all(records.map(async (record) => ({ record, registered: true, native: await this.nativeInfo(record) })))
    for (const harness of ['claude', 'pi'] as const) {
      for (const info of await this.options.providers[harness].sessions.list({})) {
        if (registeredNative.has(`${harness}:${info.ref.id}`)) continue
        const record = await this.adoptable(info)
        if (record !== undefined) resolved.push({ record, registered: false, native: info })
      }
    }
    resolved.sort((left, right) => updatedAt(right).localeCompare(updatedAt(left)) || right.record.id.localeCompare(left.record.id))
    const offset = decodeCursor(cursor)
    return {
      data: await Promise.all(resolved.slice(offset, offset + limit).map((session) => this.view(session))),
      next_cursor: offset + limit < resolved.length ? encodeCursor(offset + limit) : null,
    }
  }

  async session(id: string): Promise<Session> {
    return this.view(await this.resolve(id))
  }

  async snapshot(id: string): Promise<SessionSnapshot> {
    const resolved = await this.resolve(id)
    const projector = await this.projector(resolved.record)
    const session = await this.view(resolved)
    const { graph } = projector.current()
    return {
      ...session,
      active_run: [...graph.runs].reverse().find(({ run }) => run.status === 'in_progress')?.run ?? null,
      queued_runs: graph.runs.filter(({ run }) => run.status === 'queued').map(({ run }) => run),
      interactions: graph.interactions.filter((interaction) => interaction.status === 'pending'),
      tasks: [...graph.tasks],
    }
  }

  async runs(id: string, query: {
    readonly thread?: 'all' | 'main' | undefined
    readonly order?: 'asc' | 'desc' | undefined
    readonly limit?: number | undefined
    readonly cursor?: string | undefined
  }): Promise<{ data: RunWithItems[]; next_cursor: string | null }> {
    const { graph } = (await this.projector((await this.resolve(id)).record)).current()
    const ordered = chronological(graph, query.thread ?? 'all')
    if ((query.order ?? 'desc') === 'desc') ordered.reverse()
    const offset = decodeCursor(query.cursor)
    const limit = query.limit ?? PAGE_SIZE
    return {
      data: ordered.slice(offset, offset + limit).map(({ run, items }) => ({ ...run, items: [...items] })),
      next_cursor: offset + limit < ordered.length ? encodeCursor(offset + limit) : null,
    }
  }

  /** The run and its pending interactions; with `wait`, once it settles or the wait limit passes. */
  async runResult(id: string, runId: string, options: { readonly wait?: boolean; readonly signal?: AbortSignal } = {}): Promise<RunWait> {
    const projector = await this.projector((await this.resolve(id)).record)
    return options.wait === true
      ? await waitForRun(projector, runId, { timeoutMs: this.maxWaitMs, signal: options.signal })
      : currentRun(projector, runId)
  }

  async deleteSession(id: string): Promise<void> {
    const { record, native } = await this.resolve(id)
    const ref = nativeRef(record)
    if (ref !== undefined && native !== undefined) {
      const activity = await this.options.harness.sessionActivity(ref)
      if (activity.running || activity.driver === 'terminal') throw new AgentApiError('session_busy', 'The session is in use; stop it before deleting')
      await this.options.sessions.delete(record.harness, ref.id)
    }
    const projector = this.loaded.get(record.id)
    this.loaded.delete(record.id)
    this.projectors.delete(record.id)
    this.declines.get(record.id)?.()
    this.declines.delete(record.id)
    await projector?.dispose()
    await this.options.registry.delete(record.id)
  }

  async uploadFile(id: string, fileName: string, content: AsyncIterable<Uint8Array>): Promise<FileUploaded> {
    const { record } = await this.resolve(id)
    const cwd = await this.cwd(record)
    const file = await this.options.workspace.upload(cwd, fileName, content)
    return {
      id: derivedId('file', file.path),
      path: this.options.workspace.relativePath(cwd, file.path),
      name: file.name,
      media_type: file.mimeType,
      size: file.size,
    }
  }

  /**
   * Start a run on an idle session; its events go to the session's event log.
   * `replayed` marks the stored result of an earlier request with the same Idempotency-Key.
   */
  async sendMessage(id: string, input: MessageInput, idempotencyKey: string | undefined): Promise<{ accepted: MessageAccepted; replayed: boolean }> {
    const resolved = await this.resolve(id)
    if (!resolved.registered) await this.options.registry.create(resolved.record)
    const record = resolved.record
    const projector = await this.projector(record)
    const requestHash = createHash('sha256').update(JSON.stringify(input)).digest('hex')
    if (idempotencyKey !== undefined) {
      const earliest = new Date(Date.now() - IDEMPOTENCY_WINDOW_MS).toISOString()
      const prior = projector.runRecords().find((run) => run.idempotency?.key === idempotencyKey && (run.createdAt ?? '') >= earliest)
      if (prior?.idempotency !== undefined) {
        if (prior.idempotency.requestHash !== requestHash) {
          throw new AgentApiError('idempotency_conflict', 'This Idempotency-Key was used with a different request')
        }
        const { accepted } = prior.idempotency
        return {
          accepted: { message: { id: accepted.messageId }, run: { id: prior.id, status: accepted.status }, last_event_seq: accepted.lastEventSeq },
          replayed: true,
        }
      }
    }

    const ref = nativeRef(record)
    const activity = ref === undefined ? { driver: 'none' as const, running: false } : await this.options.harness.sessionActivity(ref)
    if (activity.driver === 'terminal') {
      throw new AgentApiError('session_driven_by_terminal', 'The session is driven by its terminal; send again after the terminal exits or is reclaimed')
    }
    if (activity.running || projector.current().status.state !== 'idle') {
      throw new AgentApiError('session_busy', 'The session is already running; wait for the current run to finish')
    }

    const cwd = await this.cwd(record)
    const prepared = await prepareMessage(input.message, {
      cwd, workspace: this.options.workspace, acceptsImages: await this.acceptsImages(record.settings.model),
      model: record.settings.model, maxInlineBytes: MAX_INLINE_BYTES, param: 'message',
    })
    const target = await this.target(record)
    const spec = await this.runSpec(record, cwd, target)
    const runId = newId('run')
    const messageId = newId('msg')
    const lastEventSeq = projector.lastSeq
    projector.launch({
      id: runId, harnessRunId: runId, text: prepared.turn.text, messageId, source: 'api', content: prepared.content,
      createdAt: new Date().toISOString(),
      ...(input.allow_interrupt === true ? { allowInterrupt: true } : {}),
      ...(idempotencyKey === undefined ? {} : { idempotency: { key: idempotencyKey, requestHash, accepted: { messageId, status: 'in_progress', lastEventSeq } } }),
    })
    let live: LiveRun
    try {
      live = await this.options.harness.launch(prepared.turn, spec, { source: 'api', runId, session: target })
    } catch (error) {
      projector.rejected(runId, { code: 'runtime_start_failed', message: error instanceof Error ? error.message : String(error) })
      if (error instanceof SessionError && error.kind === 'session-busy') throw new AgentApiError('session_busy', error.message)
      throw new AgentApiError('runtime_start_failed', error instanceof Error ? error.message : String(error), { cause: error })
    }
    if (ref === undefined) this.bindNativeOnStart(record, live, projector)
    await this.options.registry.update(record.id, { updatedAt: new Date().toISOString() })
    return { accepted: { message: { id: messageId }, run: { id: runId, status: 'in_progress' }, last_event_seq: lastEventSeq }, replayed: false }
  }

  async subscribe(id: string, options: SubscriptionOptions, deliver: (event: AgentApiEvent) => void): Promise<EventSubscription> {
    const projector = await this.projector((await this.resolve(id)).record)
    return subscribeEvents(projector, options, deliver)
  }

  async resolve(id: string): Promise<ResolvedSession> {
    const record = await this.options.registry.get(id)
    if (record !== undefined) return { record, registered: true, native: await this.nativeInfo(record) }
    for (const harness of ['claude', 'pi'] as const) {
      for (const info of await this.options.providers[harness].sessions.list({})) {
        if (nativeSessionId(info.ref) !== id) continue
        const adopted = await this.adoptable(info)
        if (adopted !== undefined) return { record: adopted, registered: false, native: info }
      }
    }
    throw new AgentApiError('not_found', `Session ${id} not found`)
  }

  async dispose(): Promise<void> {
    const projectors = [...this.loaded.values()]
    this.loaded.clear()
    this.projectors.clear()
    for (const stop of this.declines.values()) stop()
    this.declines.clear()
    await Promise.all(projectors.map((projector) => projector.dispose()))
  }

  /** Validate a settings patch over `current`, filling unset values from the user's defaults. */
  async resolveSettings(harness: ProviderId, current: SessionSettings | undefined, patch: SettingsPatch | undefined, param: string): Promise<SessionSettings> {
    const model = patch?.model ?? current?.model ?? await this.defaultModel(param)
    try {
      await this.options.modelProfiles.resolve(model)
    } catch (error) {
      if (error instanceof ModelProfileError) {
        throw new AgentApiError('validation_failed', `Model ${model} is not usable: ${error.message}`, { param: `${param}.model` })
      }
      throw error
    }
    const effort = patch?.effort ?? current?.effort
    if (harness === 'claude' && effort !== undefined && !isClaudeEffortLevel(effort)) {
      throw new AgentApiError('validation_failed', 'Claude effort must be low, medium, high, xhigh, or max', { param: `${param}.effort` })
    }
    return {
      model,
      ...(effort === undefined ? {} : { effort }),
      context_window: patch?.context_window ?? current?.context_window ?? DEFAULT_CONTEXT_WINDOW,
    }
  }

  private async view({ record, native, registered }: ResolvedSession): Promise<Session> {
    const ref = nativeRef(record)
    const activity = ref === undefined ? { driver: 'none' as const, running: false } : await this.options.harness.sessionActivity(ref)
    const projector = this.loaded.get(record.id)
    const status = projector?.current().status ?? { state: activity.running ? 'running' as const : 'idle' as const, active_tasks: 0 }
    const lastEventSeq = projector?.lastSeq ?? (registered ? (await this.options.events.openLog(record.id)).lastSeq : 0)
    const lastModified = native === undefined ? undefined : new Date(native.lastModified).toISOString()
    return {
      id: record.id,
      harness: record.harness,
      workdir: record.workdir,
      ...(record.runMode === undefined ? {} : { run_mode: record.runMode }),
      title: native === undefined ? null : native.customTitle ?? (native.summary === '' ? null : native.summary),
      settings: record.settings,
      status,
      driver: activity.driver,
      last_event_seq: lastEventSeq,
      created_at: record.createdAt,
      updated_at: lastModified !== undefined && lastModified > record.updatedAt ? lastModified : record.updatedAt,
    }
  }

  /** One projector per platform session, kept for the life of the runner so execution never depends on a subscriber. */
  private async projector(record: AgentApiSessionRecord): Promise<SessionProjector> {
    let pending = this.projectors.get(record.id)
    if (pending === undefined) {
      pending = this.createProjector(record)
      this.projectors.set(record.id, pending)
      pending.catch(() => this.projectors.delete(record.id))
    }
    const projector = await pending
    await this.attach(record, projector)
    return projector
  }

  private async createProjector(record: AgentApiSessionRecord): Promise<SessionProjector> {
    const [log, state, cwd] = await Promise.all([
      this.options.events.openLog(record.id), this.options.events.loadState(record.id), this.cwd(record),
    ])
    const projector = new SessionProjector({
      sessionId: record.id,
      log,
      state,
      save: (next) => this.options.events.saveState(record.id, next),
      relativePath: (path) => isAbsolute(path) ? this.options.workspace.relativePath(cwd, path) : path,
      onError: this.options.reportError,
    })
    this.loaded.set(record.id, projector)
    return projector
  }

  private attach(record: AgentApiSessionRecord, projector: SessionProjector): Promise<void> {
    const ref = nativeRef(record)
    if (ref === undefined) return Promise.resolve()
    const key = `${record.id}|${sessionRefKey(ref)}`
    let attaching = this.attachments.get(key)
    if (attaching === undefined) {
      attaching = (async () => {
        const stream = this.options.harness.loadedSessionStream(ref)
          ?? (await this.nativeExists(ref) ? await this.options.harness.loadSessionStream(ref) : this.options.harness.sessionStream(ref))
        this.follow(record, projector, stream)
      })()
      this.attachments.set(key, attaching)
      attaching.catch(() => this.attachments.delete(key))
    }
    return attaching
  }

  /** Project the stream, and decline the interactions of its runs that nobody waits to answer. */
  private follow(record: AgentApiSessionRecord, projector: SessionProjector, stream: SessionStream): void {
    projector.attach(stream)
    this.declines.get(record.id)?.()
    this.declines.set(record.id, declineUnattended({
      stream,
      projector,
      drivenByApi: async () => await this.options.registry.get(record.id) !== undefined
        && (await this.options.harness.sessionActivity(stream.session)).driver === 'sdk',
      respond: (response) => { this.options.harness.respondPermission(stream.session, response) },
      onError: this.options.reportError,
    }))
  }

  /**
   * Pi chooses its session ID when the first run opens the session. The
   * harness creates that stream while publishing the first frame; attaching
   * synchronously here observes every later frame of the run.
   */
  private bindNativeOnStart(record: AgentApiSessionRecord, live: LiveRun, projector: SessionProjector): void {
    let bound = false
    const bind = (nativeId: string | null | undefined): void => {
      if (bound || nativeId === null || nativeId === undefined || nativeId === '') return
      bound = true
      live.unsubscribe(listener)
      const ref: SessionRef = { provider: record.harness, id: nativeId }
      this.attachments.set(`${record.id}|${sessionRefKey(ref)}`, Promise.resolve())
      this.follow(record, projector, this.options.harness.sessionStream(ref))
      void this.options.registry.update(record.id, { nativeId }).catch(this.options.reportError)
    }
    const listener = (frame: { readonly sessionId?: string }): void => { bind(frame.sessionId ?? live.sessionId) }
    live.subscribe(listener)
    bind(live.sessionId)
  }

  private async target(record: AgentApiSessionRecord): Promise<SessionTarget> {
    const ref = nativeRef(record)
    if (ref === undefined) return { kind: 'new', provider: record.harness }
    if (await this.nativeExists(ref)) return { kind: 'resume', session: ref }
    return { kind: 'new', provider: record.harness, sessionId: ref.id }
  }

  private async runSpec(record: AgentApiSessionRecord, cwd: string, target: SessionTarget): Promise<ProviderRunSpec> {
    // API sessions never use the WebUI-only answer visualizations or prompt suggestions (§6.3).
    return buildRunSpec({ modelProfileService: this.options.modelProfiles, agentProfileService: this.options.agentProfiles }, {
      harness: record.harness,
      model: record.settings.model,
      cwd,
      contextWindow: record.settings.context_window,
      promptSuggestions: false,
      visualizeMode: false,
      ...(record.settings.effort === undefined ? {} : { effort: record.settings.effort }),
      ...(target.kind === 'new' && record.harness === 'claude' ? { runMode: record.runMode ?? 'agent' } : {}),
    })
  }

  /** Same rule as the WebUI composer: the profile lists the model under image understanding. */
  private async acceptsImages(model: string): Promise<boolean> {
    const resolved = await this.options.modelProfiles.resolve(model)
    return resolved.profile.modelCapabilities.imageUnderstanding.includes(resolved.modelId)
  }

  private async nativeExists(ref: SessionRef): Promise<boolean> {
    try {
      await this.options.providers[ref.provider].sessions.read(ref)
      return true
    } catch (error) {
      if (error instanceof SessionError && error.kind === 'session-not-found') return false
      throw error
    }
  }

  private async nativeInfo(record: AgentApiSessionRecord): Promise<ProviderSessionInfo | undefined> {
    const ref = nativeRef(record)
    if (ref === undefined) return undefined
    try {
      return await this.options.providers[ref.provider].sessions.read(ref)
    } catch (error) {
      if (error instanceof SessionError && error.kind === 'session-not-found') return undefined
      throw error
    }
  }

  /** A native session the API can address: its cwd must lie inside the Sandbox workspace. */
  private async adoptable(info: ProviderSessionInfo): Promise<AgentApiSessionRecord | undefined> {
    if (info.cwd === null || info.cwd === '') return undefined
    const workdir = await this.options.workspace.workdirOf(info.cwd)
    if (workdir === undefined) return undefined
    const configured = await this.options.sessions.configuration(info.ref)
    const modelId = configured === undefined ? undefined : splitModelContext(configured.model).modelId ?? configured.model
    const model = modelId === undefined ? undefined : configured?.profileId === undefined ? modelId : `${configured.profileId}:${modelId}`
    const settings = await this.resolveSettings(info.ref.provider, undefined, {
      ...(model === undefined ? {} : { model }),
      ...(configured?.effort === undefined ? {} : { effort: configured.effort }),
      ...(configured === undefined ? {} : { context_window: configured.contextWindow }),
    }, 'settings').catch(() => undefined)
    if (settings === undefined) return undefined
    const at = new Date(info.lastModified).toISOString()
    const runMode = info.ref.provider === 'claude' ? await this.options.sessions.runModes.get(info.ref) : undefined
    return { id: nativeSessionId(info.ref), harness: info.ref.provider, workdir, ...(runMode === undefined ? {} : { runMode }),
      nativeId: info.ref.id, settings, createdAt: at, updatedAt: at }
  }

  private async defaultModel(param: string): Promise<string> {
    const listed = await this.options.modelProfiles.listProfiles()
    const profile = listed.profiles.find((candidate) => candidate.id === listed.defaultProfileId)
    if (profile?.defaultModel) return `${profile.id}:${profile.defaultModel}`
    throw new AgentApiError('validation_failed', 'No default model is configured; pass settings.model', { param: `${param}.model` })
  }

  private async cwd(record: AgentApiSessionRecord): Promise<string> {
    return (await this.options.workspace.resolveWorkdir(record.workdir)).absolute
  }
}

export function nativeRef(record: AgentApiSessionRecord): SessionRef | undefined {
  return record.nativeId === null ? undefined : { provider: record.harness, id: record.nativeId }
}

/** WebUI sessions get a stable platform ID derived from their native identity. */
export function nativeSessionId(ref: SessionRef): string {
  return derivedId('ses', `${ref.provider}:${ref.id}`)
}

/** Main-thread runs in order, each followed by the runs of the subagent threads it started. */
function chronological(graph: ObjectGraph, threads: 'all' | 'main'): ProjectedRun[] {
  const ordered: ProjectedRun[] = []
  const visited = new Set<string>()
  const visit = (projected: ProjectedRun): void => {
    ordered.push(projected)
    if (threads === 'main') return
    for (const item of projected.items) {
      if (item.type !== 'subagent' || visited.has(item.thread_id)) continue
      visited.add(item.thread_id)
      for (const child of graph.threads.get(item.thread_id) ?? []) visit(child)
    }
  }
  for (const projected of graph.runs) visit(projected)
  if (threads === 'all') for (const [thread, runs] of graph.threads) if (!visited.has(thread)) ordered.push(...runs)
  return ordered
}

function updatedAt(session: ResolvedSession): string {
  const native = session.native === undefined ? '' : new Date(session.native.lastModified).toISOString()
  return native > session.record.updatedAt ? native : session.record.updatedAt
}

function encodeCursor(offset: number): string {
  return Buffer.from(JSON.stringify({ offset })).toString('base64url')
}

function decodeCursor(cursor: string | undefined): number {
  if (cursor === undefined) return 0
  try {
    const parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as unknown
    if (typeof parsed === 'object' && parsed !== null && 'offset' in parsed && Number.isInteger(parsed.offset) && Number(parsed.offset) >= 0) {
      return Number(parsed.offset)
    }
  } catch {
    // Reported below as an invalid cursor.
  }
  throw new AgentApiError('validation_failed', 'cursor is invalid', { param: 'cursor' })
}
