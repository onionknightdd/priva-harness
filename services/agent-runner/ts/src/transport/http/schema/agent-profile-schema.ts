import { QUEUE_BEHAVIORS } from '../../../core/contract/agent-provider.js'

const agentProfileTags = ['agent-profile'] as const

const queueBehaviorSchema = {
  type: 'string',
  enum: QUEUE_BEHAVIORS,
} as const

const agentProfileResponseSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['queue_behavior'],
  properties: {
    queue_behavior: queueBehaviorSchema,
  },
} as const

export const getAgentProfileSchema = {
  tags: agentProfileTags,
  response: {
    200: agentProfileResponseSchema,
  },
} as const

export const patchAgentProfileSchema = {
  tags: agentProfileTags,
  body: {
    type: 'object',
    additionalProperties: false,
    required: ['queue_behavior'],
    properties: {
      queue_behavior: queueBehaviorSchema,
    },
  },
  response: {
    200: agentProfileResponseSchema,
  },
} as const
