import type { ProviderRunSpec } from '../../core/contract/agent-provider.js'
import {
  PI_RUN_PROVIDER_ID,
  resolveProviderRunEnv,
} from '../../core/resource/provider-run-env.js'

export { PI_RUN_PROVIDER_ID }

export interface PiSessionOptions {
  readonly env: Readonly<Record<string, string>>
  readonly providerId: typeof PI_RUN_PROVIDER_ID
  readonly modelId: string
  readonly modelsConfig: ReturnType<typeof buildPiModelsConfig>
}

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

export function resolvePiSessionOptions(
  spec: Pick<ProviderRunSpec, 'model' | 'baseUrl' | 'authToken'>,
): PiSessionOptions {
  const env = resolveProviderRunEnv({
    provider: 'pi',
    model: spec.model,
    baseUrl: spec.baseUrl,
    authToken: spec.authToken,
  })
  return {
    env,
    providerId: PI_RUN_PROVIDER_ID,
    modelId: spec.model,
    modelsConfig: buildPiModelsConfig(
      env['OPENAI_BASE_URL'] ?? '',
      spec.model,
      env['OPENAI_API_KEY'] ?? '',
    ),
  }
}

export function buildPiModelsConfig(baseUrl: string, modelId: string, apiKey = '') {
  return {
    providers: {
      [PI_RUN_PROVIDER_ID]: {
        ...(baseUrl === '' ? {} : { baseUrl }),
        ...(apiKey === '' ? {} : { apiKey }),
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
