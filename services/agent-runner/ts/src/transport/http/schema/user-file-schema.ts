const nullableNumber = {
  anyOf: [{ type: 'number' }, { type: 'null' }],
} as const

const nullableString = {
  anyOf: [{ type: 'string' }, { type: 'null' }],
} as const

const fileEntrySchema = {
  type: 'object',
  additionalProperties: false,
  required: ['path', 'name', 'type', 'size', 'modified', 'permissions'],
  properties: {
    path: { type: 'string' },
    name: { type: 'string' },
    type: { type: 'string', enum: ['file', 'directory'] },
    size: nullableNumber,
    modified: nullableNumber,
    permissions: nullableString,
  },
} as const

export const listDirectorySchema = {
  querystring: {
    type: 'object',
    properties: {
      path: { type: 'string' },
    },
  },
  response: {
    200: {
      type: 'object',
      additionalProperties: false,
      required: ['path', 'parent', 'entries'],
      properties: {
        path: { type: 'string' },
        parent: nullableString,
        entries: { type: 'array', items: fileEntrySchema },
      },
    },
  },
} as const

export const createDirectorySchema = {
  body: {
    type: 'object',
    additionalProperties: false,
    required: ['directory', 'name'],
    properties: {
      directory: { type: 'string' },
      name: { type: 'string' },
    },
  },
  response: {
    201: {
      type: 'object',
      additionalProperties: false,
      required: ['path', 'name'],
      properties: {
        path: { type: 'string' },
        name: { type: 'string' },
      },
    },
  },
} as const

export const deletePathSchema = {
  querystring: {
    type: 'object',
    additionalProperties: false,
    required: ['path'],
    properties: {
      path: { type: 'string', minLength: 1 },
    },
  },
  response: {
    200: {
      type: 'object',
      additionalProperties: false,
      required: ['status', 'path'],
      properties: {
        status: { type: 'string', const: 'ok' },
        path: { type: 'string' },
      },
    },
  },
} as const

const requiredPathQuery = {
  type: 'object',
  required: ['path'],
  properties: {
    path: { type: 'string', minLength: 1 },
  },
} as const

export const downloadFileSchema = {
  querystring: requiredPathQuery,
} as const

export const previewFileSchema = {
  querystring: requiredPathQuery,
  response: {
    200: {
      type: 'object',
      additionalProperties: false,
      required: [
        'path',
        'name',
        'mime_type',
        'size',
        'content',
        'is_binary',
        'preview_url',
      ],
      properties: {
        path: { type: 'string' },
        name: { type: 'string' },
        mime_type: { type: 'string' },
        size: { type: 'integer', minimum: 0 },
        content: nullableString,
        is_binary: { type: 'boolean' },
        preview_url: nullableString,
      },
    },
  },
} as const

export const uploadFileSchema = {
  response: {
    200: {
      type: 'object',
      additionalProperties: false,
      required: ['status', 'path', 'name', 'size'],
      properties: {
        status: { type: 'string', const: 'ok' },
        path: { type: 'string' },
        name: { type: 'string' },
        size: { type: 'integer', minimum: 0 },
      },
    },
  },
} as const
