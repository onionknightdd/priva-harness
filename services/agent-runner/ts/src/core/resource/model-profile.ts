export const MODEL_PROFILE_STORE_VERSION = 1
export const MODEL_CONTEXT_1M = '1m'

const MODEL_CONTEXT_1M_SUFFIX = '[1m]'
const MODEL_PROFILE_ID_PATTERN = /^[a-z0-9][a-z0-9._-]{0,62}$/u
const MAX_LABEL_LENGTH = 120
const MAX_MODEL_ID_LENGTH = 512

export type ImageReadTransport =
  | 'chat_completions'
  | 'images_edits'
  | 'unsupported'

export interface ModelCapabilities {
  readonly image: boolean | null
  readonly imageReadTransport: ImageReadTransport | null
}

export interface ModelProfile {
  readonly id: string
  readonly label: string
  readonly baseUrl: string
  readonly authToken: string
  readonly defaultModel: string | null
  readonly modelCapabilities: Readonly<Record<string, ModelCapabilities>>
}

export interface ModelProfileSummary extends ModelProfile {
  readonly authTokenSet: boolean
  readonly modelCount: number | null
}

export interface ModelProfileCollection {
  readonly version: number
  readonly defaultProfileId: string | null
  readonly profiles: readonly ModelProfile[]
}

export interface ModelProfileCreateInput {
  readonly id: string
  readonly label: string
  readonly baseUrl: string
  readonly authToken: string
  readonly defaultModel?: string | null
}

export interface ModelProfilePatch {
  readonly label?: string
  readonly baseUrl?: string
  readonly authToken?: string
  readonly defaultModel?: string | null
}

export interface ModelInfo {
  readonly id: string
}

export interface ResolvedModelProfile {
  readonly profile: ModelProfile
  readonly model: string
  readonly modelId: string
  readonly capabilities: {
    readonly context: typeof MODEL_CONTEXT_1M | null
  }
}

export interface ImageCapabilityProbeResult {
  readonly profileId: string
  readonly modelId: string
  readonly image: boolean
  readonly cached: boolean
}

export type ModelProfileErrorKind =
  | 'auth-token-required'
  | 'default-profile-missing'
  | 'invalid-base-url'
  | 'invalid-label'
  | 'invalid-model-id'
  | 'invalid-model-reference'
  | 'invalid-profile-id'
  | 'io-failure'
  | 'profile-id-exists'
  | 'profile-not-found'
  | 'profile-not-ready'
  | 'store-corrupt'
  | 'upstream-auth-failed'
  | 'upstream-invalid-response'
  | 'upstream-timeout'
  | 'upstream-unavailable'

export class ModelProfileError extends Error {
  readonly kind: ModelProfileErrorKind

  constructor(kind: ModelProfileErrorKind, message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = 'ModelProfileError'
    this.kind = kind
  }
}

export function emptyModelProfileCollection(): ModelProfileCollection {
  return {
    version: MODEL_PROFILE_STORE_VERSION,
    defaultProfileId: null,
    profiles: [],
  }
}

export function normalizeModelProfileId(value: string): string {
  const normalized = value.trim().toLowerCase()
  if (!MODEL_PROFILE_ID_PATTERN.test(normalized)) {
    throw new ModelProfileError(
      'invalid-profile-id',
      'Profile id must match [a-z0-9][a-z0-9._-]{0,62}',
    )
  }
  return normalized
}

export function normalizeModelId(value: string): string {
  const normalized = value.trim()
  if (normalized === '') {
    throw new ModelProfileError('invalid-model-id', 'model_id is required')
  }
  if (normalized.length > MAX_MODEL_ID_LENGTH) {
    throw new ModelProfileError('invalid-model-id', 'model_id is too long')
  }
  return normalized
}

export function createModelProfile(input: ModelProfileCreateInput): ModelProfile {
  return {
    id: normalizeModelProfileId(input.id),
    label: normalizeLabel(input.label),
    baseUrl: normalizeBaseUrl(input.baseUrl),
    authToken: normalizeAuthToken(input.authToken),
    defaultModel: normalizeOptionalModel(input.defaultModel),
    modelCapabilities: {},
  }
}

export function patchModelProfile(
  current: ModelProfile,
  patch: ModelProfilePatch,
): ModelProfile {
  return {
    ...current,
    label: patch.label === undefined ? current.label : normalizeLabel(patch.label),
    baseUrl: patch.baseUrl === undefined
      ? current.baseUrl
      : normalizeBaseUrl(patch.baseUrl),
    authToken: patch.authToken === undefined
      ? current.authToken
      : normalizeAuthToken(patch.authToken),
    defaultModel: patch.defaultModel === undefined
      ? current.defaultModel
      : normalizeOptionalModel(patch.defaultModel),
  }
}

