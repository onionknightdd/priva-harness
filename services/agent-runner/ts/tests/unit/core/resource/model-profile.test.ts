import { describe, expect, it } from 'vitest'

import {
  createModelProfile,
  emptyModelProfileCollection,
  MODEL_CONTEXT_1M,
  patchModelProfile,
  resolveModelProfile,
  splitModelContext,
} from '../../../../src/core/resource/model-profile.js'

describe('model profile domain', () => {
  it('normalizes profile fields and rejects embedded URL credentials', () => {
    const profile = createModelProfile({
      id: ' Gateway ',
      label: ' Gateway API ',
      baseUrl: 'https://api.example.com/v1/',
      authToken: ' secret ',
      defaultModel: ' model-a ',
    })

    expect(profile).toMatchObject({
      id: 'gateway',
      label: 'Gateway API',
      baseUrl: 'https://api.example.com/v1',
      authToken: 'secret',
      defaultModel: 'model-a',
    })
    expect(() => createModelProfile({
      id: 'unsafe',
      label: 'Unsafe',
      baseUrl: 'https://user:password@example.com',
      authToken: 'secret',
    })).toThrow('base_url must not contain embedded credentials')
  })

  it('uses null to clear the default model while preserving an omitted value', () => {
    const current = createModelProfile({
      id: 'gateway',
      label: 'Gateway',
      baseUrl: 'https://api.example.com',
      authToken: 'secret',
      defaultModel: 'model-a',
    })

    expect(patchModelProfile(current, { label: 'Renamed' })).toMatchObject({
      label: 'Renamed',
      defaultModel: 'model-a',
    })
    expect(patchModelProfile(current, { defaultModel: null })).toMatchObject({
      defaultModel: null,
    })
  })

  it('preserves model colons and normalizes the 1m context suffix', () => {
    const profile = createModelProfile({
      id: 'gateway',
      label: 'Gateway',
      baseUrl: 'https://api.example.com',
      authToken: 'secret',
      defaultModel: 'fallback',
    })
    const collection = {
      ...emptyModelProfileCollection(),
      defaultProfileId: 'gateway',
      profiles: [profile],
    }

    const unqualified = resolveModelProfile('ollama:llama3:8b', collection)
    expect(unqualified.profile.id).toBe('gateway')
    expect(unqualified.modelId).toBe('ollama:llama3:8b')

    const qualified = resolveModelProfile('gateway:ollama:llama3:8b[1M]', collection)
    expect(qualified.model).toBe('ollama:llama3:8b[1m]')
    expect(qualified.modelId).toBe('ollama:llama3:8b')
    expect(qualified.capabilities.context).toBe(MODEL_CONTEXT_1M)
    expect(splitModelContext(qualified.model)).toEqual({
      modelId: 'ollama:llama3:8b',
      context: MODEL_CONTEXT_1M,
    })
  })
})
