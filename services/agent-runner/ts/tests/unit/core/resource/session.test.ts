import { describe, expect, it } from 'vitest'

import {
  fallbackTagColorIndex,
  normalizeSessionTags,
  resolveListedResponseModel,
  SessionError,
  uniqueProfileIdByModel,
} from '../../../../src/core/resource/session.js'

describe('session helpers', () => {
  it('normalizes tags with a max of three case-insensitive unique values', () => {
    expect(normalizeSessionTags([' Alpha ', 'alpha', 'beta', 'gamma'])).toEqual([
      'Alpha',
      'beta',
      'gamma',
    ])
    expect(() => normalizeSessionTags(['a', 'b', 'c', 'd'])).toThrow(SessionError)
    expect(normalizeSessionTags(['a', 'b', 'c', 'd'], { truncate: true })).toEqual(['a', 'b', 'c'])
  })

  it('maps a model id to a profile only when ownership is unique', () => {
    const map = uniqueProfileIdByModel([
      profile('p1', 'm1', 'vision-a'),
      profile('p2', 'm2', 'vision-a'),
    ])
    expect(map.get('m1')).toBe('p1')
    expect(map.get('m2')).toBe('p2')
    expect(map.get('vision-a')).toBeUndefined()
  })

  it('prefers profile-sourced last_response_model and does not backfill after a failed stored mapping', () => {
    const unique = new Map([['owned', 'p1']])
    expect(resolveListedResponseModel({
      profileId: 'p1',
      model: { id: 'owned', capabilities: { context: null } },
      modelSource: 'profile',
      observedAt: 1,
    }, { modelId: 'other', observedAt: 2 }, unique)).toEqual({
      profileId: 'p1',
      model: { id: 'owned', capabilities: { context: null } },
      observedAt: 1,
    })

    expect(resolveListedResponseModel({
      profileId: null,
      model: { id: 'gateway-backend', capabilities: { context: null } },
      modelSource: 'transcript',
      observedAt: 1,
    }, { modelId: 'owned', observedAt: 9 }, unique)).toBeNull()

    expect(resolveListedResponseModel(
      null,
      { modelId: 'owned', observedAt: 9 },
      unique,
    )).toEqual({
      profileId: 'p1',
      model: { id: 'owned', capabilities: { context: null } },
      observedAt: 9,
    })
  })

  it('keeps tag color slots stable for the same tag', () => {
    expect(fallbackTagColorIndex('Alpha')).toBe(fallbackTagColorIndex('alpha'))
    expect(fallbackTagColorIndex('Alpha')).toBeGreaterThanOrEqual(0)
    expect(fallbackTagColorIndex('Alpha')).toBeLessThan(300)
  })
})

function profile(
  id: string,
  defaultModel: string,
  imageUnderstandingModel: string,
): {
  id: string
  defaultModel: string
  imageUnderstandingModel: string
  imageGenerationModel: null
  imageEditModel: null
} {
  return {
    id,
    defaultModel,
    imageUnderstandingModel,
    imageGenerationModel: null,
    imageEditModel: null,
  }
}