export function summarizeModelProfile(
  profile: ModelProfile,
  modelCount: number | null = null,
): ModelProfileSummary {
  return {
    ...profile,
    authTokenSet: profile.authToken !== '',
    modelCount,
  }
}

export function splitModelContext(value: string | null | undefined): {
  readonly modelId: string | null
  readonly context: typeof MODEL_CONTEXT_1M | null
} {
  const normalized = value?.trim() ?? ''
  if (normalized === '') return { modelId: null, context: null }
  if (normalized.toLowerCase().endsWith(MODEL_CONTEXT_1M_SUFFIX)) {
    const modelId = normalized.slice(0, -MODEL_CONTEXT_1M_SUFFIX.length).trim()
    return {
      modelId: modelId === '' ? null : modelId,
      context: modelId === '' ? null : MODEL_CONTEXT_1M,
    }
  }
  return { modelId: normalized, context: null }
}

export function applyModelContext(
  modelId: string,
  context: typeof MODEL_CONTEXT_1M | null,
): string {
  const parsed = splitModelContext(modelId)
  if (parsed.modelId === null) {
    throw new ModelProfileError('invalid-model-id', 'model_id is required')
  }
  return context === MODEL_CONTEXT_1M || parsed.context === MODEL_CONTEXT_1M
    ? `${parsed.modelId}${MODEL_CONTEXT_1M_SUFFIX}`
    : parsed.modelId
}

export function resolveModelProfile(
  reference: string | null | undefined,
  collection: ModelProfileCollection,
): ResolvedModelProfile {
  const profilesById = new Map(collection.profiles.map((profile) => [profile.id, profile]))
  const defaultProfile = collection.defaultProfileId === null
    ? undefined
    : profilesById.get(collection.defaultProfileId)
  if (defaultProfile === undefined) {
    throw new ModelProfileError('default-profile-missing', 'default_profile_missing')
  }

  const normalizedReference = reference?.trim() ?? ''
  let profile = defaultProfile
  let selectedModel: string | null = normalizedReference || profile.defaultModel

  const separator = normalizedReference.indexOf(':')
  if (separator >= 0) {
    const prefix = normalizedReference.slice(0, separator)
    const qualifiedProfile = profilesById.get(prefix)
    if (qualifiedProfile !== undefined) {
      profile = qualifiedProfile
      const remainder = normalizedReference.slice(separator + 1)
      selectedModel = remainder || profile.defaultModel
      if (selectedModel === null || selectedModel === '') {
        throw new ModelProfileError(
          'invalid-model-reference',
          'invalid_model_reference',
        )
      }
    }
  }

  const { modelId, context } = splitModelContext(selectedModel)
  if (profile.baseUrl === '' || profile.authToken === '' || modelId === null) {
    throw new ModelProfileError('profile-not-ready', 'profile_not_ready')
  }
  return {
    profile,
    model: applyModelContext(modelId, context),
    modelId,
    capabilities: { context },
  }
}

export function parseModelProfileCollection(value: unknown): ModelProfileCollection {
  if (!isRecord(value)) throw corruptStore('Profile store must contain an object')
  if (value['version'] !== MODEL_PROFILE_STORE_VERSION) {
    throw corruptStore(`Unsupported profile store version: ${String(value['version'])}`)
  }
  if (!Array.isArray(value['profiles'])) {
    throw corruptStore('Profile store profiles must be an array')
  }

  const profiles = value['profiles'].map(parseStoredProfile)
  const ids = new Set<string>()
  for (const profile of profiles) {
    if (ids.has(profile.id)) throw corruptStore(`Duplicate profile id: ${profile.id}`)
    ids.add(profile.id)
  }

  const defaultProfileId = value['defaultProfileId']
  if (defaultProfileId !== null && typeof defaultProfileId !== 'string') {
    throw corruptStore('defaultProfileId must be a string or null')
  }
  if (profiles.length === 0 && defaultProfileId !== null) {
    throw corruptStore('An empty profile store cannot have a default profile')
  }
  if (profiles.length > 0 && (defaultProfileId === null || !ids.has(defaultProfileId))) {
    throw corruptStore('defaultProfileId must identify an existing profile')
  }

  return {
    version: MODEL_PROFILE_STORE_VERSION,
    defaultProfileId,
    profiles,
  }
}

