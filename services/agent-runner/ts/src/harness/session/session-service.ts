import { realpath, stat } from 'node:fs/promises'

import type { AgentProvider, ProviderId, SessionRef } from '../../core/contract/agent-provider.js'
import type { SessionMetadataRepository } from '../../core/contract/session-metadata-repository.js'
import {
  DEFAULT_SESSION_LIST_LIMIT,
  MAX_SESSION_TAGS,
  normalizeSessionTags,
  resolveListedResponseModel,
  SessionError,
  SESSION_GROUP_PAGE_SIZE,
  sessionRefKey,
  tagColorsFor,
  uniqueProfileIdByModel,
  type ProviderSessionInfo,
  type RunMode,
  type SessionMessage,
  type SessionMetadataRecord,
  type SessionResponseModel,
} from '../../core/resource/session.js'
import { foldThread } from '../../core/resource/fold-thread.js'
import type { ThreadMessage } from '../../core/resource/thread.js'
import type { ModelProfileService } from '../config/model-profile-service.js'
import type { LiveRunRecord, LiveRunRegistry } from '../run/live-run-registry.js'
import { nextForkTitle, sessionStem } from './fork-session-title.js'

export interface SessionServiceOptions {
  readonly providers: Readonly<Record<ProviderId, AgentProvider>>
  readonly metadata: SessionMetadataRepository
  readonly liveRuns: LiveRunRegistry
  readonly modelProfiles: ModelProfileService
  readonly activeCwd: string
}

export interface SessionListQuery {
  readonly harness: ProviderId
  readonly cwd?: string
  readonly archived?: boolean
  readonly limit?: number
  readonly offset?: number
}

export interface SessionView {
  readonly sessionId: string
  readonly summary: string
  readonly lastModified: number
  readonly fileSize: number
  readonly customTitle: string | null
  readonly firstPrompt: string | null
  readonly gitBranch: string | null
  readonly cwd: string | null
  readonly sessionSource: 'project'
  readonly tag: string | null
  readonly tags: readonly string[]
  readonly tagColors: Readonly<Record<string, number>>
  readonly pinned: boolean
  readonly archived: boolean
  readonly parentSessionId: null
  readonly parentMessageUuid: null
  readonly forkCount: 0
  readonly origin: null
  readonly schedulerJobName: null
  readonly lastResponseModel: SessionResponseModel | null
  readonly runMode: RunMode
}

export interface SessionGroupView {
  readonly cwd: string
  readonly pinned: false
  readonly sessions: readonly SessionView[]
  readonly hasMore: boolean
}

export type SessionListResult =
  | { readonly kind: 'grouped'; readonly groups: readonly SessionGroupView[]; readonly activeCwd: string }
  | {
    readonly kind: 'flat'
    readonly cwd: string
    readonly sessions: readonly SessionView[]
    readonly total: number
    readonly limit: number
    readonly offset: number
  }
  | { readonly kind: 'archived'; readonly sessions: readonly SessionView[] }

export interface RunningSessionView {
  readonly sessionId: string | null
  readonly runId: string
  readonly status: 'running'
  readonly startedAt: number
  readonly lastSeq: number
  readonly firstSeq: number
  readonly firstUserUuid: null
  readonly pendingPermission: null
  readonly runMode: RunMode
  readonly harness: ProviderId
}

export interface SessionMessagesView {
  readonly messages: readonly SessionMessage[]
  readonly addDirs: readonly string[]
  readonly runMode: RunMode
  readonly liveRunId: string | null
  readonly liveSeq: number
  readonly liveFirstSeq: number
}

export interface SessionThreadView {
  readonly messages: readonly ThreadMessage[]
  readonly addDirs: readonly string[]
  readonly runMode: RunMode
  readonly liveRunId: string | null
}

export interface RecordRunCompletedInput {
  readonly profileId: string
  readonly modelId: string
  readonly context: '1m' | null
}

export class SessionService {
  constructor(private readonly options: SessionServiceOptions) {}

