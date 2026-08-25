import { readdir, stat, unlink } from 'node:fs/promises'
import type { Dirent } from 'node:fs'
import { join } from 'node:path'

import { SessionManager } from '@earendil-works/pi-coding-agent'

import type { SessionRef } from '../../core/contract/agent-provider.js'
import type {
  ProviderSessionStore,
  SessionListQuery,
  SessionMessagePage,
} from '../../core/contract/provider-session-store.js'
import {
  pageSessionMessages,
  parseMessageTimestamp,
  SessionError,
  type LastAssistantModel,
  type ProviderSessionInfo,
  type SessionMessage,
  type SessionMessageType,
} from '../../core/resource/session.js'
import type { ThreadReplayItem } from '../../core/resource/thread.js'
import { replayPiSessionMessages } from './pi-thread-replay.js'
import { piSessionBucketDir, piSessionsRoot } from './pi-paths.js'

export interface PiListedSession {
  readonly path: string
  readonly id: string
  readonly cwd: string
  readonly name?: string
  readonly modified: Date
  readonly firstMessage: string
}

export interface PiContextEntry {
  readonly type: string
  readonly id: string
  readonly message?: PiAgentMessage
  readonly summary?: string
  readonly tokensBefore?: number
  readonly tokensAfter?: number
  readonly firstKeptEntryId?: string
  readonly customType?: string
  readonly content?: unknown
  readonly details?: unknown
  readonly display?: boolean
}

export interface PiAgentMessage {
  readonly role: string
  readonly model?: string
  readonly toolCallId?: string
  readonly [key: string]: unknown
}

export interface PiOpenedSession {
  appendSessionInfo(name: string): void
  buildContextEntries(): readonly PiContextEntry[]
}

export interface PiSessionManagerApi {
  list(cwd: string, sessionDir?: string): Promise<readonly PiListedSession[]>
  listAll(sessionDir?: string): Promise<readonly PiListedSession[]>
  open(path: string): PiOpenedSession
}

export interface PiSessionStoreOptions {
  readonly agentDir: string
  readonly sessionManager?: PiSessionManagerApi
}

export class PiSessionStore implements ProviderSessionStore {
  private readonly agentDir: string
  private readonly sessionManager: PiSessionManagerApi

  constructor(options: PiSessionStoreOptions) {
    this.agentDir = options.agentDir
    this.sessionManager = options.sessionManager ?? defaultPiSessionManager
  }

  async list(query: SessionListQuery): Promise<readonly ProviderSessionInfo[]> {
    const listed = query.cwd === undefined
      ? await this.listAllSessions()
      : await this.sessionManager.list(query.cwd, piSessionBucketDir(this.agentDir, query.cwd))
    return await Promise.all(listed.map(async (info) => await this.toProviderInfo(info)))
  }

  async read(ref: SessionRef): Promise<ProviderSessionInfo> {
    return await this.toProviderInfo(await this.resolve(ref))
  }

  async lastAssistantModel(ref: SessionRef): Promise<LastAssistantModel | undefined> {
    const listed = await this.resolve(ref)
    const opened = this.sessionManager.open(listed.path)
    const messages = messagesFromContextEntries(opened.buildContextEntries(), listed.id)
    for (let index = messages.length - 1; index >= 0; index -= 1) {
      const item = messages[index]
      if (item?.type !== 'assistant') continue
      const modelId = agentMessageModel(item.message)
      if (modelId === undefined) continue
      return { modelId, observedAt: listed.modified.getTime() }
    }
    return undefined
  }

  async messages(ref: SessionRef, page?: SessionMessagePage): Promise<readonly SessionMessage[]> {
    const listed = await this.resolve(ref)
    const opened = this.sessionManager.open(listed.path)
    return pageSessionMessages(
      messagesFromContextEntries(opened.buildContextEntries(), listed.id),
      page,
    )
  }

  async replay(ref: SessionRef, page?: SessionMessagePage): Promise<readonly ThreadReplayItem[]> {
    const messages = await this.messages(ref, page)
    return replayPiSessionMessages(messages)
  }

  async delete(ref: SessionRef): Promise<void> {
    const listed = await this.resolve(ref)
    try {
      await unlink(listed.path)
    } catch (error) {
      if (hasErrorCode(error, 'ENOENT')) {
        throw new SessionError('session-not-found', 'Session not found')
      }
      throw new SessionError('io-failure', 'Could not delete session', { cause: error })
    }
  }

  async rename(ref: SessionRef, title: string): Promise<void> {
    const listed = await this.resolve(ref)
    this.sessionManager.open(listed.path).appendSessionInfo(title)
  }

  tag(ref: SessionRef, tag: string | null): Promise<void> {
    void tag
    return this.read(ref).then(() => undefined)
  }

  fork(
    _ref: SessionRef,
    _options: { title: string; upToMessageId?: string },
  ): Promise<ProviderSessionInfo> {
    void _ref
    void _options
    return Promise.reject(new SessionError('invalid-request', 'Pi does not support fork'))
  }

