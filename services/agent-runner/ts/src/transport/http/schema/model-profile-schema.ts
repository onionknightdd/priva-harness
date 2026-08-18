const nullableString = {
  anyOf: [{ type: 'string' }, { type: 'null' }],
} as const

const modelProfileTags = ['model-profiles'] as const

const imageReadTransportSchema = {
  anyOf: [
    {
      type: 'string',
      enum: ['chat_completions', 'images_edits', 'unsupported'],
    },
    { type: 'null' },
  ],
} as const

const modelCapabilitiesSchema = {
  type: 'object',
  additionalProperties: {
    type: 'object',
    additionalProperties: false,
    required: ['image', 'image_read_transport'],
    properties: {
      image: { anyOf: [{ type: 'boolean' }, { type: 'null' }] },
      image_read_transport: imageReadTransportSchema,
    },
  },
} as const

const removedHarnessModelProperties = {
  opus_model: false,
  sonnet_model: false,
  haiku_model: false,
  vision_model: false,
} as const

const profileProperties = {
  id: { type: 'string' },
  label: { type: 'string' },
  base_url: { type: 'string' },
  auth_token: { type: 'string' },
  default_model: nullableString,
  model_capabilities: modelCapabilitiesSchema,
} as const

const profileRequired = [
  'id',
  'label',
  'base_url',
  'auth_token',
  'default_model',
  'model_capabilities',
] as const

const modelProfileSchema = {
  type: 'object',
  additionalProperties: false,
  required: profileRequired,
  properties: profileProperties,
} as const

const modelProfileSummarySchema = {
  type: 'object',
  additionalProperties: false,
  required: [...profileRequired, 'auth_token_set', 'model_count'],
  properties: {
    ...profileProperties,
    auth_token_set: { type: 'boolean' },
    model_count: { anyOf: [{ type: 'integer', minimum: 0 }, { type: 'null' }] },
  },
} as const

const modelProfileCreateBodySchema = {
  type: 'object',
  additionalProperties: false,
  required: ['id', 'label', 'base_url', 'auth_token'],
  properties: {
    id: { type: 'string', minLength: 1, maxLength: 63 },
    label: { type: 'string', minLength: 1, maxLength: 120 },
    base_url: { type: 'string', minLength: 1 },
    auth_token: { type: 'string', minLength: 1 },
    default_model: nullableString,
    ...removedHarnessModelProperties,
  },
} as const

const profileIdParamsSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['profileId'],
  properties: {
    profileId: { type: 'string', minLength: 1, maxLength: 63 },
  },
} as const

const modelListResponseSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['models'],
  properties: {
    models: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['id'],
        properties: { id: { type: 'string' } },
      },
    },
  },
} as const

export const listModelProfilesSchema = {
  tags: modelProfileTags,
  response: {
    200: {
      type: 'object',
      additionalProperties: false,
      required: ['profiles', 'default_profile_id'],
      properties: {
        profiles: { type: 'array', items: modelProfileSummarySchema },
        default_profile_id: nullableString,
      },
    },
  },
} as const

export const createModelProfileSchema = {
  tags: modelProfileTags,
  body: modelProfileCreateBodySchema,
  response: { 201: modelProfileSummarySchema },
} as const

export const getModelProfileSchema = {
  tags: modelProfileTags,
  params: profileIdParamsSchema,
  response: { 200: modelProfileSchema },
} as const

export const updateModelProfileSchema = {
  tags: modelProfileTags,
  params: profileIdParamsSchema,
  body: {
    type: 'object',
    additionalProperties: false,
    properties: {
      label: { type: 'string', minLength: 1, maxLength: 120 },
      base_url: { type: 'string', minLength: 1 },
      auth_token: { type: 'string', minLength: 1 },
      default_model: nullableString,
      ...removedHarnessModelProperties,
    },
  },
  response: { 200: modelProfileSummarySchema },
} as const

export const setDefaultModelProfileSchema = {
  tags: modelProfileTags,
  params: profileIdParamsSchema,
  response: {
    200: {
      type: 'object',
      additionalProperties: false,
      required: ['default_profile_id'],
      properties: { default_profile_id: { type: 'string' } },
    },
  },
} as const

export const deleteModelProfileSchema = {
  tags: modelProfileTags,
  params: profileIdParamsSchema,
} as const

export const listProfileModelsSchema = {
  tags: modelProfileTags,
  params: profileIdParamsSchema,
  response: { 200: modelListResponseSchema },
} as const

export const testDraftModelProfileSchema = {
  tags: modelProfileTags,
  body: modelProfileCreateBodySchema,
  response: { 200: modelListResponseSchema },
} as const

export const testSavedModelProfileSchema = {
  tags: modelProfileTags,
  params: profileIdParamsSchema,
  response: { 200: modelListResponseSchema },
} as const

export const probeImageCapabilitySchema = {
  tags: modelProfileTags,
  params: profileIdParamsSchema,
  body: {
    type: 'object',
    additionalProperties: false,
    required: ['model_id'],
    properties: {
      model_id: { type: 'string', minLength: 1, maxLength: 512 },
    },
  },
  response: {
    200: {
      type: 'object',
      additionalProperties: false,
      required: ['profile_id', 'model_id', 'image', 'cached'],
      properties: {
        profile_id: { type: 'string' },
        model_id: { type: 'string' },
        image: { type: 'boolean' },
        cached: { type: 'boolean' },
      },
    },
  },
} as const
