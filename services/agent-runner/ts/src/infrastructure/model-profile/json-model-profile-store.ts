import { createHash, randomUUID } from 'node:crypto'
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

import type {
  ModelProfileStore,
  ModelProfileTransaction,
} from '../../core/contract/model-profile.js'
import {
  emptyModelProfileCollection,
  type ModelProfileCollection,
  ModelProfileError,
  parseModelProfileCollection,
} from '../../core/resource/model-profile.js'

const STORE_FILE_NAME = 'model-profiles.json'
const STORE_LOCK_WAIT_MS = 10_000
const STORE_LOCK_STALE_MS = 30_000
const PROBE_LOCK_WAIT_MS = 45_000
const PROBE_LOCK_STALE_MS = 60_000
const LOCK_RETRY_MS = 25

export interface JsonModelProfileStoreOptions {
  readonly runtimeHome: string
}

export class JsonModelProfileStore implements ModelProfileStore {
  readonly filePath: string

  private readonly runtimeHome: string
  private readonly storeLockPath: string
  private readonly capabilityLockDirectory: string

  constructor(options: JsonModelProfileStoreOptions) {
    if (options.runtimeHome.trim() === '') {
      throw new TypeError('runtimeHome must not be empty')
    }
    this.runtimeHome = resolve(options.runtimeHome)
    this.filePath = join(this.runtimeHome, STORE_FILE_NAME)
    this.storeLockPath = join(this.runtimeHome, `.${STORE_FILE_NAME}.lock`)
    this.capabilityLockDirectory = join(
      this.runtimeHome,
      'runtime',
      'image-capability-locks',
    )
  }

  async read(): Promise<ModelProfileCollection> {
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

  async transact<T>(
    operation: (collection: ModelProfileCollection) => ModelProfileTransaction<T>,
  ): Promise<T> {
    try {
      await ensurePrivateDirectory(this.runtimeHome)
      return await withExclusiveFileLock(
        this.storeLockPath,
        STORE_LOCK_WAIT_MS,
        STORE_LOCK_STALE_MS,
        async () => {
          const transaction = operation(await this.readUnlocked())
          const collection = parseModelProfileCollection(transaction.collection)
          await this.writeUnlocked(collection)
          return transaction.result
        },
      )
    } catch (error) {
      throw mapStoreError(error, 'update')
    }
  }

  async withCapabilityProbeLock<T>(
    profileId: string,
    modelId: string,
    operation: () => Promise<T>,
  ): Promise<T> {
    const digest = createHash('sha256')
      .update(profileId)
      .update('\0')
      .update(modelId)
      .digest('hex')
    const lockPath = join(this.capabilityLockDirectory, `${digest}.lock`)
    try {
      await ensurePrivateDirectory(this.capabilityLockDirectory)
      return await withExclusiveFileLock(
        lockPath,
        PROBE_LOCK_WAIT_MS,
        PROBE_LOCK_STALE_MS,
        operation,
      )
    } catch (error) {
      throw mapStoreError(error, 'coordinate image capability probe')
    }
  }

  private async readUnlocked(): Promise<ModelProfileCollection> {
    let serialized: string
    try {
      serialized = await readFile(this.filePath, 'utf8')
    } catch (error) {
      if (hasErrorCode(error, 'ENOENT')) return emptyModelProfileCollection()
      throw error
    }

    let parsed: unknown
    try {
      parsed = JSON.parse(serialized) as unknown
    } catch (error) {
      throw new ModelProfileError(
        'store-corrupt',
        `Could not parse ${STORE_FILE_NAME}`,
        { cause: error },
      )
    }
    return parseModelProfileCollection(parsed)
  }

  private async writeUnlocked(collection: ModelProfileCollection): Promise<void> {
    const temporaryPath = join(
      dirname(this.filePath),
      `.${basename(this.filePath)}.${process.pid}.${randomUUID()}.tmp`,
    )
    let handle: FileHandle | undefined
    try {
      handle = await open(temporaryPath, 'wx', 0o600)
      await handle.writeFile(`${JSON.stringify(collection, null, 2)}\n`, 'utf8')
      await handle.sync()
      await handle.close()
      handle = undefined
      await rename(temporaryPath, this.filePath)
      await chmod(this.filePath, 0o600)
      await syncDirectory(dirname(this.filePath))
    } finally {
      await handle?.close()
      await removeIfPresent(temporaryPath)
    }
  }
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
        throw new ModelProfileError(
          'io-failure',
          `Timed out waiting for lock: ${basename(lockPath)}`,
        )
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

async function syncDirectory(path: string): Promise<void> {
  const handle = await open(path, 'r')
  try {
    await handle.sync()
  } finally {
    await handle.close()
  }
}

async function removeIfPresent(path: string): Promise<void> {
  try {
    await unlink(path)
  } catch (error) {
    if (!hasErrorCode(error, 'ENOENT')) throw error
  }
}

function mapStoreError(error: unknown, operation: string): ModelProfileError {
  if (error instanceof ModelProfileError) return error
  return new ModelProfileError(
    'io-failure',
    `Could not ${operation} model profiles`,
    { cause: error },
  )
}

function hasErrorCode(error: unknown, code: string): boolean {
  return typeof error === 'object'
    && error !== null
    && 'code' in error
    && error.code === code
}

async function delay(milliseconds: number): Promise<void> {
  await new Promise<void>((resolveDelay) => {
    setTimeout(resolveDelay, milliseconds)
  })
}
