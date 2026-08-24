import type { HarnessConfig } from '../../../core/config/harness-config.js'
import {
  deferredProjectionResult,
  type ProviderProjectionResult,
} from '../../../core/config/distribution-report.js'
import {
  mergeProjectionSlices,
  type ProjectionPlan,
} from '../../../core/config/projection-plan.js'
import type {
  ConfigProjectionContext,
  ProviderConfigAdapter,
} from '../../../core/contract/provider-config-adapter.js'

import { planPiMcp } from './mcp.js'
import { planPiSkills } from './skills.js'

export class PiConfigAdapter implements ProviderConfigAdapter {
  readonly provider = 'pi' as const

  plan(
    config: HarnessConfig,
    context: ConfigProjectionContext,
  ): Promise<ProjectionPlan> {
    return Promise.resolve(
      mergeProjectionSlices(this.provider, [
        planPiMcp(config, context),
        planPiSkills(config, context),
      ]),
    )
  }

  apply(plan: ProjectionPlan): Promise<ProviderProjectionResult> {
    return Promise.resolve(deferredProjectionResult(plan))
  }
}
