const nullableString = { type: ['string', 'null'] } as const

export const gitStatusSchema = {
  querystring: {
    type: 'object',
    additionalProperties: false,
    required: ['cwd'],
    properties: { cwd: { type: 'string', minLength: 1, maxLength: 4096 } },
  },
  response: {
    200: {
      type: 'object',
      additionalProperties: false,
      required: ['cwd', 'root', 'branch', 'commit'],
      properties: {
        cwd: { type: 'string' },
        root: nullableString,
        branch: nullableString,
        commit: nullableString,
      },
    },
  },
} as const
