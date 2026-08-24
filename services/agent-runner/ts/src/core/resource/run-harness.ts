import type { ProviderId } from '../contract/agent-provider.js'

export const RUN_HARNESS_IDS = ['claude', 'pi'] as const

export type RunHarnessId = (typeof RUN_HARNESS_IDS)[number]

export function isRunHarnessId(value: unknown): value is RunHarnessId {
  return value === 'claude' || value === 'pi'
}

export function rewriteProviderBaseUrl(baseUrl: string, harness: RunHarnessId): string {
  const normalized = baseUrl.trim().replace(/\/+$/u, '')
  const hasV1 = /\/v1$/iu.test(normalized)
  if (harness === 'claude') {
    return hasV1 ? normalized.replace(/\/v1$/iu, '') : normalized
  }
  return hasV1 ? normalized : `${normalized}/v1`
}

export function providerIdForHarness(harness: RunHarnessId): ProviderId {
  return harness
}
