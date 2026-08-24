import { describe, expect, it } from 'vitest'

import { buildPiModelsConfig } from '../../../../src/provider/pi/pi-models-config.js'

describe('buildPiModelsConfig', () => {
  it('maps a runner model profile into a native Pi custom provider', () => {
    expect(
      buildPiModelsConfig('https://api.deepseek.com/v1', 'deepseek-v4-flash', 'model-profile'),
    ).toEqual({
      providers: {
        'model-profile': {
          baseUrl: 'https://api.deepseek.com/v1',
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