  async list(query: SessionListQuery): Promise<SessionListResult> {
    const provider = this.provider(query.harness)
    const listed = await provider.sessions.list(
      query.cwd === undefined ? {} : { cwd: query.cwd },
    )
    const views = await this.toViews(listed)
    const archived = query.archived === true
    const filtered = views.filter((session) => session.archived === archived)

    if (archived) {
      return {
        kind: 'archived',
        sessions: [...filtered].sort((left, right) => right.lastModified - left.lastModified),
      }
    }

    if (query.cwd !== undefined) {
      const limit = query.limit ?? DEFAULT_SESSION_LIST_LIMIT
      const offset = query.offset ?? 0
      const sorted = [...filtered].sort(compareSessions)
      return {
        kind: 'flat',
        cwd: query.cwd,
        sessions: sorted.slice(offset, offset + limit),
        total: sorted.length,
        limit,
        offset,
      }
    }

    return {
      kind: 'grouped',
      groups: groupSessions(filtered, this.options.activeCwd),
      activeCwd: this.options.activeCwd,
    }
  }

  listRunning(harness: ProviderId): Promise<readonly RunningSessionView[]> {
    this.provider(harness)
    return Promise.resolve(this.options.liveRuns.listActive(harness).map((record) => ({
      sessionId: record.sessionId,
      runId: record.runId,
      status: 'running',
      startedAt: record.startedAt,
      lastSeq: record.lastSeq,
      firstSeq: record.firstSeq,
      firstUserUuid: null,
      pendingPermission: null,
      runMode: record.runMode,
      harness: record.provider,
    })))
  }

  async messages(
    harness: ProviderId,
    sessionId: string,
    page?: { readonly limit?: number; readonly offset?: number },
  ): Promise<SessionMessagesView> {
    const ref = this.ref(harness, sessionId)
    const provider = this.provider(harness)
    const [messages, metadata, live] = await Promise.all([
      provider.sessions.messages(ref, page),
      this.options.metadata.get(ref),
      Promise.resolve(this.options.liveRuns.liveForSession(ref)),
    ])
    return {
      messages,
      addDirs: metadata.addDirs,
      runMode: metadata.runMode ?? 'code',
      liveRunId: live?.runId ?? null,
      liveSeq: live?.lastSeq ?? 0,
      liveFirstSeq: live?.firstSeq ?? 0,
    }
  }

  async thread(
    harness: ProviderId,
    sessionId: string,
    page?: { readonly limit?: number; readonly offset?: number },
  ): Promise<SessionThreadView> {
    const ref = this.ref(harness, sessionId)
    const provider = this.provider(harness)
    const [items, metadata, live] = await Promise.all([
      provider.sessions.replay(ref, page),
      this.options.metadata.get(ref),
      Promise.resolve(this.options.liveRuns.liveForSession(ref)),
    ])
    return {
      messages: foldThread(items),
      addDirs: metadata.addDirs,
      runMode: metadata.runMode ?? 'code',
      liveRunId: live?.runId ?? null,
    }
  }

  async recap(harness: ProviderId, sessionId: string): Promise<{ recap: string | null; turns: number }> {
    const ref = this.ref(harness, sessionId)
    await this.provider(harness).sessions.read(ref)
    const metadata = await this.options.metadata.get(ref)
    return {
      recap: metadata.recap?.text ?? null,
      turns: metadata.recap?.turns ?? 0,
    }
  }

  async delete(harness: ProviderId, sessionId: string): Promise<void> {
    const ref = this.ref(harness, sessionId)
    const provider = this.provider(harness)
    await provider.sessions.read(ref)
    this.rejectIfLive(ref)
    await provider.sessions.delete(ref)
    await this.options.metadata.delete(ref)
  }

  async rename(harness: ProviderId, sessionId: string, title: string): Promise<void> {
    const trimmed = title.trim()
    if (trimmed === '') {
      throw new SessionError('invalid-request', 'Title must be a non-empty string')
    }
    const ref = this.ref(harness, sessionId)
    await this.provider(harness).sessions.rename(ref, trimmed)
  }

