import { describe, expect, it } from 'vitest'

import {
  buildPiModelsConfig,
  PI_RUN_PROVIDER_ID,
  piSessionNeedsModelSwitch,
  resolvePiSessionOptions,
} from '../../../../src/provider/pi/pi-models-config.js'

describe('resolvePiSessionOptions', () => {
  it('builds models.json from the OpenAI profile env', () => {
    expect(
      resolvePiSessionOptions({
        model: 'deepseek-v4-flash',
        baseUrl: 'https://api.deepseek.com/v1',
        authToken: 'secret',
      }),
    ).toEqual({
      env: {
        OPENAI_BASE_URL: 'https://api.deepseek.com/v1',
        OPENAI_API_KEY: 'secret',
      },
      providerId: PI_RUN_PROVIDER_ID,
      modelId: 'deepseek-v4-flash',
      modelsConfig: buildPiModelsConfig(
        'https://api.deepseek.com/v1',
        'deepseek-v4-flash',
        'secret',
      ),
    })
  })
})

describe('buildPiModelsConfig', () => {
  it('maps resolved env onto a stable OpenAI-compatible provider', () => {
    expect(
      buildPiModelsConfig('https://api.deepseek.com/v1', 'deepseek-v4-flash', 'secret'),
    ).toEqual({
      providers: {
        openai: {
          baseUrl: 'https://api.deepseek.com/v1',
          apiKey: 'secret',
          api: 'openai-responses',
          authHeader: true,
          compat: {
            supportsUsageInStreaming: false,
            supportsStore: false,
            supportsLongCacheRetention: false,
            supportsDeveloperRole: false,
          },
          models: [
            {
              id: 'deepseek-v4-flash',
              name: 'deepseek-v4-flash',
              reasoning: false,
              input: ['text'],
              contextWindow: 1_000_000,
              maxTokens: 8192,
            },
          ],
        },
      },
    })
  })
})

describe('piSessionNeedsModelSwitch', () => {
  it('switches when a resumed session still has the previous provider', () => {
    expect(
      piSessionNeedsModelSwitch(
        { provider: 'model-old', id: 'shared-model' },
        PI_RUN_PROVIDER_ID,
        'shared-model',
      ),
    ).toBe(true)
  })

  it('keeps the current model when the selected provider already matches', () => {
    expect(
      piSessionNeedsModelSwitch(
        { provider: PI_RUN_PROVIDER_ID, id: 'shared-model' },
        PI_RUN_PROVIDER_ID,
        'shared-model',
      ),
    ).toBe(false)
  })
})
