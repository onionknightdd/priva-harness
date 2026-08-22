import type { HarnessConfig } from '../config/harness-config.js'
import type { ProviderProjectionResult } from '../config/distribution-report.js'
import type { ProjectionPlan } from '../config/projection-plan.js'
import type { ProviderId } from './agent-provider.js'

export interface ConfigProjectionContext {
  readonly harnessHome: string
  readonly cwd: string
}

export interface ProviderConfigAdapter {
  readonly provider: ProviderId
  plan(config: HarnessConfig, context: ConfigProjectionContext): Promise<ProjectionPlan>
  apply(plan: ProjectionPlan): Promise<ProviderProjectionResult>
}
