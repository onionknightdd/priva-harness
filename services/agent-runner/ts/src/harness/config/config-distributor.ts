import type { DistributionReport } from '../../core/config/distribution-report.js'
import { failedProjectionResult } from '../../core/config/distribution-report.js'
import type { HarnessConfig } from '../../core/config/harness-config.js'
import type { ProviderId } from '../../core/contract/agent-provider.js'
import type { ConfigDistributor as ConfigDistributorPort } from '../../core/contract/config-distributor.js'
import type {
  ConfigProjectionContext,
  ProviderConfigAdapter,
} from '../../core/contract/provider-config-adapter.js'

export class ConfigDistributor implements ConfigDistributorPort {
  constructor(private readonly adapters: readonly ProviderConfigAdapter[]) {}

  async reconcile(
    config: HarnessConfig,
    context: ConfigProjectionContext,
    targets?: readonly ProviderId[],
  ): Promise<DistributionReport> {
    const selected = targets === undefined
      ? this.adapters
      : this.adapters.filter((adapter) => targets.includes(adapter.provider))
    const results = []
    for (const adapter of selected) {
      try {
        const plan = await adapter.plan(config, context)
        results.push(await adapter.apply(plan))
      } catch (error) {
        results.push(failedProjectionResult(adapter.provider, errorMessage(error)))
      }
    }
    return { results }
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