  async fork(
    harness: ProviderId,
    sessionId: string,
    input: { readonly stem: string; readonly upToMessageId?: string },
  ): Promise<SessionView> {
    const stem = input.stem.trim()
    if (stem === '') {
      throw new SessionError('invalid-request', 'Fork title stem must be a non-empty string')
    }
    const upToMessageId = input.upToMessageId?.trim()
    if (input.upToMessageId !== undefined && upToMessageId === '') {
      throw new SessionError('invalid-request', 'up_to_message_id must be a non-empty string')
    }
    const ref = this.ref(harness, sessionId)
    const provider = this.provider(harness)
    const source = await provider.sessions.read(ref)
    this.rejectIfLive(ref)
    const listed = await provider.sessions.list(
      source.cwd === null || source.cwd === '' ? {} : { cwd: source.cwd },
    )
    const title = nextForkTitle(stem, listed.map((session) => sessionStem(session)))
    const forked = await provider.sessions.fork(ref, {
      title,
      ...(upToMessageId === undefined ? {} : { upToMessageId }),
    })
    const [view] = await this.toViews([forked])
    if (view === undefined) {
      throw new SessionError('io-failure', 'Forked session could not be read')
    }
    return view
  }

  async setTags(
    harness: ProviderId,
    sessionId: string,
    raw: unknown,
  ): Promise<{ tags: readonly string[]; tagColors: Readonly<Record<string, number>> }> {
    const tags = normalizeSessionTags(raw)
    if (tags.length > MAX_SESSION_TAGS) {
      throw new SessionError('invalid-request', `Maximum ${MAX_SESSION_TAGS} tags per session`)
    }
    const ref = this.ref(harness, sessionId)
    const provider = this.provider(harness)
    await provider.sessions.tag(ref, tags[0] ?? null)
    const metadata = await this.options.metadata.upsert(ref, { tags })
    const colors = await this.options.metadata.tagColors(metadata.tags)
    return {
      tags: metadata.tags,
      tagColors: tagColorsFor(metadata.tags, colors),
    }
  }

  async setAddDirs(
    harness: ProviderId,
    sessionId: string,
    addDirs: readonly string[],
  ): Promise<readonly string[]> {
    const ref = this.ref(harness, sessionId)
    await this.provider(harness).sessions.read(ref)
    const normalized = await normalizeAddDirs(addDirs)
    const metadata = await this.options.metadata.upsert(ref, { addDirs: normalized })
    return metadata.addDirs
  }

  async setPinned(harness: ProviderId, sessionId: string, pinned: boolean): Promise<{
    pinned: boolean
    archived: boolean
  }> {
    return await this.setFlag(harness, sessionId, { pinned })
  }

  async setArchived(harness: ProviderId, sessionId: string, archived: boolean): Promise<{
    pinned: boolean
    archived: boolean
  }> {
    return await this.setFlag(harness, sessionId, { archived })
  }

  async recordRunCompleted(ref: SessionRef, input: RecordRunCompletedInput): Promise<void> {
    if (ref.id.trim() === '') return
    const current = await this.options.metadata.get(ref)
    await this.options.metadata.upsert(ref, {
      ...(current.runMode === null ? { runMode: 'agent' as const } : {}),
      lastResponseModel: {
        profileId: input.profileId,
        model: {
          id: input.modelId,
          capabilities: { context: input.context },
        },
        modelSource: 'profile',
        observedAt: Date.now(),
      },
    })
  }

  liveForSession(ref: SessionRef): LiveRunRecord | undefined {
    return this.options.liveRuns.liveForSession(ref)
  }

  private async setFlag(
    harness: ProviderId,
    sessionId: string,
    patch: { readonly pinned?: boolean; readonly archived?: boolean },
  ): Promise<{ pinned: boolean; archived: boolean }> {
    const ref = this.ref(harness, sessionId)
    await this.provider(harness).sessions.read(ref)
    if (patch.archived === true) this.rejectIfLive(ref)
    const metadata = await this.options.metadata.upsert(ref, patch)
    return metadata.flags
  }

  private rejectIfLive(ref: SessionRef): void {
    if (this.options.liveRuns.liveRunningForSession(ref) !== undefined) {
      throw new SessionError('session-busy', 'Session has a live run')
    }
  }

  private provider(harness: ProviderId): AgentProvider {
    return this.options.providers[harness]
  }

  private ref(harness: ProviderId, sessionId: string): SessionRef {
    if (sessionId.trim() === '') {
      throw new SessionError('invalid-request', 'session_id is required')
    }
    return { provider: harness, id: sessionId }
  }

