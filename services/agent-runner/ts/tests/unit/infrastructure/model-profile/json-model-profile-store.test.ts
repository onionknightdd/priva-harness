import {
  mkdtemp,
  readFile,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { createModelProfile } from '../../../../src/core/resource/model-profile.js'
import { RUNTIME_SETTINGS_VERSION } from '../../../../src/core/resource/runtime-settings.js'
import { JsonModelProfileStore } from '../../../../src/infrastructure/model-profile/json-model-profile-store.js'
import { JsonRuntimeSettingsStore } from '../../../../src/infrastructure/settings/json-runtime-settings-store.js'
import { createRuntimeConfig } from '../../../../src/runtime-config.js'

describe('JsonModelProfileStore', () => {
  let runtimeHome: string
  let store: JsonModelProfileStore
  let settings: JsonRuntimeSettingsStore

  beforeEach(async () => {
    runtimeHome = await mkdtemp(join(tmpdir(), 'priva-model-profile-store-test-'))
    settings = new JsonRuntimeSettingsStore({
      filePath: createRuntimeConfig(runtimeHome).settingsFilePath,
    })
    store = new JsonModelProfileStore({ settings, runtimeHome })
  })

  afterEach(async () => {
    await rm(runtimeHome, { recursive: true, force: true })
  })

  it('writes modelProfiles into bambuddy.settings.json atomically with private permissions', async () => {
    const profile = profileNamed('default')
    await store.transact((collection) => ({
      collection: {
        ...collection,
        defaultProfileId: profile.id,
        profiles: [profile],
      },
      result: undefined,
    }))

    expect(store.filePath).toBe(join(runtimeHome, 'bambuddy.settings.json'))
    expect(JSON.parse(await readFile(store.filePath, 'utf8'))).toEqual({
      version: RUNTIME_SETTINGS_VERSION,
      modelProfiles: {
        defaultProfileId: 'default',
        profiles: [expect.objectContaining({ id: 'default', authToken: 'secret' })],
      },
      agentProfile: { queueBehavior: 'follow-up' },
    })
    expect((await stat(runtimeHome)).mode & 0o777).toBe(0o700)
    expect((await stat(store.filePath)).mode & 0o777).toBe(0o600)
  })

  it('does not read leftover model-profiles.json', async () => {
    const leftover = profileNamed('legacy')
    await writeFile(join(runtimeHome, 'model-profiles.json'), JSON.stringify({
      version: 1,
      defaultProfileId: leftover.id,
      profiles: [leftover],
    }), { mode: 0o600 })

    const collection = await store.read()
    expect(collection.profiles).toEqual([])
    expect(collection.defaultProfileId).toBeNull()
  })

  it('preserves agentProfile when updating model profiles', async () => {
    await settings.transact((current) => ({
      settings: {
        ...current,
        agentProfile: { queueBehavior: 'interrupt' },
      },
      result: undefined,
    }))

    const profile = profileNamed('gateway')
    await store.transact((collection) => ({
      collection: {
        ...collection,
        defaultProfileId: profile.id,
        profiles: [profile],
      },
      result: undefined,
    }))

    expect(JSON.parse(await readFile(store.filePath, 'utf8'))).toMatchObject({
      agentProfile: { queueBehavior: 'interrupt' },
      modelProfiles: { defaultProfileId: 'gateway' },
    })
  })

  it('serializes concurrent transactions without losing profiles', async () => {
    await Promise.all(
      Array.from({ length: 12 }, async (_, index) => {
        const profile = profileNamed(`profile-${index}`)
        await store.transact((collection) => ({
          collection: {
            ...collection,
            defaultProfileId: collection.defaultProfileId ?? profile.id,
            profiles: [...collection.profiles, profile],
          },
          result: undefined,
        }))
      }),
    )

    const collection = await store.read()
    expect(collection.profiles).toHaveLength(12)
    expect(new Set(collection.profiles.map(({ id }) => id)).size).toBe(12)
  })

  it('serializes concurrent probes for the same profile and model', async () => {
    let active = 0
    let maximumActive = 0
    const operation = async (): Promise<void> => {
      await store.withCapabilityProbeLock('gateway', 'model-a', async () => {
        active += 1
        maximumActive = Math.max(maximumActive, active)
        await delay(20)
        active -= 1
      })
    }

    await Promise.all([operation(), operation(), operation()])

    expect(maximumActive).toBe(1)
  })

  it('reports malformed JSON as a corrupt store instead of silently replacing it', async () => {
    await writeFile(store.filePath, '{not-json', { mode: 0o600 })

    await expect(store.read()).rejects.toMatchObject({ kind: 'store-corrupt' })
    expect(await readFile(store.filePath, 'utf8')).toBe('{not-json')
  })

  it('rejects removed harness-specific fields instead of migrating them', async () => {
    const profile = profileNamed('legacy')
    await writeFile(store.filePath, JSON.stringify({
      version: RUNTIME_SETTINGS_VERSION,
      modelProfiles: {
        defaultProfileId: profile.id,
        profiles: [{ ...profile, opusModel: 'claude-opus' }],
      },
      agentProfile: { queueBehavior: 'follow-up' },
    }), { mode: 0o600 })

    await expect(store.read()).rejects.toMatchObject({ kind: 'store-corrupt' })
  })
})

function profileNamed(id: string) {
  return createModelProfile({
    id,
    label: id,
    baseUrl: 'https://api.example.com',
    authToken: 'secret',
    defaultModel: 'model-a',
  })
}

async function delay(milliseconds: number): Promise<void> {
  await new Promise<void>((resolveDelay) => {
    setTimeout(resolveDelay, milliseconds)
  })
}
