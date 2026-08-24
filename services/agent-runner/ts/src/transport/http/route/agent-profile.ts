import type { FastifyPluginCallback } from 'fastify'

import type { QueueBehavior } from '../../../core/contract/agent-provider.js'
import type { AgentProfile } from '../../../core/resource/runtime-settings.js'
import type { AgentProfileService } from '../../../harness/config/agent-profile-service.js'
import {
  getAgentProfileSchema,
  patchAgentProfileSchema,
} from '../schema/agent-profile-schema.js'

export const AGENT_PROFILE_ROUTE = '/api/sandbox/agent/profile'

interface AgentProfilePatchBody {
  readonly queue_behavior: QueueBehavior
}

export interface AgentProfileRoutesOptions {
  readonly service: AgentProfileService
}

export const agentProfileRoutes: FastifyPluginCallback<AgentProfileRoutesOptions> = (
  fastify,
  options,
  done,
) => {
  const { service } = options

  fastify.get(
    AGENT_PROFILE_ROUTE,
    { schema: getAgentProfileSchema },
    async () => toAgentProfileResponse(await service.read()),
  )

  fastify.patch<{ Body: AgentProfilePatchBody }>(
    AGENT_PROFILE_ROUTE,
    { schema: patchAgentProfileSchema },
    async (request) => toAgentProfileResponse(
      await service.updateQueueBehavior(request.body.queue_behavior),
    ),
  )

  done()
}

function toAgentProfileResponse(profile: AgentProfile): { queue_behavior: QueueBehavior } {
  return { queue_behavior: profile.queueBehavior }
}
