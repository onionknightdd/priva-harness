export function buildPiModelsConfig(baseUrl: string, modelId: string, providerId: string) {
  return {
    providers: {
      [providerId]: {
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
