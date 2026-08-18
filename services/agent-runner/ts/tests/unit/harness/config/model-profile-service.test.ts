import { describe, expect, it } from 'vitest'

import type {
  ModelEndpointClient,
  ModelProfileStore,
  ModelProfileTransaction,
} from '../../../../src/core/contract/model-profile.js'
import {
  createModelProfile,
  emptyModelProfileCollection,
  type ModelProfileCollection,
  ModelProfileError,
} from '../../../../src/core/resource/model-profile.js'
import { ModelProfileService } from '../../../../src/harness/config/model-profile-service.js'

describe('ModelProfileService', () => {
  it('creates, updates, selects, and deletes profiles with stable default semantics', async () => {
    const service = new ModelProfileService(new MemoryModelProfileStore(), endpointClient())
    await service.createProfile(profileInput('first'))
    await service.createProfile(profileInput('second'))

    expect(await service.listProfiles()).toMatchObject({
      defaultProfileId: 'first',
      profiles: [{ id: 'first' }, { id: 'second' }],
    })

    await service.updateProfile('first', {
      label: 'First renamed',
      defaultModel: null,
    })
    expect(await service.getProfile('first')).toMatchObject({
      label: 'First renamed',
      defaultModel: null,
    })

    await expect(service.setDefaultProfile('second')).resolves.toBe('second')
    await service.deleteProfile('second')
    expect((await service.listProfiles()).defaultProfileId).toBe('first')
    await expect(service.createProfile(profileInput('first'))).rejects.toMatchObject({
      kind: 'profile-id-exists',
    })
  })

  it('resolves profile-qualified model references for an agent run snapshot', async () => {
    const service = new ModelProfileService(new MemoryModelProfileStore(), endpointClient())
    await service.createProfile(profileInput('gateway'))

    await expect(service.resolve('gateway:ollama:llama3:8b[1M]')).resolves.toMatchObject({
      profile: { id: 'gateway' },
      model: 'ollama:llama3:8b[1m]',
      modelId: 'ollama:llama3:8b',
      capabilities: { context: '1m' },
    })
  })

  it('caches a classified image capability and force probing resets its transport', async () => {
    const baseProfile = createModelProfile(profileInput('gateway'))
    const profile = {
      ...baseProfile,
      modelCapabilities: {
        'model-a': { image: false, imageReadTransport: 'unsupported' as const },
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
      image: false,
      cached: true,
    })
    const [first, second] = await Promise.all([
      service.probeImageCapability('gateway', 'model-a', { force: true }),
      service.probeImageCapability('gateway', 'model-a', { force: true }),
    ])

    expect(first).toMatchObject({ image: true, cached: false })
    expect(second).toEqual(first)
    expect(probes).toBe(1)
    expect((await service.getProfile('gateway')).modelCapabilities['model-a']).toEqual({
      image: true,
      imageReadTransport: null,
    })
  })

  it('does not poison the image capability cache when probing is unavailable', async () => {
    const store = new MemoryModelProfileStore()
    const service = new ModelProfileService(store, endpointClient(() => Promise.reject(
      new ModelProfileError('upstream-unavailable', 'model unavailable'),
    )))
    await service.createProfile(profileInput('gateway'))

    await expect(
      service.probeImageCapability('gateway', 'model-a', { force: true }),
    ).rejects.toMatchObject({ kind: 'upstream-unavailable' })
    expect((await service.getProfile('gateway')).modelCapabilities).toEqual({})
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

function profileInput(id: string) {
  return {
    id,
    label: id,
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
