export const BAMBUDDY_PI_PROVIDER_ID = 'bambuddy'

export function buildBambuddyModelsConfig(baseUrl: string, modelId: string) {
  return {
    providers: {
      [BAMBUDDY_PI_PROVIDER_ID]: {
        baseUrl,
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
            id: modelId,
            name: modelId,
            reasoning: false,
            input: ['text'],
            contextWindow: 1_000_000,
            maxTokens: 8192,
          },
        ],
      },
    },
  }
}
