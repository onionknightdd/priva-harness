import { readFile, readdir, stat } from 'node:fs/promises'
import { join } from 'node:path'

import * as claudeAgentSdk from '@anthropic-ai/claude-agent-sdk'

import type { SessionRef } from '../../../core/contract/agent-provider.js'
import type {
  ProviderSessionStore,
  SessionListQuery,
  SessionMessagePage,
} from '../../../core/contract/provider-session-store.js'
import {
  pageSessionMessages,
  parseMessageTimestamp,
  SessionError,
  type LastAssistantModel,
  type ProviderSessionInfo,
  type SessionMessage,
  type SessionMessageType,
} from '../../../core/resource/session.js'
import type { ThreadReplayItem } from '../../../core/resource/thread.js'
import { replayClaudeSessionMessages } from './claude-thread-replay.js'

export interface ClaudeSessionSdk {
  listSessions(options?: { dir?: string }): Promise<readonly ClaudeSdkSessionInfo[]>
  getSessionInfo(sessionId: string, options?: { dir?: string }): Promise<ClaudeSdkSessionInfo | null | undefined>
  getSessionMessages(
    sessionId: string,
    options?: { dir?: string; limit?: number; offset?: number },
  ): Promise<readonly unknown[]>
  listSubagents(sessionId: string, options?: { dir?: string }): Promise<readonly ClaudeSdkSubagentInfo[]>
  getSubagentMessages(sessionId: string, agentId: string, options?: { dir?: string }): Promise<readonly unknown[]>
  deleteSession(sessionId: string, options?: { dir?: string }): Promise<void>
  renameSession(sessionId: string, title: string, options?: { dir?: string }): Promise<void>
  tagSession(sessionId: string, tag: string | null, options?: { dir?: string }): Promise<void>
  forkSession(
    sessionId: string,
    options?: { dir?: string; upToMessageId?: string; title?: string },
  ): Promise<{ sessionId: string }>
}

export interface ClaudeSdkSessionInfo {
  readonly sessionId: string
  readonly summary?: string
  readonly lastModified?: Date | number | string
  readonly fileSize?: number
  readonly customTitle?: string | null
  readonly firstPrompt?: string | null
  readonly gitBranch?: string | null
  readonly cwd?: string | null
  readonly tag?: string | null
}

export interface ClaudeSdkSubagentInfo {
  readonly agentId: string
}

export interface ClaudeSessionStoreOptions {
  readonly globalConfigDir: string
  readonly sdk?: ClaudeSessionSdk
}

interface TranscriptModelCache {
  readonly mtimeMs: number
  readonly size: number
  readonly value: LastAssistantModel | undefined
}

export class ClaudeSessionStore implements ProviderSessionStore {
  private readonly sdk: ClaudeSessionSdk
  private readonly globalConfigDir: string
  private readonly transcriptCache = new Map<string, TranscriptModelCache>()

  constructor(options: ClaudeSessionStoreOptions) {
    this.globalConfigDir = options.globalConfigDir
    this.sdk = options.sdk ?? defaultClaudeSessionSdk
  }

  async list(query: SessionListQuery): Promise<readonly ProviderSessionInfo[]> {
    const listed = await this.sdk.listSessions(
      query.cwd === undefined ? undefined : { dir: query.cwd },
    )
    return listed.map((info) => this.toProviderInfo(info))
  }

  async read(ref: SessionRef): Promise<ProviderSessionInfo> {
    this.assertProvider(ref)
    const info = await this.sdk.getSessionInfo(ref.id)
    if (info === null || info === undefined) {
      throw new SessionError('session-not-found', 'Session not found')
    }
    return this.toProviderInfo(info)
  }

  async lastAssistantModel(ref: SessionRef): Promise<LastAssistantModel | undefined> {
    const info = await this.read(ref)
    const transcriptPath = await this.findTranscriptPath(ref.id, info.cwd)
    if (transcriptPath !== undefined) {
      return await this.lastAssistantFromTranscript(transcriptPath)
    }
    const messages = await this.sdk.getSessionMessages(ref.id, dirOptions(info.cwd))
    return lastAssistantFromClaudeMessages(messages)
  }

  async messages(ref: SessionRef, page?: SessionMessagePage): Promise<readonly SessionMessage[]> {
    const info = await this.read(ref)
    const options = dirOptions(info.cwd)
    const listed = await this.sdk.getSessionMessages(ref.id, options)
    const mapped = listed.map((message) => mapClaudeMessage(message, ref.id))
    if (page?.limit === undefined) {
      const subagents = await this.sdk.listSubagents(ref.id, options)
      for (const subagent of subagents) {
        const extra = await this.sdk.getSubagentMessages(ref.id, subagent.agentId, options)
        mapped.push(...extra.map((message) => mapClaudeMessage(message, ref.id)))
      }
    }
    return pageSessionMessages(mapped, page)
  }

