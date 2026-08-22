import {
  deferredProjectionResult,
  type ProviderProjectionResult,
} from '../../src/core/config/distribution-report.js'
import { emptyProjectionPlan, type ProjectionPlan } from '../../src/core/config/projection-plan.js'
import type { ProviderId } from '../../src/core/contract/agent-provider.js'
import type { ProviderConfigAdapter } from '../../src/core/contract/provider-config-adapter.js'

export class FakeConfigAdapter implements ProviderConfigAdapter {
  readonly provider: ProviderId
  readonly planned: ProjectionPlan[] = []
  readonly applied: ProjectionPlan[] = []
  failPlan = false
  failApply = false

  constructor(provider: ProviderId) {
    this.provider = provider
  }

  plan(): Promise<ProjectionPlan> {
    if (this.failPlan) {
      return Promise.reject(new Error(`${this.provider} plan failed`))
    }
    const plan = emptyProjectionPlan(this.provider)
    this.planned.push(plan)
    return Promise.resolve(plan)
  }

  apply(plan: ProjectionPlan): Promise<ProviderProjectionResult> {
    if (this.failApply) {
      return Promise.reject(new Error(`${this.provider} apply failed`))
    }
    this.applied.push(plan)
    return Promise.resolve(deferredProjectionResult(plan))
  }
}
