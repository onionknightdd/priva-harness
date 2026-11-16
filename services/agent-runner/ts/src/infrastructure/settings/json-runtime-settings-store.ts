import { readFile } from 'node:fs/promises'
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
import { hasErrorCode } from '../../core/util/errors.js'
import { withExclusiveFileLock, writePrivateFileAtomically } from '../storage/private-file.js'

const STORE_LOCK = { waitMs: 10_000, staleMs: 30_000 } as const

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

  // Writes replace the file atomically, so a read needs no lock.
  async read(): Promise<RuntimeSettings> {
    try {
      return await this.readUnlocked()
    } catch (error) {
      throw mapStoreError(error, 'read')
    }
  }

  async transact<T>(
    operation: (settings: RuntimeSettings) => RuntimeSettingsTransaction<T>,
  ): Promise<T> {
    try {
      return await withExclusiveFileLock(
        this.storeLockPath,
        STORE_LOCK,
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
    await writePrivateFileAtomically(
      this.filePath,
      `${JSON.stringify(serializeRuntimeSettings(settings), null, 2)}\n`,
    )
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
