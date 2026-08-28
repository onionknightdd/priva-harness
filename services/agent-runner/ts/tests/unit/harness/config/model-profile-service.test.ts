import { describe, expect, it } from 'vitest'

import type {
  ModelEndpointClient,
  ModelProfileStore,
  ModelProfileTransaction,
} from '../../../../src/core/contract/model-profile.js'
import {
  createModelProfile,
  emptyModelProfileCollection,
  GENERATED_MODEL_PROFILE_ID_PATTERN,
  type ModelProfileCollection,
  ModelProfileError,
} from '../../../../src/core/resource/model-profile.js'
import { ModelProfileService } from '../../../../src/harness/config/model-profile-service.js'

describe('ModelProfileService', () => {
  it('creates, updates, selects, and deletes profiles with generated ids', async () => {
    const service = new ModelProfileService(new MemoryModelProfileStore(), endpointClient())
    const first = await service.createProfile(profileInput('first'))
    const second = await service.createProfile(profileInput('second'))

    expect(first.id).toMatch(GENERATED_MODEL_PROFILE_ID_PATTERN)
    expect(second.id).toMatch(GENERATED_MODEL_PROFILE_ID_PATTERN)
    expect(second.id).not.toBe(first.id)
    expect(await service.listProfiles()).toMatchObject({
      defaultProfileId: first.id,
      profiles: [{ id: first.id, label: 'first' }, { id: second.id, label: 'second' }],
    })

    await service.updateProfile(first.id, {
      label: 'First renamed',
      defaultModel: null,
    })
    expect(await service.getProfile(first.id)).toMatchObject({
      label: 'First renamed',
      defaultModel: null,
    })

    await expect(service.setDefaultProfile(second.id)).resolves.toBe(second.id)
    await service.deleteProfile(second.id)
    expect((await service.listProfiles()).defaultProfileId).toBe(first.id)
  })

  it('resolves profile-qualified model references for an agent run snapshot', async () => {
    const service = new ModelProfileService(new MemoryModelProfileStore(), endpointClient())
    const profile = await service.createProfile(profileInput('gateway'))

    await expect(service.resolve(`${profile.id}:ollama:llama3:8b[1M]`)).resolves.toMatchObject({
      profile: { id: profile.id },
      model: 'ollama:llama3:8b[1m]',
      modelId: 'ollama:llama3:8b',
      capabilities: { context: '1m' },
    })
  })

  it('caches a classified image capability and force probing refreshes it', async () => {
    const baseProfile = createModelProfile({ ...profileInput('gateway'), id: 'gateway' })
    const profile = {
      ...baseProfile,
      modelCapabilities: {
        imageUnderstanding: [],
        imageGeneration: [],
        imageEdit: [],
      },
    }
    const store = new MemoryModelProfileStore({
      ...emptyModelProfileCollection(),
      defaultProfileId: profile.id,
      profiles: [profile],
    })
    let probes = 0
    const client = endpointClient(async () => {
      probes += 1
      await delay(10)
      return true
    })
    const service = new ModelProfileService(store, client)

    await expect(service.probeImageCapability('gateway', 'model-a')).resolves.toEqual({
      profileId: 'gateway',
      modelId: 'model-a',
      image: true,
      cached: false,
    })
    await expect(service.probeImageCapability('gateway', 'model-a')).resolves.toEqual({
      profileId: 'gateway',
      modelId: 'model-a',
      image: true,
      cached: true,
    })
    const [first, second] = await Promise.all([
      service.probeImageCapability('gateway', 'model-a', { force: true }),
      service.probeImageCapability('gateway', 'model-a', { force: true }),
    ])

    expect(first).toMatchObject({ image: true, cached: false })
    expect(second).toEqual(first)
    expect(probes).toBe(2)
    expect((await service.getProfile('gateway')).modelCapabilities).toEqual({
      imageUnderstanding: ['model-a'],
      imageGeneration: [],
      imageEdit: [],
    })
  })

  it('caches image capability probe results on the saved profile', async () => {
    const store = new MemoryModelProfileStore()
    const service = new ModelProfileService(store, endpointClient())
    const profile = await service.createProfile(profileInput('gateway'))

    await expect(service.probeSavedModelCapability(
      profile.id,
      {},
      'image-a',
      'image_generation',
    )).resolves.toEqual({
      modelId: 'image-a',
      capability: 'image_generation',
      supported: true,
    })
    await expect(service.probeSavedModelCapability(
      profile.id,
      {},
      'image-a',
      'image_edit',
    )).resolves.toEqual({
      modelId: 'image-a',
      capability: 'image_edit',
      supported: true,
    })

    expect((await service.getProfile(profile.id)).modelCapabilities).toEqual({
      imageUnderstanding: [],
      imageGeneration: ['image-a'],
      imageEdit: ['image-a'],
    })
  })

  it('does not poison the image capability cache when probing is unavailable', async () => {
    const store = new MemoryModelProfileStore()
    const service = new ModelProfileService(store, endpointClient(() => Promise.reject(
      new ModelProfileError('upstream-unavailable', 'model unavailable'),
    )))
    const profile = await service.createProfile(profileInput('gateway'))

    await expect(
      service.probeImageCapability(profile.id, 'model-a', { force: true }),
    ).rejects.toMatchObject({ kind: 'upstream-unavailable' })
    await expect(service.probeSavedModelCapability(
      profile.id,
      {},
      'model-a',
      'image_understanding',
    )).rejects.toMatchObject({ kind: 'upstream-unavailable' })
    expect((await service.getProfile(profile.id)).modelCapabilities).toEqual({
      imageUnderstanding: [],
      imageGeneration: [],
      imageEdit: [],
    })
  })
})

class MemoryModelProfileStore implements ModelProfileStore {
  private collection: ModelProfileCollection

  constructor(collection: ModelProfileCollection = emptyModelProfileCollection()) {
    this.collection = collection
  }

  read(): Promise<ModelProfileCollection> {
    return Promise.resolve(this.collection)
  }

  transact<T>(
    operation: (collection: ModelProfileCollection) => ModelProfileTransaction<T>,
  ): Promise<T> {
    const transaction = operation(this.collection)
    this.collection = transaction.collection
    return Promise.resolve(transaction.result)
  }

  async withCapabilityProbeLock<T>(
    _profileId: string,
    _modelId: string,
    operation: () => Promise<T>,
  ): Promise<T> {
    return await operation()
  }
}

function endpointClient(
  probe: () => Promise<boolean> = () => Promise.resolve(true),
): ModelEndpointClient {
  return {
    listModels() {
      return Promise.resolve([{ id: 'model-a' }])
    },
    async probeModelCapability() {
      return await probe()
    },
  }
}

function profileInput(label: string) {
  return {
    label,
    baseUrl: 'https://api.example.com',
    authToken: 'secret',
    defaultModel: 'model-a',
  }
}

async function delay(milliseconds: number): Promise<void> {
  await new Promise<void>((resolveDelay) => {
    setTimeout(resolveDelay, milliseconds)
  })
}
