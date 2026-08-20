import { describe, expect, it } from 'vitest'

import {
  BAMBUDDY_PI_PROVIDER_ID,
  buildBambuddyModelsConfig,
} from '../../../../src/provider/pi/pi-models-config.js'

describe('buildBambuddyModelsConfig', () => {
  it('declares an isolated openai-responses provider for the branded Pi agentDir', () => {
    expect(buildBambuddyModelsConfig('https://api.deepseek.com/v1', 'deepseek-v4-flash')).toEqual({
      providers: {
        [BAMBUDDY_PI_PROVIDER_ID]: {
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
