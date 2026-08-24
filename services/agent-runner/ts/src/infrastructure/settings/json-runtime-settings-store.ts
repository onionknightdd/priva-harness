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
import { basename, dirname, resolve } from 'node:path'

import type {
  RuntimeSettingsStore,
  RuntimeSettingsTransaction,
} from '../../core/contract/runtime-settings.js'
import {
  emptyRuntimeSettings,
  parseRuntimeSettings,
  serializeRuntimeSettings,
  RuntimeSettingsError,
  type RuntimeSettings,
} from '../../core/resource/runtime-settings.js'

const STORE_LOCK_WAIT_MS = 10_000
const STORE_LOCK_STALE_MS = 30_000
const LOCK_RETRY_MS = 25

export interface JsonRuntimeSettingsStoreOptions {
  readonly filePath: string
}

export class JsonRuntimeSettingsStore implements RuntimeSettingsStore {
  readonly filePath: string

  private readonly storeLockPath: string

  constructor(options: JsonRuntimeSettingsStoreOptions) {
    if (options.filePath.trim() === '') {
      throw new TypeError('filePath must not be empty')
    }
    this.filePath = resolve(options.filePath)
    this.storeLockPath = resolve(
      dirname(this.filePath),
      `.${basename(this.filePath)}.lock`,
    )
  }

  async read(): Promise<RuntimeSettings> {
    try {
      await ensurePrivateDirectory(dirname(this.filePath))
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
    operation: (settings: RuntimeSettings) => RuntimeSettingsTransaction<T>,
  ): Promise<T> {
    try {
      await ensurePrivateDirectory(dirname(this.filePath))
      return await withExclusiveFileLock(
        this.storeLockPath,
        STORE_LOCK_WAIT_MS,
        STORE_LOCK_STALE_MS,
        async () => {
          const transaction = operation(await this.readUnlocked())
          const settings = parseRuntimeSettings(
            serializeRuntimeSettings(transaction.settings),
          )
          await this.writeUnlocked(settings)
          return transaction.result
        },
      )
    } catch (error) {
      throw mapStoreError(error, 'update')
    }
  }

  private async readUnlocked(): Promise<RuntimeSettings> {
    let serialized: string
    try {
      serialized = await readFile(this.filePath, 'utf8')
    } catch (error) {
      if (hasErrorCode(error, 'ENOENT')) return emptyRuntimeSettings()
      throw error
    }

    let parsed: unknown
    try {
      parsed = JSON.parse(serialized) as unknown
    } catch (error) {
      throw new RuntimeSettingsError(
        'store-corrupt',
        `Could not parse ${basename(this.filePath)}`,
        { cause: error },
      )
    }
    return parseRuntimeSettings(parsed)
  }

  private async writeUnlocked(settings: RuntimeSettings): Promise<void> {
    const temporaryPath = resolve(
      dirname(this.filePath),
      `.${basename(this.filePath)}.${process.pid}.${randomUUID()}.tmp`,
    )
    let handle: FileHandle | undefined
    try {
      handle = await open(temporaryPath, 'wx', 0o600)
      await handle.writeFile(
        `${JSON.stringify(serializeRuntimeSettings(settings), null, 2)}\n`,
        'utf8',
      )
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

export async function withExclusiveFileLock<T>(
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
        throw new RuntimeSettingsError(
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

export async function ensurePrivateDirectory(path: string): Promise<void> {
  await mkdir(path, { recursive: true, mode: 0o700 })
  await chmod(path, 0o700)
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

function mapStoreError(error: unknown, operation: string): RuntimeSettingsError {
  if (error instanceof RuntimeSettingsError) return error
  if (isErrnoException(error)) {
    return new RuntimeSettingsError(
      'io-failure',
      `Could not ${operation} runtime settings`,
      { cause: error },
    )
  }
  throw error
}

function isErrnoException(error: unknown): error is { readonly code: string } {
  return typeof error === 'object'
    && error !== null
    && 'code' in error
    && typeof error.code === 'string'
}

function hasErrorCode(error: unknown, code: string): boolean {
  return isErrnoException(error) && error.code === code
}

async function delay(milliseconds: number): Promise<void> {
  await new Promise<void>((resolveDelay) => {
    setTimeout(resolveDelay, milliseconds)
  })
}
