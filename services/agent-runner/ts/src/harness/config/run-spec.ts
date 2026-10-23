import type { RunMode } from '../../core/resource/session.js'
import { DEFAULT_CONTEXT_WINDOW, type ContextWindow } from '../../core/resource/model-context.js'
import { applyModelContext } from '../../core/resource/model-profile.js'
import { isClaudeEffortLevel, type EffortLevel, type ProviderRunSpec } from '../../core/contract/agent-provider.js'
import {
  providerIdForHarness,
  rewriteProviderBaseUrl,
  type RunHarnessId,
} from '../../core/resource/run-harness.js'
import type { AgentProfileService } from './agent-profile-service.js'
import type { ModelProfileService } from './model-profile-service.js'

export interface RunSpecServices {
  readonly modelProfileService: ModelProfileService
  readonly agentProfileService: AgentProfileService
}

export interface RunSpecRequest {
  readonly harness: RunHarnessId
  readonly model: string
  readonly cwd: string
  readonly runMode?: RunMode
  readonly effort?: EffortLevel
  readonly contextWindow?: ContextWindow
  readonly promptSuggestions?: boolean
  readonly visualizeMode?: boolean
}

/**
 * Resolve the model profile and agent profile behind a client request into
 * the provider-facing run spec. Shared by the WebUI entry points and the
 * Agent API so every driver launches the same configuration.
 */
export async function buildRunSpec(services: RunSpecServices, request: RunSpecRequest): Promise<ProviderRunSpec> {
  if (request.harness === 'claude' && request.effort !== undefined && !isClaudeEffortLevel(request.effort)) {
    throw new Error('Claude effort must be low, medium, high, xhigh, or max')
  }
  const resolved = await services.modelProfileService.resolve(request.model)
  const agentProfile = await services.agentProfileService.read()
  const baseUrl = rewriteProviderBaseUrl(resolved.profile.baseUrl, request.harness)
  const contextWindow = request.contextWindow ?? DEFAULT_CONTEXT_WINDOW
  return {
    cwd: request.cwd,
    ...(request.runMode === undefined ? {} : { runMode: request.runMode }),
    provider: providerIdForHarness(request.harness),
    model: request.harness === 'claude'
      ? applyModelContext(resolved.modelId, contextWindow === 1_000_000 ? '1m' : null)
      : resolved.modelId,
    baseUrl,
    authToken: resolved.profile.authToken,
    profileId: resolved.profile.id,
    contextWindow,
    queueBehavior: agentProfile.queueBehavior,
    ...(request.effort === undefined ? {} : { effort: request.effort }),
    ...(request.promptSuggestions === undefined
      ? {}
      : { promptSuggestions: request.promptSuggestions }),
    ...(request.visualizeMode === undefined ? {} : { visualizeMode: request.visualizeMode }),
    ...(resolved.classifier === undefined ? {} : { classifier: resolved.classifier }),
    imageTools: {
      baseUrl,
      authToken: resolved.profile.authToken,
      imageUnderstandingModel: resolved.profile.imageUnderstandingModel,
      imageGenerationModel: resolved.profile.imageGenerationModel,
      imageEditModel: resolved.profile.imageEditModel,
      modelCapabilities: resolved.profile.modelCapabilities,
    },
  }
}
