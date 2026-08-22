const nullableNumber = {
  anyOf: [{ type: 'number' }, { type: 'null' }],
} as const

const nullableString = {
  anyOf: [{ type: 'string' }, { type: 'null' }],
} as const

const harnessQuery = {
  type: 'string',
  enum: ['claude', 'bambuddy'],
} as const

const lastResponseModelSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['profile_id', 'model', 'observed_at'],
  properties: {
    profile_id: { type: 'string' },
    model: {
      type: 'object',
      additionalProperties: false,
      required: ['id', 'capabilities'],
      properties: {
        id: { type: 'string' },
        capabilities: {
          type: 'object',
          additionalProperties: false,
          required: ['context'],
          properties: {
            context: {
              anyOf: [{ type: 'string', enum: ['1m'] }, { type: 'null' }],
            },
          },
        },
      },
    },
    observed_at: nullableNumber,
  },
} as const

const sessionInfoSchema = {
  type: 'object',
  additionalProperties: false,
  required: [
    'session_id',
    'summary',
    'last_modified',
    'file_size',
    'custom_title',
    'first_prompt',
    'git_branch',
    'cwd',
    'session_source',
    'tag',
    'tags',
    'tag_colors',
    'pinned',
    'archived',
    'parent_session_id',
    'parent_message_uuid',
    'fork_count',
    'origin',
    'scheduler_job_name',
    'last_response_model',
    'run_mode',
  ],
  properties: {
    session_id: { type: 'string' },
    summary: { type: 'string' },
    last_modified: { type: 'number' },
    file_size: { type: 'number' },
    custom_title: nullableString,
    first_prompt: nullableString,
    git_branch: nullableString,
    cwd: nullableString,
    session_source: { type: 'string' },
    tag: nullableString,
    tags: { type: 'array', items: { type: 'string' } },
    tag_colors: {
      type: 'object',
      additionalProperties: { type: 'number' },
    },
    pinned: { type: 'boolean' },
    archived: { type: 'boolean' },
    parent_session_id: nullableString,
    parent_message_uuid: nullableString,
    fork_count: { type: 'number' },
    origin: nullableString,
    scheduler_job_name: nullableString,
    last_response_model: {
      anyOf: [lastResponseModelSchema, { type: 'null' }],
    },
    run_mode: { type: 'string', enum: ['agent', 'code'] },
  },
} as const

const sessionGroupSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['cwd', 'pinned', 'sessions', 'has_more'],
  properties: {
    cwd: { type: 'string' },
    pinned: { type: 'boolean' },
    sessions: { type: 'array', items: sessionInfoSchema },
    has_more: { type: 'boolean' },
  },
} as const

const sessionIdParams = {
  type: 'object',
  additionalProperties: false,
  required: ['session_id'],
  properties: {
    session_id: { type: 'string' },
  },
} as const

const harnessQueryObject = {
  type: 'object',
  additionalProperties: false,
  required: ['harness'],
  properties: {
    harness: harnessQuery,
  },
} as const

const okStatusSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['status'],
  properties: {
    status: { type: 'string', enum: ['ok'] },
  },
} as const

export const listSessionsSchema = {
  querystring: {
    type: 'object',
    additionalProperties: false,
    required: ['harness'],
    properties: {
      harness: harnessQuery,
      cwd: { type: 'string' },
      archived: { type: 'string', enum: ['true', 'false'] },
      limit: { type: 'string' },
      offset: { type: 'string' },
    },
  },
} as const

export const listRunningSessionsSchema = {
  querystring: harnessQueryObject,
  response: {
    200: {
      type: 'object',
      additionalProperties: false,
      required: ['running'],
      properties: {
        running: {
          type: 'array',
          items: {
            type: 'object',
            additionalProperties: false,
            required: [
              'session_id',
              'run_id',
              'status',
              'started_at',
              'last_seq',
              'first_seq',
              'first_user_uuid',
              'pending_permission',
              'run_mode',
              'harness',
            ],
            properties: {
              session_id: nullableString,
              run_id: { type: 'string' },
              status: { type: 'string' },
              started_at: { type: 'number' },
              last_seq: { type: 'number' },
              first_seq: { type: 'number' },
              first_user_uuid: nullableString,
              pending_permission: { type: 'null' },
              run_mode: { type: 'string', enum: ['agent', 'code'] },
              harness: harnessQuery,
            },
          },
        },
      },
    },
  },
} as const

