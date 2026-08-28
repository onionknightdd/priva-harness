export const MODEL_PROFILE_STORE_VERSION = 1
export const MODEL_CONTEXT_1M = '1m'
export const GENERATED_MODEL_PROFILE_ID_PATTERN = /^model-\d{8}[0-9a-f]{7}$/u

const MODEL_CONTEXT_1M_SUFFIX = '[1m]'
const MODEL_PROFILE_ID_PATTERN = /^[a-z0-9][a-z0-9._-]{0,62}$/u
const MAX_LABEL_LENGTH = 120
const MAX_MODEL_ID_LENGTH = 512
const GENERATED_PROFILE_ID_ENTROPY_BYTES = 4
const GENERATED_PROFILE_ID_HASH_LENGTH = 7

export type ModelCapability =
  | 'image_understanding'
  | 'image_generation'
  | 'image_edit'

export type ModelCapabilityCatalogKey =
  | 'imageUnderstanding'
  | 'imageGeneration'
  | 'imageEdit'

export interface ModelCapabilityCatalog {
  readonly imageUnderstanding: readonly string[]
  readonly imageGeneration: readonly string[]
  readonly imageEdit: readonly string[]
}

export interface ModelProfile {
  readonly id: string
  readonly label: string
  readonly baseUrl: string
  readonly authToken: string
  readonly defaultModel: string | null
  readonly imageUnderstandingModel: string | null
  readonly imageGenerationModel: string | null
  readonly imageEditModel: string | null
  readonly modelCapabilities: ModelCapabilityCatalog
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
  readonly label: string
  readonly baseUrl: string
  readonly authToken: string
  readonly defaultModel?: string | null
  readonly imageUnderstandingModel?: string | null
  readonly imageGenerationModel?: string | null
  readonly imageEditModel?: string | null
  readonly modelCapabilities?: ModelCapabilityCatalog
}

