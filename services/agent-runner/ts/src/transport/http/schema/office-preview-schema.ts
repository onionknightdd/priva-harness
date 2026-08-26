const officePreviewTags = ['office-preview'] as const

export const createOfficePreviewSessionSchema = {
  tags: officePreviewTags,
  body: {
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
      required: ['document_server_url', 'document'],
      properties: {
        document_server_url: { type: 'string' },
        document: {
          type: 'object',
          additionalProperties: false,
          required: ['fileType', 'key', 'title', 'url'],
          properties: {
            fileType: { type: 'string' },
            key: { type: 'string' },
            title: { type: 'string' },
            url: { type: 'string' },
          },
        },
      },
    },
  },
} as const
