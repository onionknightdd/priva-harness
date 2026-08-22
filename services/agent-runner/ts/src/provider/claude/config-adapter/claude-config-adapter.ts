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

import { planClaudeMcp } from './mcp.js'
import { planClaudeSkills } from './skills.js'

export class ClaudeConfigAdapter implements ProviderConfigAdapter {
  readonly provider = 'claude' as const

  plan(
    config: HarnessConfig,
    context: ConfigProjectionContext,
  ): Promise<ProjectionPlan> {
    return Promise.resolve(
      mergeProjectionSlices(this.provider, [
        planClaudeMcp(config, context),
        planClaudeSkills(config, context),
      ]),
    )
  }

  apply(plan: ProjectionPlan): Promise<ProviderProjectionResult> {
    return Promise.resolve(deferredProjectionResult(plan))
  }
}