export interface ModelProfilePatch {
  readonly label?: string
  readonly baseUrl?: string
  readonly authToken?: string
  readonly defaultModel?: string | null
  readonly imageUnderstandingModel?: string | null
  readonly imageGenerationModel?: string | null
  readonly imageEditModel?: string | null
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

export interface ModelCapabilityProbeResult {
  readonly modelId: string
  readonly capability: ModelCapability
  readonly supported: boolean
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

export function generateModelProfileId(
  now: Date = new Date(),
  entropy: Uint8Array = randomEntropy(GENERATED_PROFILE_ID_ENTROPY_BYTES),
): string {
  const year = String(now.getUTCFullYear()).padStart(4, '0')
  const month = String(now.getUTCMonth() + 1).padStart(2, '0')
  const day = String(now.getUTCDate()).padStart(2, '0')
  const hash = Array.from(
    entropy,
    (byte) => byte.toString(16).padStart(2, '0'),
  ).join('').slice(0, GENERATED_PROFILE_ID_HASH_LENGTH)
  if (hash.length < GENERATED_PROFILE_ID_HASH_LENGTH) {
    throw new ModelProfileError(
      'invalid-profile-id',
      `Generated profile hash requires ${GENERATED_PROFILE_ID_ENTROPY_BYTES} bytes of entropy`,
    )
  }
  return normalizeModelProfileId(`model-${year}${month}${day}${hash}`)
}

export function allocateUniqueModelProfileId(
  existingIds: ReadonlySet<string>,
): string {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const id = generateModelProfileId()
    if (!existingIds.has(id)) return id
  }
  throw new ModelProfileError('profile-id-exists', 'profile_id_exists')
}

export function emptyModelCapabilityCatalog(): ModelCapabilityCatalog {
  return {
    imageUnderstanding: [],
    imageGeneration: [],
    imageEdit: [],
  }
}

export function capabilityCatalogKey(
  capability: ModelCapability,
): ModelCapabilityCatalogKey {
  switch (capability) {
    case 'image_understanding':
      return 'imageUnderstanding'
    case 'image_generation':
      return 'imageGeneration'
    case 'image_edit':
      return 'imageEdit'
  }
}

export function modelIdsForCapability(
  catalog: ModelCapabilityCatalog,
  capability: ModelCapability,
): readonly string[] {
  return catalog[capabilityCatalogKey(capability)]
}

export function catalogHasModel(
  catalog: ModelCapabilityCatalog,
  capability: ModelCapability,
  modelId: string,
): boolean {
  return modelIdsForCapability(catalog, capability).includes(modelId)
}

export function withProbedCapability(
  catalog: ModelCapabilityCatalog,
  capability: ModelCapability,
  modelId: string,
  supported: boolean,
): ModelCapabilityCatalog {
  if (!supported) return catalog
  const key = capabilityCatalogKey(capability)
  if (catalog[key].includes(modelId)) return catalog
  return { ...catalog, [key]: [...catalog[key], modelId] }
}

export function resolveCapabilityModel(
  profile: Pick<
    ModelProfile,
    | 'imageUnderstandingModel'
    | 'imageGenerationModel'
    | 'imageEditModel'
    | 'modelCapabilities'
  >,
  capability: ModelCapability,
): string | null {
  const configured =
    capability === 'image_understanding'
      ? profile.imageUnderstandingModel
      : capability === 'image_generation'
        ? profile.imageGenerationModel
        : profile.imageEditModel
  if (configured !== null && configured !== '') return configured
  return modelIdsForCapability(profile.modelCapabilities, capability)[0] ?? null
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

export function createModelProfile(
  input: ModelProfileCreateInput & { readonly id?: string },
): ModelProfile {
  return {
    id: input.id === undefined
      ? generateModelProfileId()
      : normalizeModelProfileId(input.id),
    label: normalizeLabel(input.label),
    baseUrl: normalizeBaseUrl(input.baseUrl),
    authToken: normalizeAuthToken(input.authToken),
    defaultModel: normalizeOptionalModel(input.defaultModel),
    imageUnderstandingModel: normalizeOptionalModel(input.imageUnderstandingModel),
    imageGenerationModel: normalizeOptionalModel(input.imageGenerationModel),
    imageEditModel: normalizeOptionalModel(input.imageEditModel),
    modelCapabilities: input.modelCapabilities === undefined
      ? emptyModelCapabilityCatalog()
      : normalizeCapabilityCatalog(input.modelCapabilities),
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
    imageUnderstandingModel: patch.imageUnderstandingModel === undefined
      ? current.imageUnderstandingModel
      : normalizeOptionalModel(patch.imageUnderstandingModel),
    imageGenerationModel: patch.imageGenerationModel === undefined
      ? current.imageGenerationModel
      : normalizeOptionalModel(patch.imageGenerationModel),
    imageEditModel: patch.imageEditModel === undefined
      ? current.imageEditModel
      : normalizeOptionalModel(patch.imageEditModel),
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
  const normalizedReference = reference?.trim() ?? ''
  if (normalizedReference === '') {
    throw new ModelProfileError('invalid-model-reference', 'invalid_model_reference')
  }

  const separator = normalizedReference.indexOf(':')
  let profile: ModelProfile
  let selectedModel: string

  if (separator < 0) {
    profile = requireDefaultProfile(collection, profilesById)
    selectedModel = normalizedReference
  } else {
    const prefix = normalizedReference.slice(0, separator)
    const remainder = normalizedReference.slice(separator + 1)
    if (prefix === '' || remainder.trim() === '') {
      throw new ModelProfileError('invalid-model-reference', 'invalid_model_reference')
    }
    let profileId: string
    try {
      profileId = normalizeModelProfileId(prefix)
    } catch {
      throw new ModelProfileError('profile-not-found', 'profile_not_found')
    }
    const qualifiedProfile = profilesById.get(profileId)
    if (qualifiedProfile === undefined) {
      throw new ModelProfileError('profile-not-found', 'profile_not_found')
    }
    profile = qualifiedProfile
    selectedModel = remainder
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

function requireDefaultProfile(
  collection: ModelProfileCollection,
  profilesById: ReadonlyMap<string, ModelProfile>,
): ModelProfile {
  const defaultProfile = collection.defaultProfileId === null
    ? undefined
    : profilesById.get(collection.defaultProfileId)
  if (defaultProfile === undefined) {
    throw new ModelProfileError('default-profile-missing', 'default_profile_missing')
  }
  return defaultProfile
}

export function parseModelProfileCollection(value: unknown): ModelProfileCollection {
  if (!isRecord(value)) throw corruptStore('Profile store must contain an object')
  assertOnlyStoredKeys(value, [
    'defaultProfileId',
    'profiles',
  ], 'Profile store')
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
    'imageUnderstandingModel',
    'imageGenerationModel',
    'imageEditModel',
    'modelCapabilities',
  ], 'Profile')
  try {
    const profile = createModelProfile({
      id: requiredStoredString(value, 'id'),
      label: requiredStoredString(value, 'label'),
      baseUrl: requiredStoredString(value, 'baseUrl'),
      authToken: requiredStoredString(value, 'authToken'),
      defaultModel: optionalStoredString(value, 'defaultModel'),
      imageUnderstandingModel: optionalMissingStoredString(
        value,
        'imageUnderstandingModel',
      ),
      imageGenerationModel: optionalMissingStoredString(value, 'imageGenerationModel'),
      imageEditModel: optionalMissingStoredString(value, 'imageEditModel'),
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

function parseStoredCapabilities(value: unknown): ModelCapabilityCatalog {
  if (value === undefined) return emptyModelCapabilityCatalog()
  if (!isRecord(value)) throw corruptStore('modelCapabilities must be an object')
  const first = Object.values(value)[0]
  if (isRecord(first)) {
    throw corruptStore('modelCapabilities must map capability names to model id lists')
  }
  assertOnlyStoredKeys(value, [
    'imageUnderstanding',
    'imageGeneration',
    'imageEdit',
  ], 'modelCapabilities')
  return {
    imageUnderstanding: parseStoredModelIdList(value['imageUnderstanding'], 'imageUnderstanding'),
    imageGeneration: parseStoredModelIdList(value['imageGeneration'], 'imageGeneration'),
    imageEdit: parseStoredModelIdList(value['imageEdit'], 'imageEdit'),
  }
}

function normalizeCapabilityCatalog(
  catalog: ModelCapabilityCatalog,
): ModelCapabilityCatalog {
  return {
    imageUnderstanding: uniqueModelIds(catalog.imageUnderstanding),
    imageGeneration: uniqueModelIds(catalog.imageGeneration),
    imageEdit: uniqueModelIds(catalog.imageEdit),
  }
}

function uniqueModelIds(values: readonly string[]): readonly string[] {
  const seen = new Set<string>()
  const ids: string[] = []
  for (const value of values) {
    const id = normalizeModelId(value)
    if (seen.has(id)) continue
    seen.add(id)
    ids.push(id)
  }
  return ids
}

function parseStoredModelIdList(value: unknown, key: string): readonly string[] {
  if (value === undefined) return []
  if (!Array.isArray(value)) throw corruptStore(`${key} must be an array of model ids`)
  return value.map((item, index) => {
    if (typeof item !== 'string') {
      throw corruptStore(`${key}[${index}] must be a string`)
    }
    return normalizeModelId(item)
  })
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

function optionalMissingStoredString(
  value: Readonly<Record<string, unknown>>,
  key: string,
): string | null {
  return value[key] === undefined ? null : optionalStoredString(value, key)
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

function randomEntropy(byteCount: number): Uint8Array {
  const bytes = new Uint8Array(byteCount)
  globalThis.crypto.getRandomValues(bytes)
  return bytes
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function corruptStore(message: string, cause?: unknown): ModelProfileError {
  return cause === undefined
    ? new ModelProfileError('store-corrupt', message)
    : new ModelProfileError('store-corrupt', message, { cause })
}
