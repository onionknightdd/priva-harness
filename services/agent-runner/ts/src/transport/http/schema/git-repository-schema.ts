const cwd = { type: 'string', minLength: 1, maxLength: 4096 } as const
const path = { type: 'string', minLength: 1, maxLength: 4096 } as const
const commit = { type: 'string', pattern: '^[a-fA-F0-9]{7,64}$' } as const
const nullableString = { type: ['string', 'null'] } as const
const query = { type: 'object', additionalProperties: false, required: ['cwd'], properties: { cwd } } as const

export const gitRepositorySchema = { querystring: query } as const
export const gitHistorySchema = {
  querystring: { ...query, properties: { cwd, skip: { type: 'integer', minimum: 0, maximum: 1000000, default: 0 }, limit: { type: 'integer', minimum: 1, maximum: 100, default: 50 } } },
} as const
export const gitCommitSchema = {
  querystring: { ...query, required: ['cwd', 'commit'], properties: { cwd, commit } },
} as const
export const gitDiffSchema = {
  querystring: { ...query, required: ['cwd', 'path', 'area'], properties: { cwd, path, area: { type: 'string', enum: ['staged', 'unstaged', 'untracked', 'commit'] }, commit } },
} as const
export const gitActionSchema = {
  body: {
    type: 'object', additionalProperties: false, required: ['cwd', 'expectedBranch', 'expectedCommit', 'action'],
    properties: {
      cwd, expectedBranch: nullableString, expectedCommit: { ...nullableString, pattern: '^[a-fA-F0-9]{40,64}$' },
      action: { type: 'string', enum: ['stage', 'unstage', 'commit', 'switch', 'create-branch', 'set-upstream', 'fetch', 'pull', 'push'] },
      paths: { type: 'array', minItems: 1, maxItems: 10000, uniqueItems: true, items: path },
      message: { type: 'string', minLength: 1, maxLength: 16384 },
      branch: { type: 'string', minLength: 1, maxLength: 1024 },
      startPoint: commit,
      remote: { type: 'string', minLength: 1, maxLength: 1024 },
    },
  },
} as const
