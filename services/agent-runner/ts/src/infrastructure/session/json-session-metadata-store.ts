import { randomUUID } from 'node:crypto'
import {
  chmod,
  mkdir,
  open,
  readFile,
  rename,
  stat,
  unlink,
  type FileHandle,
} from 'node:fs/promises'
import { basename, dirname, join, resolve } from 'node:path'

import type { SessionRef } from '../../core/contract/agent-provider.js'
import type { SessionMetadataRepository } from '../../core/contract/session-metadata-repository.js'
import {
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

const STORE_FILE_NAME = 'session-metadata.json'
const STORE_LOCK_WAIT_MS = 10_000
const STORE_LOCK_STALE_MS = 30_000
const LOCK_RETRY_MS = 25
const STORE_VERSION = 1

export interface JsonSessionMetadataStoreOptions {
  readonly runtimeHome: string
}

interface StoredSessionFlags {
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
      const next: SessionMetadataRecord = {
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
      await ensurePrivateDirectory(this.runtimeHome)
      return await withExclusiveFileLock(
        this.storeLockPath,
        STORE_LOCK_WAIT_MS,
        STORE_LOCK_STALE_MS,
        async () => {
          const transaction = operation(await this.readUnlocked())
          await this.writeUnlocked(transaction.document)
          return transaction.result
        },
      )
    } catch (error) {
      throw mapStoreError(error, 'update')
    }
  }

  private async readDocument(): Promise<SessionMetadataDocument> {
    try {
      await ensurePrivateDirectory(this.runtimeHome)
      return await withExclusiveFileLock(
        this.storeLockPath,
        STORE_LOCK_WAIT_MS,
        STORE_LOCK_STALE_MS,
        async () => await this.readUnlocked(),
      )
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
    return parseDocument(parsed)
  }

  private async writeUnlocked(document: SessionMetadataDocument): Promise<void> {
    const temporaryPath = join(
      dirname(this.filePath),
      `.${basename(this.filePath)}.${process.pid}.${randomUUID()}.tmp`,
    )
    let handle: FileHandle | undefined
    try {
      handle = await open(temporaryPath, 'wx', 0o600)
      await handle.writeFile(`${JSON.stringify(document, null, 2)}\n`, 'utf8')
      await handle.sync()
      await handle.close()
      handle = undefined
      await rename(temporaryPath, this.filePath)
      await chmod(this.filePath, 0o600)
    } finally {
      await handle?.close()
      await removeIfPresent(temporaryPath)
    }
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
    version: typeof record['version'] === 'number' ? record['version'] : STORE_VERSION,
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

async function withExclusiveFileLock<T>(
  lockPath: string,
  waitMs: number,
  staleMs: number,
  operation: () => Promise<T>,
): Promise<T> {
  await ensurePrivateDirectory(dirname(lockPath))
  const deadline = Date.now() + waitMs
  let handle: FileHandle | undefined

  while (handle === undefined) {
    try {
      handle = await open(lockPath, 'wx', 0o600)
    } catch (error) {
      if (!hasErrorCode(error, 'EEXIST')) throw error
      if (await removeStaleLock(lockPath, staleMs)) continue
      if (Date.now() >= deadline) {
        throw new SessionError('io-failure', `Timed out waiting for lock: ${basename(lockPath)}`)
      }
      await delay(LOCK_RETRY_MS)
    }
  }

  try {
    return await operation()
  } finally {
    await handle.close()
    await removeIfPresent(lockPath)
  }
}

async function removeStaleLock(lockPath: string, staleMs: number): Promise<boolean> {
  try {
    const lockStats = await stat(lockPath)
    if (Date.now() - lockStats.mtimeMs <= staleMs) return false
    await unlink(lockPath)
    return true
  } catch (error) {
    if (hasErrorCode(error, 'ENOENT')) return true
    throw error
  }
}

async function ensurePrivateDirectory(path: string): Promise<void> {
  await mkdir(path, { recursive: true, mode: 0o700 })
  await chmod(path, 0o700)
}

async function removeIfPresent(path: string): Promise<void> {
  try {
    await unlink(path)
  } catch (error) {
    if (!hasErrorCode(error, 'ENOENT')) throw error
  }
}

function mapStoreError(error: unknown, operation: string): SessionError {
  if (error instanceof SessionError) return error
  return new SessionError('io-failure', `Could not ${operation} session metadata`, { cause: error })
}

function hasErrorCode(error: unknown, code: string): boolean {
  return typeof error === 'object'
    && error !== null
    && 'code' in error
    && error.code === code
}

async function delay(milliseconds: number): Promise<void> {
  await new Promise((resolve) => {
    setTimeout(resolve, milliseconds)
  })
}