  async replay(ref: SessionRef, page?: SessionMessagePage): Promise<readonly ThreadReplayItem[]> {
    const messages = await this.messages(ref, page)
    return replayClaudeSessionMessages(messages)
  }

  async delete(ref: SessionRef): Promise<void> {
    const info = await this.read(ref)
    await this.sdk.deleteSession(ref.id, dirOptions(info.cwd))
  }

  async rename(ref: SessionRef, title: string): Promise<void> {
    const info = await this.read(ref)
    await this.sdk.renameSession(ref.id, title, dirOptions(info.cwd))
  }

  async tag(ref: SessionRef, tag: string | null): Promise<void> {
    const info = await this.read(ref)
    await this.sdk.tagSession(ref.id, tag, dirOptions(info.cwd))
  }

  async fork(
    ref: SessionRef,
    options: { title: string; upToMessageId?: string },
  ): Promise<ProviderSessionInfo> {
    const info = await this.read(ref)
    const result = await this.sdk.forkSession(ref.id, {
      ...dirOptions(info.cwd),
      title: options.title,
      ...(options.upToMessageId === undefined ? {} : { upToMessageId: options.upToMessageId }),
    })
    const forked = await this.sdk.getSessionInfo(result.sessionId, dirOptions(info.cwd))
    if (forked !== null && forked !== undefined) {
      return this.toProviderInfo(forked)
    }
    return {
      ...info,
      ref: { provider: 'claude', id: result.sessionId },
      customTitle: options.title,
      summary: options.title,
      lastModified: Date.now(),
    }
  }

  private toProviderInfo(info: ClaudeSdkSessionInfo): ProviderSessionInfo {
    return {
      ref: { provider: 'claude', id: info.sessionId },
      summary: info.summary ?? '',
      lastModified: toEpochMs(info.lastModified),
      fileSize: info.fileSize ?? 0,
      customTitle: info.customTitle ?? null,
      firstPrompt: info.firstPrompt ?? null,
      gitBranch: info.gitBranch ?? null,
      cwd: info.cwd ?? null,
      tag: info.tag ?? null,
    }
  }

  private assertProvider(ref: SessionRef): void {
    if (ref.provider !== 'claude') {
      throw new SessionError('session-not-found', 'Session not found')
    }
  }

  private async findTranscriptPath(sessionId: string, cwd: string | null): Promise<string | undefined> {
    const fileName = `${sessionId}.jsonl`
    if (cwd !== null && cwd !== '') {
      const encoded = cwd.replace(/[^A-Za-z0-9]/gu, '-')
      const candidate = join(this.globalConfigDir, 'projects', encoded, fileName)
      if (await pathExists(candidate)) return candidate
    }
    const projectsRoot = join(this.globalConfigDir, 'projects')
    let entries: string[]
    try {
      entries = await readdir(projectsRoot)
    } catch {
      return undefined
    }
    for (const entry of entries) {
      const candidate = join(projectsRoot, entry, fileName)
      if (await pathExists(candidate)) return candidate
    }
    return undefined
  }

  private async lastAssistantFromTranscript(path: string): Promise<LastAssistantModel | undefined> {
    const stats = await stat(path)
    const cached = this.transcriptCache.get(path)
    if (cached?.mtimeMs === stats.mtimeMs && cached.size === stats.size) {
      return cached.value
    }
    const content = await readFile(path, 'utf8')
    const value = lastAssistantFromTranscriptLines(content.split('\n'), stats.mtimeMs)
    this.transcriptCache.set(path, { mtimeMs: stats.mtimeMs, size: stats.size, value })
    return value
  }
}

const defaultClaudeSessionSdk: ClaudeSessionSdk = {
  async listSessions(options) {
    return await callClaudeSdk<ClaudeSdkSessionInfo[]>('listSessions', ...optionalArg(options))
  },
  async getSessionInfo(sessionId, options) {
    return await callClaudeSdk<ClaudeSdkSessionInfo | null | undefined>(
      'getSessionInfo',
      sessionId,
      ...optionalArg(options),
    )
  },
  async getSessionMessages(sessionId, options) {
    return await callClaudeSdk<unknown[]>('getSessionMessages', sessionId, ...optionalArg(options))
  },
  async listSubagents(sessionId, options) {
    const fn = claudeSdkFunction('listSubagents')
    if (fn === undefined) return []
    return await Promise.resolve(fn(sessionId, ...optionalArg(options))) as ClaudeSdkSubagentInfo[]
  },
  async getSubagentMessages(sessionId, agentId, options) {
    const fn = claudeSdkFunction('getSubagentMessages')
    if (fn === undefined) return []
    return await Promise.resolve(fn(sessionId, agentId, ...optionalArg(options))) as unknown[]
  },
  async deleteSession(sessionId, options) {
    await callClaudeSdk('deleteSession', sessionId, ...optionalArg(options))
  },
  async renameSession(sessionId, title, options) {
    await callClaudeSdk('renameSession', sessionId, title, ...optionalArg(options))
  },
  async tagSession(sessionId, tag, options) {
    await callClaudeSdk('tagSession', sessionId, tag, ...optionalArg(options))
  },
  async forkSession(sessionId, options) {
    return await callClaudeSdk<{ sessionId: string }>('forkSession', sessionId, ...optionalArg(options))
  },
}

