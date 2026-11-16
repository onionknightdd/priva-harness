import { readFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'

import type { SessionRef } from '../../core/contract/agent-provider.js'
import type { SessionMetadataRepository } from '../../core/contract/session-metadata-repository.js'
import type { BackgroundTask } from '../../core/resource/background-task.js'
import {
  assertRunMode,
  isRunMode,
  reserveTagColors,
  SessionError,
  sessionRefKey,
  type SessionFlags,
  type SessionMetadataPatch,
  type SessionMetadataRecord,
  type SessionRecap,
  type StoredLastResponseModel,
} from '../../core/resource/session.js'
import { hasErrorCode } from '../../core/util/errors.js'
import { withExclusiveFileLock, writePrivateFileAtomically } from '../storage/private-file.js'

const STORE_FILE_NAME = 'session-metadata.json'
const STORE_LOCK = { waitMs: 10_000, staleMs: 30_000 } as const
const STORE_VERSION = 2

export interface JsonSessionMetadataStoreOptions {
  readonly runtimeHome: string
}

interface StoredSessionFlags {
  readonly backgroundTasks?: readonly BackgroundTask[]
  readonly pinned?: boolean
  readonly archived?: boolean
  readonly tags?: readonly string[]
  readonly addDirs?: readonly string[]
  readonly runMode?: string
}

interface SessionMetadataDocument {
  readonly version: number
  readonly sessions: Record<string, StoredSessionFlags>
  readonly recaps: Record<string, SessionRecap>
  readonly lastResponseModels: Record<string, StoredLastResponseModel>
  readonly tagColors: Record<string, number>
}

export class JsonSessionMetadataStore implements SessionMetadataRepository {
  readonly filePath: string

  private readonly runtimeHome: string
  private readonly storeLockPath: string

  constructor(options: JsonSessionMetadataStoreOptions) {
    if (options.runtimeHome.trim() === '') {
      throw new TypeError('runtimeHome must not be empty')
    }
    this.runtimeHome = resolve(options.runtimeHome)
    this.filePath = join(this.runtimeHome, STORE_FILE_NAME)
    this.storeLockPath = join(this.runtimeHome, `.${STORE_FILE_NAME}.lock`)
  }

  async get(ref: SessionRef): Promise<SessionMetadataRecord> {
    const document = await this.readDocument()
    return recordFromDocument(document, sessionRefKey(ref))
  }

  async list(refs: readonly SessionRef[]): Promise<ReadonlyMap<string, SessionMetadataRecord>> {
    const document = await this.readDocument()
    const out = new Map<string, SessionMetadataRecord>()
    for (const ref of refs) {
      const key = sessionRefKey(ref)
      out.set(key, recordFromDocument(document, key))
    }
    return out
  }

  async tagColors(tags: readonly string[]): Promise<Readonly<Record<string, number>>> {
    // Listing sessions asks for colors every time; only a tag seen for the
    // first time needs a slot reserved and written.
    const current = (await this.readDocument()).tagColors
    if (Object.keys(reserveTagColors(current, tags)).length === Object.keys(current).length) return current
    return await this.transact((document) => {
      const reserved = reserveTagColors(document.tagColors, tags)
      return {
        document: { ...document, tagColors: reserved },
        result: reserved,
      }
    })
  }

  async upsert(ref: SessionRef, patch: SessionMetadataPatch): Promise<SessionMetadataRecord> {
    return await this.transact((document) => {
      const key = sessionRefKey(ref)
      const current = recordFromDocument(document, key)
      assertRunMode(current.runMode, patch.runMode)
      const next: SessionMetadataRecord = {
        backgroundTasks: patch.backgroundTasks ?? current.backgroundTasks,
        flags: {
          pinned: patch.pinned ?? current.flags.pinned,
          archived: patch.archived ?? current.flags.archived,
        },
        tags: patch.tags === undefined ? current.tags : [...patch.tags],
        addDirs: patch.addDirs === undefined ? current.addDirs : [...patch.addDirs],
        runMode: patch.runMode ?? current.runMode,
        recap: patch.recap === undefined ? current.recap : patch.recap,
        lastResponseModel: patch.lastResponseModel === undefined
          ? current.lastResponseModel
          : patch.lastResponseModel,
      }
      return {
        document: writeRecord(document, key, next),
        result: next,
      }
    })
  }

  async delete(ref: SessionRef): Promise<void> {
    await this.transact((document) => {
      const key = sessionRefKey(ref)
      const sessions = omitKey(document.sessions, key)
      const recaps = omitKey(document.recaps, key)
      const lastResponseModels = omitKey(document.lastResponseModels, key)
      return {
        document: {
          ...document,
          sessions,
          recaps,
          lastResponseModels,
        },
        result: undefined,
      }
    })
  }

  private async transact<T>(
    operation: (document: SessionMetadataDocument) => {
      readonly document: SessionMetadataDocument
      readonly result: T
    },
  ): Promise<T> {
    try {
      return await withExclusiveFileLock(
        this.storeLockPath,
        STORE_LOCK,
        async () => {
          const transaction = operation(await this.readUnlocked())
          await writePrivateFileAtomically(this.filePath, `${JSON.stringify(transaction.document, null, 2)}\n`)
          return transaction.result
        },
      )
    } catch (error) {
      throw mapStoreError(error, 'update')
    }
  }

  // Writes replace the file atomically, so a read needs no lock.
  private async readDocument(): Promise<SessionMetadataDocument> {
    try {
      return await this.readUnlocked()
    } catch (error) {
      throw mapStoreError(error, 'read')
    }
  }

  private async readUnlocked(): Promise<SessionMetadataDocument> {
    let serialized: string
    try {
      serialized = await readFile(this.filePath, 'utf8')
    } catch (error) {
      if (hasErrorCode(error, 'ENOENT')) return emptyDocument()
      throw error
    }

    let parsed: unknown
    try {
      parsed = JSON.parse(serialized) as unknown
    } catch (error) {
      throw new SessionError('io-failure', `Could not parse ${STORE_FILE_NAME}`, { cause: error })
    }
    const document = parseDocument(parsed)
    // The upgrade is deterministic, so it is applied on every read and
    // persisted by the next write.
    if (document.version >= STORE_VERSION) return document
    return { ...document, version: STORE_VERSION, sessions: Object.fromEntries(
      Object.entries(document.sessions).map(([key, flags]) => [key, key.startsWith('claude:') ? { ...flags, runMode: 'code' } : flags]),
    ) }
  }

}

function emptyDocument(): SessionMetadataDocument {
  return {
    version: STORE_VERSION,
    sessions: {},
    recaps: {},
    lastResponseModels: {},
    tagColors: {},
  }
}

function parseDocument(value: unknown): SessionMetadataDocument {
  if (value === undefined || value === null) return emptyDocument()
  if (typeof value !== 'object' || Array.isArray(value)) {
    throw new SessionError('io-failure', `Could not parse ${STORE_FILE_NAME}`)
  }
  const record = value as Record<string, unknown>
  return {
    version: typeof record['version'] === 'number' ? record['version'] : 1,
    sessions: asObject(record['sessions']),
    recaps: asObject(record['recaps']),
    lastResponseModels: asObject(record['lastResponseModels']),
    tagColors: asObject(record['tagColors']),
  }
}

function recordFromDocument(document: SessionMetadataDocument, key: string): SessionMetadataRecord {
  const stored = document.sessions[key]
  const flags: SessionFlags = {
    pinned: stored?.pinned === true,
    archived: stored?.archived === true,
  }
  const tags = Array.isArray(stored?.tags)
    ? stored.tags.filter((tag): tag is string => typeof tag === 'string')
    : []
  const addDirs = Array.isArray(stored?.addDirs)
    ? stored.addDirs.filter((dir): dir is string => typeof dir === 'string')
    : []
  const runMode = stored?.runMode !== undefined && isRunMode(stored.runMode) ? stored.runMode : null
  const recap = parseRecap(document.recaps[key])
  const lastResponseModel = parseStoredModel(document.lastResponseModels[key])
  return {
    flags,
    backgroundTasks: stored?.backgroundTasks ?? [],
    tags,
    addDirs,
    runMode,
    recap,
    lastResponseModel,
  }
}

function writeRecord(
  document: SessionMetadataDocument,
  key: string,
  record: SessionMetadataRecord,
): SessionMetadataDocument {
  const recaps = record.recap === null
    ? omitKey(document.recaps, key)
    : { ...document.recaps, [key]: record.recap }

  const lastResponseModels = record.lastResponseModel === null
    ? omitKey(document.lastResponseModels, key)
    : { ...document.lastResponseModels, [key]: record.lastResponseModel }

  return {
    ...document,
    sessions: {
      ...document.sessions,
      [key]: {
        backgroundTasks: record.backgroundTasks,
        pinned: record.flags.pinned,
        archived: record.flags.archived,
        tags: [...record.tags],
        addDirs: [...record.addDirs],
        ...(record.runMode === null ? {} : { runMode: record.runMode }),
      },
    },
    recaps,
    lastResponseModels,
    tagColors: reserveTagColors(document.tagColors, record.tags),
  }
}

function parseRecap(value: unknown): SessionRecap | null {
  if (typeof value !== 'object' || value === null) return null
  const record = value as Record<string, unknown>
  const text = record['text']
  const turns = record['turns']
  if (typeof text !== 'string' || typeof turns !== 'number') return null
  return { text, turns }
}

function parseStoredModel(value: unknown): StoredLastResponseModel | null {
  if (typeof value !== 'object' || value === null) return null
  const record = value as Record<string, unknown>
  const rawModel = record['model']
  if (typeof rawModel !== 'object' || rawModel === null) return null
  const model = rawModel as Record<string, unknown>
  const modelId = model['id']
  if (typeof modelId !== 'string' || modelId === '') return null
  const rawCapabilities = model['capabilities']
  const capabilities = typeof rawCapabilities === 'object' && rawCapabilities !== null
    ? rawCapabilities as Record<string, unknown>
    : {}
  const context = capabilities['context'] === '1m' ? '1m' as const : null
  const rawSource = record['modelSource']
  const modelSource = rawSource === 'profile' || rawSource === 'transcript'
    ? rawSource
    : 'transcript'
  const profileId = record['profileId']
  const observedAt = record['observedAt']
  return {
    profileId: typeof profileId === 'string' ? profileId : null,
    model: { id: modelId, capabilities: { context } },
    modelSource,
    observedAt: typeof observedAt === 'number' ? observedAt : null,
  }
}

function asObject<T>(value: unknown): Record<string, T> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return {}
  return { ...(value as Record<string, T>) }
}

function omitKey<T>(record: Record<string, T>, key: string): Record<string, T> {
  return Object.fromEntries(
    Object.entries(record).filter(([candidate]) => candidate !== key),
  )
}

function mapStoreError(error: unknown, operation: string): SessionError {
  if (error instanceof SessionError) return error
  return new SessionError('io-failure', `Could not ${operation} session metadata`, { cause: error })
}