export const sessionMessagesSchema = {
  params: sessionIdParams,
  querystring: {
    type: 'object',
    additionalProperties: false,
    required: ['harness'],
    properties: {
      harness: harnessQuery,
      limit: { type: 'string' },
      offset: { type: 'string' },
    },
  },
} as const

export const sessionRecapSchema = {
  params: sessionIdParams,
  querystring: harnessQueryObject,
  response: {
    200: {
      type: 'object',
      additionalProperties: false,
      required: ['recap', 'turns'],
      properties: {
        recap: nullableString,
        turns: { type: 'number' },
      },
    },
  },
} as const

export const deleteSessionSchema = {
  params: sessionIdParams,
  querystring: harnessQueryObject,
  response: {
    200: okStatusSchema,
  },
} as const

export const renameSessionSchema = {
  params: sessionIdParams,
  querystring: harnessQueryObject,
  body: {
    type: 'object',
    additionalProperties: false,
    required: ['title'],
    properties: {
      title: { type: 'string' },
    },
  },
  response: {
    200: okStatusSchema,
  },
} as const

export const tagSessionSchema = {
  params: sessionIdParams,
  querystring: harnessQueryObject,
  body: {
    type: 'object',
    additionalProperties: false,
    properties: {
      tags: { type: 'array', items: { type: 'string' } },
      tag: { type: 'string' },
    },
  },
  response: {
    200: {
      type: 'object',
      additionalProperties: false,
      required: ['status', 'tags', 'tag_colors'],
      properties: {
        status: { type: 'string', enum: ['ok'] },
        tags: { type: 'array', items: { type: 'string' } },
        tag_colors: {
          type: 'object',
          additionalProperties: { type: 'number' },
        },
      },
    },
  },
} as const

export const addDirsSchema = {
  params: sessionIdParams,
  querystring: harnessQueryObject,
  body: {
    type: 'object',
    additionalProperties: false,
    required: ['add_dirs'],
    properties: {
      add_dirs: { type: 'array', items: { type: 'string' } },
    },
  },
  response: {
    200: {
      type: 'object',
      additionalProperties: false,
      required: ['status', 'add_dirs'],
      properties: {
        status: { type: 'string', enum: ['ok'] },
        add_dirs: { type: 'array', items: { type: 'string' } },
      },
    },
  },
} as const

export const pinSessionSchema = {
  params: sessionIdParams,
  querystring: harnessQueryObject,
  body: {
    type: 'object',
    additionalProperties: false,
    required: ['pinned'],
    properties: {
      pinned: { type: 'boolean' },
    },
  },
  response: {
    200: {
      type: 'object',
      additionalProperties: false,
      required: ['status', 'pinned', 'archived'],
      properties: {
        status: { type: 'string', enum: ['ok'] },
        pinned: { type: 'boolean' },
        archived: { type: 'boolean' },
      },
    },
  },
} as const

export const archiveSessionSchema = {
  params: sessionIdParams,
  querystring: harnessQueryObject,
  body: {
    type: 'object',
    additionalProperties: false,
    required: ['archived'],
    properties: {
      archived: { type: 'boolean' },
    },
  },
  response: {
    200: {
      type: 'object',
      additionalProperties: false,
      required: ['status', 'pinned', 'archived'],
      properties: {
        status: { type: 'string', enum: ['ok'] },
        pinned: { type: 'boolean' },
        archived: { type: 'boolean' },
      },
    },
  },
} as const

export { sessionInfoSchema, sessionGroupSchema }
