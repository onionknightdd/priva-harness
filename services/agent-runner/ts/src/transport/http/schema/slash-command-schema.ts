const harnessQuery = {
  type: 'string',
  enum: ['claude', 'pi'],
} as const

const slashCommandSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['name', 'description', 'kind', 'origin'],
  properties: {
    name: { type: 'string' },
    description: { type: 'string' },
    argument_hint: { type: 'string' },
    aliases: { type: 'array', items: { type: 'string' } },
    kind: { type: 'string', enum: ['command', 'skill'] },
    origin: { type: 'string', enum: ['builtin', 'user', 'project'] },
  },
} as const

export const listSlashCommandsSchema = {
  querystring: {
    type: 'object',
    additionalProperties: false,
    required: ['harness'],
    properties: {
      harness: harnessQuery,
      cwd: { type: 'string' },
    },
  },
  response: {
    200: {
      type: 'object',
      additionalProperties: false,
      required: ['harness', 'cwd', 'commands'],
      properties: {
        harness: harnessQuery,
        cwd: { type: 'string' },
        commands: {
          type: 'array',
          items: slashCommandSchema,
        },
      },
    },
  },
} as const
