import type { HarnessConfig } from '../../../core/config/harness-config.js'
import {
  unhandledResourceSlice,
  type ProjectionPlan,
} from '../../../core/config/projection-plan.js'
import type { ConfigProjectionContext } from '../../../core/contract/provider-config-adapter.js'

export function planPiMcp(
  config: HarnessConfig,
  context: ConfigProjectionContext,
): Pick<ProjectionPlan, 'ops' | 'unsupported'> {
  void context
  return unhandledResourceSlice('mcp', config.mcpServers.length > 0)
}
