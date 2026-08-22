import type { DistributionReport } from '../config/distribution-report.js'
import type { HarnessConfig } from '../config/harness-config.js'
import type { ProviderId } from './agent-provider.js'
import type { ConfigProjectionContext } from './provider-config-adapter.js'

export interface ConfigDistributor {
  reconcile(
    config: HarnessConfig,
    context: ConfigProjectionContext,
    targets?: readonly ProviderId[],
  ): Promise<DistributionReport>
}
