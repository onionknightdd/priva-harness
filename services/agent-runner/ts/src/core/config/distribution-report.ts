import type { ProviderId } from '../contract/agent-provider.js'
import type { ProjectionPlan } from './projection-plan.js'

export interface ProviderProjectionResult {
  readonly provider: ProviderId
  readonly applied: number
  readonly skipped: number
  readonly unsupported: readonly string[]
  readonly failed?: string
}

export interface DistributionReport {
  readonly results: readonly ProviderProjectionResult[]
}

export function deferredProjectionResult(plan: ProjectionPlan): ProviderProjectionResult {
  return {
    provider: plan.provider,
    applied: 0,
    skipped: plan.ops.length,
    unsupported: plan.unsupported,
  }
}

export function failedProjectionResult(
  provider: ProviderId,
  message: string,
): ProviderProjectionResult {
  return {
    provider,
    applied: 0,
    skipped: 0,
    unsupported: [],
    failed: message,
  }
}
