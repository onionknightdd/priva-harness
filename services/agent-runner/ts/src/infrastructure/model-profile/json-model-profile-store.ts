import { createHash } from 'node:crypto'
import { join, resolve } from 'node:path'

import type {
  ModelProfileStore,
  ModelProfileTransaction,
} from '../../core/contract/model-profile.js'
import type { RuntimeSettingsStore } from '../../core/contract/runtime-settings.js'
import {
  parseModelProfileCollection,
  type ModelProfileCollection,
  ModelProfileError,
} from '../../core/resource/model-profile.js'
import { RuntimeSettingsError } from '../../core/resource/runtime-settings.js'
import {
  ensurePrivateDirectory,
  withExclusiveFileLock,
} from '../settings/json-runtime-settings-store.js'

const PROBE_LOCK_WAIT_MS = 45_000
const PROBE_LOCK_STALE_MS = 60_000

export interface JsonModelProfileStoreOptions {
  readonly settings: RuntimeSettingsStore
  readonly runtimeHome: string
}

export class JsonModelProfileStore implements ModelProfileStore {
  readonly filePath: string

  private readonly settings: RuntimeSettingsStore
  private readonly capabilityLockDirectory: string

  constructor(options: JsonModelProfileStoreOptions) {
    if (options.runtimeHome.trim() === '') {
      throw new TypeError('runtimeHome must not be empty')
    }
    this.settings = options.settings
    this.filePath = options.settings.filePath
    this.capabilityLockDirectory = join(
      resolve(options.runtimeHome),
      'runtime',
      'image-capability-locks',
    )
  }

  async read(): Promise<ModelProfileCollection> {
    try {
      return (await this.settings.read()).modelProfiles
    } catch (error) {
      throw mapStoreError(error, 'read')
    }
  }

  async transact<T>(
    operation: (collection: ModelProfileCollection) => ModelProfileTransaction<T>,
  ): Promise<T> {
    try {
      return await this.settings.transact((settings) => {
        const transaction = operation(settings.modelProfiles)
        const collection = parseModelProfileCollection({
          defaultProfileId: transaction.collection.defaultProfileId,
          profiles: transaction.collection.profiles,
        })
        return {
          settings: {
            ...settings,
            modelProfiles: collection,
          },
          result: transaction.result,
        }
      })
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
}

function mapStoreError(error: unknown, operation: string): ModelProfileError {
  if (error instanceof ModelProfileError) return error
  if (error instanceof RuntimeSettingsError) {
    if (error.kind === 'store-corrupt' || error.kind === 'invalid-queue-behavior') {
      return new ModelProfileError('store-corrupt', error.message, { cause: error })
    }
    return new ModelProfileError('io-failure', error.message, { cause: error })
  }
  return new ModelProfileError(
    'io-failure',
    `Could not ${operation} model profiles`,
    { cause: error },
  )
}
