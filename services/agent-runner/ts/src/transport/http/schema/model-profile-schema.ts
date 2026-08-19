const nullableString = {
  anyOf: [{ type: 'string' }, { type: 'null' }],
} as const

const modelProfileTags = ['model-profiles'] as const

const nullableBoolean = {
  anyOf: [{ type: 'boolean' }, { type: 'null' }],
} as const

const modelCapabilitiesSchema = {
  type: 'object',
  additionalProperties: {
    type: 'object',
    additionalProperties: false,
    required: ['image_understanding', 'image_generation', 'image_edit'],
    properties: {
      image_understanding: nullableBoolean,
      image_generation: nullableBoolean,
      image_edit: nullableBoolean,
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
  image_understanding_model: nullableString,
  image_generation_model: nullableString,
  image_edit_model: nullableString,
  model_capabilities: modelCapabilitiesSchema,
} as const

const profileRequired = [
  'id',
  'label',
  'base_url',
  'auth_token',
  'default_model',
  'image_understanding_model',
  'image_generation_model',
  'image_edit_model',
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
  required: ['label', 'base_url', 'auth_token'],
  properties: {
    label: { type: 'string', minLength: 1, maxLength: 120 },
    base_url: { type: 'string', minLength: 1 },
    auth_token: { type: 'string', minLength: 1 },
    default_model: nullableString,
    image_understanding_model: nullableString,
    image_generation_model: nullableString,
    image_edit_model: nullableString,
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

const savedModelProfileTestBodySchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    base_url: { type: 'string', minLength: 1 },
    auth_token: { type: 'string', minLength: 1 },
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
      image_understanding_model: nullableString,
      image_generation_model: nullableString,
      image_edit_model: nullableString,
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
  body: savedModelProfileTestBodySchema,
  response: { 200: modelListResponseSchema },
} as const

const modelCapabilitySchema = {
  type: 'string',
  enum: ['image_understanding', 'image_generation', 'image_edit'],
} as const

const modelCapabilityProbeResponseSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['model_id', 'capability', 'supported'],
  properties: {
    model_id: { type: 'string' },
    capability: modelCapabilitySchema,
    supported: { type: 'boolean' },
  },
} as const

export const probeDraftModelCapabilitySchema = {
  tags: modelProfileTags,
  body: {
    type: 'object',
    additionalProperties: false,
    required: [
      'label',
      'base_url',
      'auth_token',
      'model_id',
      'capability',
    ],
    properties: {
      ...modelProfileCreateBodySchema.properties,
      model_id: { type: 'string', minLength: 1, maxLength: 512 },
      capability: modelCapabilitySchema,
    },
  },
  response: { 200: modelCapabilityProbeResponseSchema },
} as const

export const probeSavedModelCapabilitySchema = {
  tags: modelProfileTags,
  params: profileIdParamsSchema,
  body: {
    type: 'object',
    additionalProperties: false,
    required: ['model_id', 'capability'],
    properties: {
      ...savedModelProfileTestBodySchema.properties,
      model_id: { type: 'string', minLength: 1, maxLength: 512 },
      capability: modelCapabilitySchema,
    },
  },
  response: { 200: modelCapabilityProbeResponseSchema },
} as const