  private async listAllSessions(): Promise<readonly PiListedSession[]> {
    const root = piSessionsRoot(this.agentDir)
    let entries: Dirent[]
    try {
      entries = await readdir(root, { withFileTypes: true })
    } catch (error) {
      if (hasErrorCode(error, 'ENOENT')) return []
      throw error
    }
    const groups = await Promise.all(
      entries
        .filter((entry) => entry.isDirectory())
        .map(async (entry) => await this.sessionManager.listAll(join(root, entry.name))),
    )
    return groups.flat()
  }

  private async resolve(ref: SessionRef): Promise<PiListedSession> {
    if (ref.provider !== 'pi') {
      throw new SessionError('session-not-found', 'Session not found')
    }
    const listed = await this.listAllSessions()
    const found = listed.find((session) => session.id === ref.id)
    if (found === undefined) {
      throw new SessionError('session-not-found', 'Session not found')
    }
    return found
  }

  private async toProviderInfo(info: PiListedSession): Promise<ProviderSessionInfo> {
    let fileSize = 0
    try {
      fileSize = (await stat(info.path)).size
    } catch {
      // Sessions listed from headers may outlive a deleted file.
    }
    const name = info.name === undefined || info.name === '' ? null : info.name
    const firstPrompt = info.firstMessage === '' ? null : info.firstMessage
    return {
      ref: { provider: 'pi', id: info.id },
      summary: name ?? firstPrompt ?? '',
      lastModified: info.modified.getTime(),
      fileSize,
      customTitle: name,
      firstPrompt,
      gitBranch: null,
      cwd: info.cwd === '' ? null : info.cwd,
      tag: null,
    }
  }
}

export function messagesFromContextEntries(
  entries: readonly PiContextEntry[],
  sessionId: string,
): SessionMessage[] {
  const messages: SessionMessage[] = []
  for (const entry of entries) {
    if (entry.type === 'custom') continue
    if (entry.type === 'message' && entry.message !== undefined) {
      const mapped = mapPiAgentMessage(entry.message, entry.id, sessionId)
      if (mapped !== undefined) messages.push(mapped)
      continue
    }
    if (entry.type === 'compaction') {
      messages.push({
        type: 'compaction',
        uuid: entry.id,
        sessionId,
        message: {
          role: 'compactionSummary',
          summary: entry.summary ?? '',
          tokensBefore: entry.tokensBefore,
          tokensAfter: entry.tokensAfter,
          firstKeptEntryId: entry.firstKeptEntryId,
        },
        parentToolUseId: null,
        metadata: null,
        timestamp: null,
      })
      continue
    }
    if (entry.type === 'branch_summary') {
      messages.push({
        type: 'branch_summary',
        uuid: entry.id,
        sessionId,
        message: {
          role: 'branchSummary',
          summary: entry.summary ?? '',
        },
        parentToolUseId: null,
        metadata: null,
        timestamp: null,
      })
      continue
    }
    if (entry.type === 'custom_message') {
      messages.push({
        type: 'custom',
        uuid: entry.id,
        sessionId,
        message: {
          role: 'custom',
          customType: entry.customType,
          content: entry.content,
          details: entry.details,
          display: entry.display,
        },
        parentToolUseId: null,
        metadata: null,
        timestamp: null,
      })
    }
  }
  return messages
}

export function mapPiAgentMessage(
  message: PiAgentMessage,
  uuid: string,
  sessionId: string,
): SessionMessage | undefined {
  const type = piRoleToType(message.role)
  if (type === undefined) return undefined
  return {
    type,
    uuid,
    sessionId,
    message,
    parentToolUseId: type === 'tool_result'
      ? (typeof message.toolCallId === 'string' ? message.toolCallId : null)
      : null,
    metadata: null,
    timestamp: parseMessageTimestamp(message['timestamp'])
      ?? parseMessageTimestamp(message['createdAt'])
      ?? parseMessageTimestamp(message['created_at']),
  }
}

function piRoleToType(role: string): SessionMessageType | undefined {
  switch (role) {
    case 'user': return 'user'
    case 'assistant': return 'assistant'
    case 'toolResult': return 'tool_result'
    case 'bashExecution': return 'bash_execution'
    case 'custom': return 'custom'
    case 'compactionSummary': return 'compaction'
    case 'branchSummary': return 'branch_summary'
    default: return undefined
  }
}

function agentMessageModel(message: unknown): string | undefined {
  if (typeof message !== 'object' || message === null) return undefined
  const model = (message as { model?: unknown }).model
  return typeof model === 'string' && model !== '' ? model : undefined
}

const defaultPiSessionManager: PiSessionManagerApi = {
  list(cwd, sessionDir) {
    return SessionManager.list(cwd, sessionDir)
  },
  listAll(sessionDir) {
    return SessionManager.listAll(sessionDir)
  },
  open(path) {
    return SessionManager.open(path) as unknown as PiOpenedSession
  },
}

function hasErrorCode(error: unknown, code: string): boolean {
  return typeof error === 'object'
    && error !== null
    && 'code' in error
    && error.code === code
}