  private async toViews(listed: readonly ProviderSessionInfo[]): Promise<SessionView[]> {
    const metadataByKey = await this.options.metadata.list(listed.map((info) => info.ref))
    const profiles = await this.options.modelProfiles.listProfiles()
    const profileByModel = uniqueProfileIdByModel(profiles.profiles)
    const views = await Promise.all(listed.map(async (info) => {
      const metadata = metadataByKey.get(sessionRefKey(info.ref))
      return await this.toView(info, metadata, profileByModel)
    }))
    const allTags = views.flatMap((view) => [...view.tags])
    const colors = await this.options.metadata.tagColors(allTags)
    return views.map((view) => ({
      ...view,
      tagColors: tagColorsFor(view.tags, colors),
    }))
  }

  private async toView(
    info: ProviderSessionInfo,
    metadata: SessionMetadataRecord | undefined,
    profileByModel: ReadonlyMap<string, string>,
  ): Promise<SessionView> {
    const flags = metadata?.flags ?? { pinned: false, archived: false }
    const tags = tagsFor(info, metadata)
    const stored = metadata?.lastResponseModel ?? null
    const transcript = stored === null
      ? await this.provider(info.ref.provider).sessions.lastAssistantModel(info.ref)
      : undefined
    const lastResponseModel = resolveListedResponseModel(stored, transcript, profileByModel)
    return {
      sessionId: info.ref.id,
      summary: info.summary,
      lastModified: info.lastModified,
      fileSize: info.fileSize,
      customTitle: info.customTitle,
      firstPrompt: info.firstPrompt,
      gitBranch: info.gitBranch,
      cwd: info.cwd,
      sessionSource: 'project',
      tag: tags[0] ?? info.tag,
      tags,
      tagColors: {},
      pinned: flags.pinned,
      archived: flags.archived,
      parentSessionId: null,
      parentMessageUuid: null,
      forkCount: 0,
      origin: null,
      schedulerJobName: null,
      lastResponseModel,
      runMode: metadata?.runMode ?? 'code',
    }
  }
}

function tagsFor(info: ProviderSessionInfo, metadata: SessionMetadataRecord | undefined): string[] {
  if (metadata !== undefined && metadata.tags.length > 0) return [...metadata.tags]
  if (info.tag !== null && info.tag !== '') return [info.tag]
  return []
}

function compareSessions(left: SessionView, right: SessionView): number {
  if (left.pinned !== right.pinned) return left.pinned ? -1 : 1
  return right.lastModified - left.lastModified
}

function groupSessions(sessions: readonly SessionView[], activeCwd: string): SessionGroupView[] {
  const byCwd = new Map<string, SessionView[]>()
  for (const session of sessions) {
    const cwd = session.cwd ?? ''
    const group = byCwd.get(cwd) ?? []
    group.push(session)
    byCwd.set(cwd, group)
  }
  const groups = [...byCwd.entries()].map(([cwd, items]) => {
    const sorted = [...items].sort(compareSessions)
    return {
      cwd,
      pinned: false as const,
      sessions: sorted.slice(0, SESSION_GROUP_PAGE_SIZE),
      hasMore: sorted.length > SESSION_GROUP_PAGE_SIZE,
      lastActivity: sorted[0]?.lastModified ?? 0,
    }
  })
  groups.sort((left, right) => {
    if (left.cwd === activeCwd && right.cwd !== activeCwd) return -1
    if (right.cwd === activeCwd && left.cwd !== activeCwd) return 1
    return right.lastActivity - left.lastActivity
  })
  return groups.map((group) => ({
    cwd: group.cwd,
    pinned: group.pinned,
    sessions: group.sessions,
    hasMore: group.hasMore,
  }))
}

async function normalizeAddDirs(paths: readonly string[]): Promise<string[]> {
  const out: string[] = []
  const seen = new Set<string>()
  for (const raw of paths) {
    if (raw.trim() === '') continue
    let resolved: string
    try {
      resolved = await realpath(raw)
    } catch {
      throw new SessionError('invalid-request', `add_dirs path does not exist: ${raw}`)
    }
    let isDirectory = false
    try {
      isDirectory = (await stat(resolved)).isDirectory()
    } catch {
      // Keep false when the path cannot be stated after realpath.
    }
    if (!isDirectory) {
      throw new SessionError('invalid-request', `add_dirs path is not a directory: ${raw}`)
    }
    if (seen.has(resolved)) continue
    seen.add(resolved)
    out.push(resolved)
  }
  return out
}
