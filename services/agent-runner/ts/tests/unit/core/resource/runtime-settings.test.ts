import { describe, expect, it } from 'vitest'

import { createModelProfile } from '../../../../src/core/resource/model-profile.js'
import {
  emptyRuntimeSettings,
  parseRuntimeSettings,
  RUNTIME_SETTINGS_VERSION,
} from '../../../../src/core/resource/runtime-settings.js'

describe('runtime settings domain', () => {
  it('defaults queueBehavior to follow-up', () => {
    expect(emptyRuntimeSettings()).toEqual({
      version: RUNTIME_SETTINGS_VERSION,
      modelProfiles: {
        version: 1,
        defaultProfileId: null,
        profiles: [],
      },
      agentProfile: { queueBehavior: 'follow-up' },
      dataRetention: { auditRetentionDays: 90, toolAuditRetentionDays: 90, factRetentionDays: 365 },
    })
  })

  it('defaults dataRetention when the block is absent and validates it when present', () => {
    const base = {
      version: 1,
      modelProfiles: { defaultProfileId: null, profiles: [] },
      agentProfile: { queueBehavior: 'follow-up' },
    }
    expect(parseRuntimeSettings(base).dataRetention).toEqual({
      auditRetentionDays: 90, toolAuditRetentionDays: 90, factRetentionDays: 365,
    })
    expect(parseRuntimeSettings({
      ...base,
      dataRetention: { auditRetentionDays: 30, toolAuditRetentionDays: 7, factRetentionDays: 400 },
    }).dataRetention).toEqual({ auditRetentionDays: 30, toolAuditRetentionDays: 7, factRetentionDays: 400 })

    for (const dataRetention of [
      { auditRetentionDays: 0, toolAuditRetentionDays: 7, factRetentionDays: 400 },
      { auditRetentionDays: 1.5, toolAuditRetentionDays: 7, factRetentionDays: 400 },
      { auditRetentionDays: 30, toolAuditRetentionDays: 7 },
    ]) {
      try {
        parseRuntimeSettings({ ...base, dataRetention })
        expect.unreachable()
      } catch (error) {
        expect(error).toMatchObject({ kind: 'invalid-data-retention' })
      }
    }
    try {
      parseRuntimeSettings({ ...base, dataRetention: { auditRetentionDays: 1, toolAuditRetentionDays: 1, factRetentionDays: 1, extra: 1 } })
      expect.unreachable()
    } catch (error) {
      expect(error).toMatchObject({ kind: 'store-corrupt' })
    }
  })

  it('parses nested modelProfiles without a collection version field', () => {
    const profile = createModelProfile({
      id: 'gateway',
      label: 'Gateway',
      baseUrl: 'https://api.example.com',
      authToken: 'secret',
    })

    expect(parseRuntimeSettings({
      version: 1,
      modelProfiles: {
        defaultProfileId: profile.id,
        profiles: [profile],
      },
      agentProfile: { queueBehavior: 'steer' },
    })).toMatchObject({
      version: 1,
      modelProfiles: {
        version: 1,
        defaultProfileId: profile.id,
      },
      agentProfile: { queueBehavior: 'steer' },
    })
  })

  it('rejects a nested modelProfiles version field and invalid queueBehavior', () => {
    try {
      parseRuntimeSettings({
        version: 1,
        modelProfiles: {
          version: 1,
          defaultProfileId: null,
          profiles: [],
        },
        agentProfile: { queueBehavior: 'follow-up' },
      })
      expect.unreachable()
    } catch (error) {
      expect(error).toMatchObject({ kind: 'store-corrupt' })
    }

    try {
      parseRuntimeSettings({
        version: 1,
        modelProfiles: { defaultProfileId: null, profiles: [] },
        agentProfile: { queueBehavior: 'later' },
      })
      expect.unreachable()
    } catch (error) {
      expect(error).toMatchObject({ kind: 'invalid-queue-behavior' })
    }
  })
})
