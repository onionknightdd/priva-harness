import { access, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { createModelProfile } from '../../../../src/core/resource/model-profile.js'
import {
  RUNTIME_SETTINGS_VERSION,
  RuntimeSettingsError,
} from '../../../../src/core/resource/runtime-settings.js'
import { JsonRuntimeSettingsStore } from '../../../../src/infrastructure/settings/json-runtime-settings-store.js'
import { createRuntimeConfig } from '../../../../src/runtime-config.js'

describe('JsonRuntimeSettingsStore', () => {
  let runtimeHome: string
  let store: JsonRuntimeSettingsStore

  beforeEach(async () => {
    runtimeHome = await mkdtemp(join(tmpdir(), 'priva-runtime-settings-store-test-'))
    store = new JsonRuntimeSettingsStore({
      filePath: createRuntimeConfig(runtimeHome).settingsFilePath,
    })
  })

  afterEach(async () => {
    await rm(runtimeHome, { recursive: true, force: true })
  })

  it('returns defaults without creating the settings file', async () => {
    const settings = await store.read()

    expect(settings).toEqual({
      version: RUNTIME_SETTINGS_VERSION,
      modelProfiles: {
        version: 1,
        defaultProfileId: null,
        profiles: [],
      },
      agentProfile: { queueBehavior: 'follow-up' },
    })
    await expect(access(store.filePath)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('writes bambuddy.settings.json atomically with private permissions', async () => {
    await store.transact((settings) => ({
      settings: {
        ...settings,
        agentProfile: { queueBehavior: 'steer' },
      },
      result: undefined,
    }))

    expect(store.filePath).toBe(join(runtimeHome, 'bambuddy.settings.json'))
    expect(JSON.parse(await readFile(store.filePath, 'utf8'))).toEqual({
      version: RUNTIME_SETTINGS_VERSION,
      modelProfiles: {
        defaultProfileId: null,
        profiles: [],
      },
      agentProfile: { queueBehavior: 'steer' },
    })
    expect((await stat(runtimeHome)).mode & 0o777).toBe(0o700)
    expect((await stat(store.filePath)).mode & 0o777).toBe(0o600)
  })

  it('preserves modelProfiles when updating agentProfile', async () => {
    const profile = createModelProfile({
      id: 'gateway',
      label: 'Gateway',
      baseUrl: 'https://api.example.com',
      authToken: 'secret',
      defaultModel: 'model-a',
    })
    await store.transact((settings) => ({
      settings: {
        ...settings,
        modelProfiles: {
          ...settings.modelProfiles,
          defaultProfileId: profile.id,
          profiles: [profile],
        },
      },
      result: undefined,
    }))

    await store.transact((settings) => ({
      settings: {
        ...settings,
        agentProfile: { queueBehavior: 'interrupt' },
      },
      result: undefined,
    }))

    const settings = await store.read()
    expect(settings.agentProfile.queueBehavior).toBe('interrupt')
    expect(settings.modelProfiles.profiles.map(({ id }) => id)).toEqual(['gateway'])
  })

  it('reports malformed JSON as a corrupt store instead of replacing it', async () => {
    await writeFile(store.filePath, '{not-json', { mode: 0o600 })

    await expect(store.read()).rejects.toMatchObject({
      name: 'RuntimeSettingsError',
      kind: 'store-corrupt',
    })
    expect(await readFile(store.filePath, 'utf8')).toBe('{not-json')
  })

  it('rejects an invalid stored queueBehavior', async () => {
    await writeFile(store.filePath, JSON.stringify({
      version: RUNTIME_SETTINGS_VERSION,
      modelProfiles: { defaultProfileId: null, profiles: [] },
      agentProfile: { queueBehavior: 'later' },
    }), { mode: 0o600 })

    await expect(store.read()).rejects.toBeInstanceOf(RuntimeSettingsError)
    await expect(store.read()).rejects.toMatchObject({ kind: 'invalid-queue-behavior' })
  })

  it('rethrows application errors from transact instead of wrapping them as I/O failures', async () => {
    class DomainError extends Error {
      readonly kind = 'profile-not-ready'
    }

    await expect(store.transact(() => {
      throw new DomainError('profile_not_ready')
    })).rejects.toBeInstanceOf(DomainError)
  })
})