function parseStoredProfile(value: unknown): ModelProfile {
  if (!isRecord(value)) throw corruptStore('Every profile must be an object')
  assertOnlyStoredKeys(value, [
    'id',
    'label',
    'baseUrl',
    'authToken',
    'defaultModel',
    'modelCapabilities',
  ], 'Profile')
  try {
    const profile = createModelProfile({
      id: requiredStoredString(value, 'id'),
      label: requiredStoredString(value, 'label'),
      baseUrl: requiredStoredString(value, 'baseUrl'),
      authToken: requiredStoredString(value, 'authToken'),
      defaultModel: optionalStoredString(value, 'defaultModel'),
    })
    return {
      ...profile,
      modelCapabilities: parseStoredCapabilities(value['modelCapabilities']),
    }
  } catch (error) {
    if (error instanceof ModelProfileError && error.kind === 'store-corrupt') throw error
    throw corruptStore('Profile store contains an invalid profile', error)
  }
}

function parseStoredCapabilities(value: unknown): Readonly<Record<string, ModelCapabilities>> {
  if (!isRecord(value)) throw corruptStore('modelCapabilities must be an object')
  const capabilities: (readonly [string, ModelCapabilities])[] = []
  for (const [modelId, rawCapabilities] of Object.entries(value)) {
    normalizeModelId(modelId)
    if (!isRecord(rawCapabilities)) {
      throw corruptStore(`Capabilities for ${modelId} must be an object`)
    }
    const image = rawCapabilities['image']
    const imageReadTransport = rawCapabilities['imageReadTransport']
    if (image !== null && typeof image !== 'boolean') {
      throw corruptStore(`Invalid image capability for ${modelId}`)
    }
    if (!isImageReadTransport(imageReadTransport)) {
      throw corruptStore(`Invalid image read transport for ${modelId}`)
    }
    capabilities.push([modelId, { image, imageReadTransport }])
  }
  return Object.fromEntries(capabilities)
}

function normalizeLabel(value: string): string {
  const normalized = value.trim()
  if (normalized === '' || normalized.length > MAX_LABEL_LENGTH) {
    throw new ModelProfileError(
      'invalid-label',
      `Profile label must contain between 1 and ${MAX_LABEL_LENGTH} characters`,
    )
  }
  return normalized
}

function normalizeBaseUrl(value: string): string {
  const normalized = value.trim().replace(/\/+$/u, '')
  let parsed: URL
  try {
    parsed = new URL(normalized)
  } catch (error) {
    throw new ModelProfileError(
      'invalid-base-url',
      'base_url must be an absolute http(s) URL',
      { cause: error },
    )
  }
  if (
    (parsed.protocol !== 'http:' && parsed.protocol !== 'https:')
    || parsed.hostname === ''
  ) {
    throw new ModelProfileError(
      'invalid-base-url',
      'base_url must be an absolute http(s) URL',
    )
  }
  if (parsed.username !== '' || parsed.password !== '') {
    throw new ModelProfileError(
      'invalid-base-url',
      'base_url must not contain embedded credentials',
    )
  }
  return normalized
}

function normalizeAuthToken(value: string): string {
  const normalized = value.trim()
  if (normalized === '') {
    throw new ModelProfileError('auth-token-required', 'auth_token is required')
  }
  return normalized
}

function normalizeOptionalModel(value: string | null | undefined): string | null {
  const normalized = value?.trim() ?? ''
  return normalized === '' ? null : normalized
}

function requiredStoredString(value: Readonly<Record<string, unknown>>, key: string): string {
  const field = value[key]
  if (typeof field !== 'string') throw corruptStore(`${key} must be a string`)
  return field
}

function optionalStoredString(
  value: Readonly<Record<string, unknown>>,
  key: string,
): string | null {
  const field = value[key]
  if (field === null) return null
  if (typeof field !== 'string') throw corruptStore(`${key} must be a string or null`)
  return field
}

function assertOnlyStoredKeys(
  value: Readonly<Record<string, unknown>>,
  allowedKeys: readonly string[],
  context: string,
): void {
  const allowed = new Set(allowedKeys)
  const unsupported = Object.keys(value).find((key) => !allowed.has(key))
  if (unsupported !== undefined) {
    throw corruptStore(`${context} contains unsupported field: ${unsupported}`)
  }
}

function isImageReadTransport(value: unknown): value is ImageReadTransport | null {
  return value === null
    || value === 'chat_completions'
    || value === 'images_edits'
    || value === 'unsupported'
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function corruptStore(message: string, cause?: unknown): ModelProfileError {
  return cause === undefined
    ? new ModelProfileError('store-corrupt', message)
    : new ModelProfileError('store-corrupt', message, { cause })
}