function optionalArg<T>(value: T | undefined): [] | [T] {
  return value === undefined ? [] : [value]
}

function claudeSdkFunction(name: string): ((...args: unknown[]) => unknown) | undefined {
  const value = (claudeAgentSdk as Record<string, unknown>)[name]
  return typeof value === 'function' ? value as (...args: unknown[]) => unknown : undefined
}

async function callClaudeSdk<T>(name: string, ...args: unknown[]): Promise<T> {
  const fn = claudeSdkFunction(name)
  if (fn === undefined) {
    throw new SessionError('io-failure', `Claude SDK does not export ${name}`)
  }
  return await Promise.resolve(fn(...args)) as T
}

export function mapClaudeMessage(raw: unknown, sessionId: string): SessionMessage {
  const record = asRecord(raw)
  const type = claudeMessageType(record['type'])
  const uuid = stringField(record, 'uuid') ?? stringField(record, 'id') ?? ''
  return {
    type,
    uuid,
    sessionId: stringField(record, 'session_id') ?? stringField(record, 'sessionId') ?? sessionId,
    message: withToolUseResult(
      record['message'] ?? raw,
      record['tool_use_result'] ?? record['toolUseResult'],
    ),
    parentToolUseId: stringField(record, 'parent_tool_use_id')
      ?? stringField(record, 'parentToolUseId')
      ?? null,
    metadata: metadataField(record['metadata']),
    timestamp: parseMessageTimestamp(record['timestamp'])
      ?? parseMessageTimestamp(asRecord(record['message'])['timestamp']),
  }
}

export function lastAssistantFromClaudeMessages(
  messages: readonly unknown[],
): LastAssistantModel | undefined {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const parsed = assistantModelFromUnknown(messages[index])
    if (parsed !== undefined) return parsed
  }
  return undefined
}

export function lastAssistantFromTranscriptLines(
  lines: readonly string[],
  fallbackObservedAt: number,
): LastAssistantModel | undefined {
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const line = lines[index]
    if (line === undefined || line.trim() === '') continue
    let parsed: unknown
    try {
      parsed = JSON.parse(line) as unknown
    } catch {
      continue
    }
    const record = asRecord(parsed)
    if (record['isSidechain'] === true || record['is_sidechain'] === true) continue
    const found = assistantModelFromUnknown(parsed, fallbackObservedAt)
    if (found !== undefined) return found
  }
  return undefined
}

function assistantModelFromUnknown(
  value: unknown,
  fallbackObservedAt: number | null = null,
): LastAssistantModel | undefined {
  const record = asRecord(value)
  const type = stringField(record, 'type')
  if (type !== undefined && type !== 'assistant') return undefined
  const message = asRecord(record['message'] ?? value)
  const modelId = stringField(message, 'model')
  if (modelId === undefined || modelId.includes('<synthetic>')) return undefined
  return {
    modelId,
    observedAt: parseMessageTimestamp(record['timestamp']) ?? fallbackObservedAt,
  }
}

function claudeMessageType(value: unknown): SessionMessageType {
  if (value === 'assistant' || value === 'system' || value === 'user') return value
  if (value === 'tool_result') return 'tool_result'
  if (value === 'stream_event') return 'stream_event'
  return 'user'
}

function dirOptions(cwd: string | null): { dir: string } | undefined {
  if (cwd === null || cwd === '') return undefined
  return { dir: cwd }
}

function toEpochMs(value: Date | number | string | undefined): number {
  if (value instanceof Date) return value.getTime()
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string') {
    const parsed = Date.parse(value)
    if (!Number.isNaN(parsed)) return parsed
  }
  return 0
}

function asRecord(value: unknown): Record<string, unknown> {
  if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
    return value as Record<string, unknown>
  }
  return {}
}

function withToolUseResult(message: unknown, result: unknown): unknown {
  if (result === undefined) {
    return message
  }
  if (typeof message !== 'object' || message === null || Array.isArray(message)) {
    return message
  }
  const record = message as Record<string, unknown>
  if (record['tool_use_result'] !== undefined || record['toolUseResult'] !== undefined) {
    return message
  }
  return { ...record, tool_use_result: result }
}

function stringField(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key]
  return typeof value === 'string' && value !== '' ? value : undefined
}

function metadataField(value: unknown): Readonly<Record<string, unknown>> | null {
  if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
    return value as Record<string, unknown>
  }
  return null
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path)
    return true
  } catch {
    return false
  }
}
