import { getSupportedThinkingLevels, type ThinkingLevelMap } from '@earendil-works/pi-ai'
import { getBuiltinModels, getBuiltinProviders } from '@earendil-works/pi-ai/providers/all'
import type { EffortLevel } from '../../core/contract/agent-provider.js'

export interface PiThinkingCapability {
  readonly reasoning: boolean
  readonly thinkingLevelMap?: ThinkingLevelMap
  readonly effortLevels: readonly EffortLevel[]
}

const catalog = getBuiltinProviders().flatMap((provider) => getBuiltinModels(provider))
const unsupported: PiThinkingCapability = { reasoning: false, effortLevels: ['off'] }

/** Profile IDs are upstream model IDs; aliases and conflicting provider metadata are not guessed. */
export function resolvePiThinkingCapability(modelId: string): PiThinkingCapability {
  const matches = catalog.filter((model) => model.id === modelId)
  const capabilities = matches.map((model): PiThinkingCapability => {
    if (!model.reasoning) return unsupported
    const effortLevels = getSupportedThinkingLevels(model)
    return {
      reasoning: true,
      // Profiles use Responses, whose explicit off value is `none`. Omitting it
      // would leave providers such as DeepSeek at their default (thinking on).
      thinkingLevelMap: { ...model.thinkingLevelMap, off: effortLevels.includes('off') ? 'none' : null },
      effortLevels,
    }
  })
  const first = capabilities[0]
  if (!first) return unsupported
  const signature = (capability: PiThinkingCapability) => JSON.stringify([
    capability.reasoning,
    capability.effortLevels.map((level) => [level, capability.thinkingLevelMap?.[level] ?? level]),
  ])
  return capabilities.every((capability) => signature(capability) === signature(first)) ? first : unsupported
}
