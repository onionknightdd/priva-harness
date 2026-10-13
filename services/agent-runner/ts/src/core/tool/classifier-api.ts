import type { ClassifierModel, ProviderClassifier } from '@earendil-works/pi-ai'

import type { ClassifierApi, ClassifierRunConfig } from '../resource/model-profile.js'

/** Reuse Pi's protocol implementations for both capability probes and session calls. */
export async function classifierImplementation(api: ClassifierApi): Promise<ProviderClassifier> {
  switch (api) {
    case 'typesafe-system-one': return await import('@earendil-works/pi-ai/api/typesafe-system-one')
    case 'cloudflare-workers-ai-system-one': return await import('@earendil-works/pi-ai/api/cloudflare-workers-ai-system-one')
    case 'llama-cpp-classify': return await import('@earendil-works/pi-ai/api/llama-cpp-classify')
    case 'openai-decisions': return await import('@earendil-works/pi-ai/api/openai-decisions')
  }
}

export function classifierModel(config: ClassifierRunConfig): ClassifierModel<ClassifierApi> {
  return {
    type: 'classifier',
    provider: config.provider,
    api: config.api,
    id: config.modelId,
    name: config.modelId,
    baseUrl: config.baseUrl,
    input: config.api === 'openai-decisions' ? ['text', 'image'] : ['text'],
    // Endpoint configuration does not provide prices. Results report pricingKnown=false.
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 128_000,
  }
}
