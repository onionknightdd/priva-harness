import { describe, expect, it } from 'vitest'

import {
  allocateUniqueModelProfileId,
  createModelProfile,
  emptyModelProfileCollection,
  generateModelProfileId,
  GENERATED_MODEL_PROFILE_ID_PATTERN,
  MODEL_CONTEXT_1M,
  parseModelProfileCollection,
  patchModelProfile,
  resolveModelProfile,
  splitModelContext,
} from '../../../../src/core/resource/model-profile.js'

describe('model profile domain', () => {
  it('generates profile ids as model-{date}{7-hex}', () => {
    expect(generateModelProfileId(
      new Date(Date.UTC(2026, 7, 19)),
      Uint8Array.from([0xab, 0xcd, 0xef, 0x10]),
    )).toBe('model-20260819abcdef1')
    expect(generateModelProfileId()).toMatch(GENERATED_MODEL_PROFILE_ID_PATTERN)
    expect(allocateUniqueModelProfileId(new Set(['model-20260819abcdef1']))).toMatch(
      GENERATED_MODEL_PROFILE_ID_PATTERN,
    )
  })

  it('rejects stored capabilities that still use the removed image transport shape', () => {
    const profile = createModelProfile({
      id: 'gateway',
      label: 'Gateway',
      baseUrl: 'https://api.example.com',
      authToken: 'secret',
    })

    expect(() => parseModelProfileCollection({
      version: 1,
      defaultProfileId: profile.id,
      profiles: [{
        ...profile,
        modelCapabilities: {
          'model-a': { image: true, imageReadTransport: 'chat_completions' },
        },
      }],
    })).toThrow('Capabilities for model-a contains unsupported field: image')
  })

  it('normalizes profile fields and rejects embedded URL credentials', () => {
    const profile = createModelProfile({
      id: ' Gateway ',
      label: ' Gateway API ',
      baseUrl: 'https://api.example.com/v1/',
      authToken: ' secret ',
      defaultModel: ' model-a ',
      imageUnderstandingModel: ' vision-a ',
      imageGenerationModel: ' image-a ',
      imageEditModel: ' edit-a ',
    })

    expect(profile).toMatchObject({
      id: 'gateway',
      label: 'Gateway API',
      baseUrl: 'https://api.example.com/v1',
      authToken: 'secret',
      defaultModel: 'model-a',
      imageUnderstandingModel: 'vision-a',
      imageGenerationModel: 'image-a',
      imageEditModel: 'edit-a',
    })
    expect(() => createModelProfile({
      id: 'unsafe',
      label: 'Unsafe',
      baseUrl: 'https://user:password@example.com',
      authToken: 'secret',
    })).toThrow('base_url must not contain embedded credentials')
  })

  it('clears optional model selections while preserving omitted values', () => {
    const current = createModelProfile({
      id: 'gateway',
      label: 'Gateway',
      baseUrl: 'https://api.example.com',
      authToken: 'secret',
      defaultModel: 'model-a',
      imageUnderstandingModel: 'vision-a',
    })

    expect(patchModelProfile(current, { label: 'Renamed' })).toMatchObject({
      label: 'Renamed',
      defaultModel: 'model-a',
    })
    expect(patchModelProfile(current, {
      defaultModel: null,
      imageUnderstandingModel: null,
    })).toMatchObject({
      defaultModel: null,
      imageUnderstandingModel: null,
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
