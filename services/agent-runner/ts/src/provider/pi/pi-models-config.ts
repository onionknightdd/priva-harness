export function piSessionNeedsModelSwitch(
  current: { readonly provider: string; readonly id: string } | undefined,
  nextProvider: string,
  nextModelId: string,
): boolean {
  if (current === undefined) {
    return true
  }
  return current.provider !== nextProvider || current.id !== nextModelId
}

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
