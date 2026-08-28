const MODEL_PROFILE_API_PREFIX = "/api/sandbox/credentials/profiles"

type ModelCapabilityCatalogResponse = {
  image_understanding: string[]
  image_generation: string[]
  image_edit: string[]
}

type ModelProfileSummaryResponse = {
  id: string
  label: string
  base_url: string
  auth_token: string
  default_model: string | null
  image_understanding_model: string | null
  image_generation_model: string | null
  image_edit_model: string | null
  model_capabilities: ModelCapabilityCatalogResponse
  auth_token_set: boolean
  model_count: number | null
}

type ModelProfileCollectionResponse = {
  profiles: ModelProfileSummaryResponse[]
  default_profile_id: string | null
}

type ModelListResponse = {
  models: Array<{ id: string }>
}

type ErrorResponse = {
  detail?: string
}

export type ModelCapabilityCatalog = {
  imageUnderstanding: string[]
  imageGeneration: string[]
  imageEdit: string[]
}

export type ModelProfileSummary = {
  id: string
  label: string
  baseUrl: string
  defaultModel: string | null
  imageUnderstandingModel: string | null
  imageGenerationModel: string | null
  imageEditModel: string | null
  modelCapabilities: ModelCapabilityCatalog
  authTokenSet: boolean
  modelCount: number | null
}

export type ModelProfileCollection = {
  profiles: ModelProfileSummary[]
  defaultProfileId: string | null
}

export type ModelProfileCreateInput = {
  label: string
  baseUrl: string
  authToken: string
  defaultModel: string | null
  imageUnderstandingModel: string | null
  imageGenerationModel: string | null
  imageEditModel: string | null
  modelCapabilities?: ModelCapabilityCatalog
}

export type ModelProfileUpdateInput = {
  label: string
  baseUrl: string
  authToken?: string
  defaultModel: string | null
  imageUnderstandingModel: string | null
  imageGenerationModel: string | null
  imageEditModel: string | null
}

export type SavedModelProfileTestInput = {
  baseUrl?: string
  authToken?: string
}

export type ModelCapability =
  | "image_understanding"
  | "image_generation"
  | "image_edit"

type ModelCapabilityProbeResponse = {
  model_id: string
  capability: ModelCapability
  supported: boolean
}

export type ModelCapabilityProbeResult = {
  modelId: string
  capability: ModelCapability
  supported: boolean
}

export class ModelProfileApiError extends Error {
  readonly status: number

  constructor(status: number, message: string) {
    super(message)
    this.name = "ModelProfileApiError"
    this.status = status
  }
}

async function requestJson<T>(input: string, init?: RequestInit): Promise<T> {
  const response = await fetch(input, init)

  if (!response.ok) {
    let detail = response.statusText || `HTTP ${response.status}`

    try {
      const error = (await response.json()) as ErrorResponse
      if (error.detail) {
        detail = error.detail
      }
    } catch {
      // Keep the HTTP status text when the response has no JSON body.
    }

    throw new ModelProfileApiError(response.status, detail)
  }

  if (response.status === 204) {
    return undefined as T
  }

  return (await response.json()) as T
}

function profileEndpoint(profileId: string, suffix = "") {
  return `${MODEL_PROFILE_API_PREFIX}/${encodeURIComponent(profileId)}${suffix}`
}

function toProfileSummary(
  profile: ModelProfileSummaryResponse
): ModelProfileSummary {
  return {
    id: profile.id,
    label: profile.label,
    baseUrl: profile.base_url,
    defaultModel: profile.default_model,
    imageUnderstandingModel: profile.image_understanding_model,
    imageGenerationModel: profile.image_generation_model,
    imageEditModel: profile.image_edit_model,
    modelCapabilities: toCapabilityCatalog(profile.model_capabilities),
    authTokenSet: profile.auth_token_set,
    modelCount: profile.model_count,
  }
}

function toRequestBody(input: ModelProfileCreateInput) {
  return {
    label: input.label,
    base_url: input.baseUrl,
    auth_token: input.authToken,
    default_model: input.defaultModel,
    image_understanding_model: input.imageUnderstandingModel,
    image_generation_model: input.imageGenerationModel,
    image_edit_model: input.imageEditModel,
    ...(input.modelCapabilities === undefined
      ? {}
      : {
          model_capabilities: {
            image_understanding: input.modelCapabilities.imageUnderstanding,
            image_generation: input.modelCapabilities.imageGeneration,
            image_edit: input.modelCapabilities.imageEdit,
          },
        }),
  }
}

export async function listModelProfiles(
  signal?: AbortSignal
): Promise<ModelProfileCollection> {
  const response = await requestJson<ModelProfileCollectionResponse>(
    MODEL_PROFILE_API_PREFIX,
    signal ? { signal } : undefined
  )

  return {
    profiles: response.profiles.map(toProfileSummary),
    defaultProfileId: response.default_profile_id,
  }
}

export async function listProfileModels(
  profileId: string,
  signal?: AbortSignal
): Promise<string[]> {
  const response = await requestJson<ModelListResponse>(
    profileEndpoint(profileId, "/models"),
    signal ? { signal } : undefined
  )

  return response.models.map((model) => model.id)
}

export async function createModelProfile(input: ModelProfileCreateInput) {
  const response = await requestJson<ModelProfileSummaryResponse>(
    MODEL_PROFILE_API_PREFIX,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(toRequestBody(input)),
    }
  )

  return toProfileSummary(response)
}

export async function updateModelProfile(
  profileId: string,
  input: ModelProfileUpdateInput
) {
  const response = await requestJson<ModelProfileSummaryResponse>(
    profileEndpoint(profileId),
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        label: input.label,
        base_url: input.baseUrl,
        default_model: input.defaultModel,
        image_understanding_model: input.imageUnderstandingModel,
        image_generation_model: input.imageGenerationModel,
        image_edit_model: input.imageEditModel,
        ...(input.authToken === undefined
          ? {}
          : { auth_token: input.authToken }),
      }),
    }
  )

  return toProfileSummary(response)
}

export function setDefaultModelProfile(profileId: string) {
  return requestJson<{ default_profile_id: string }>(
    profileEndpoint(profileId, "/default"),
    { method: "PUT" }
  )
}

export async function setProfileDefaultModel(
  profileId: string,
  defaultModel: string
): Promise<ModelProfileSummary> {
  const response = await requestJson<ModelProfileSummaryResponse>(
    profileEndpoint(profileId),
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ default_model: defaultModel }),
    }
  )

  return toProfileSummary(response)
}

export function deleteModelProfile(profileId: string) {
  return requestJson<void>(profileEndpoint(profileId), { method: "DELETE" })
}

export async function testDraftModelProfile(input: ModelProfileCreateInput) {
  const response = await requestJson<ModelListResponse>(
    `${MODEL_PROFILE_API_PREFIX}/test`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(toRequestBody(input)),
    }
  )

  return response.models.map((model) => model.id)
}

export async function testSavedModelProfile(
  profileId: string,
  input: SavedModelProfileTestInput = {}
) {
  const response = await requestJson<ModelListResponse>(
    profileEndpoint(profileId, "/test"),
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...(input.baseUrl === undefined ? {} : { base_url: input.baseUrl }),
        ...(input.authToken === undefined
          ? {}
          : { auth_token: input.authToken }),
      }),
    }
  )

  return response.models.map((model) => model.id)
}

export async function probeDraftModelCapability(
  input: ModelProfileCreateInput,
  modelId: string,
  capability: ModelCapability,
  signal?: AbortSignal
): Promise<ModelCapabilityProbeResult> {
  const response = await requestJson<ModelCapabilityProbeResponse>(
    `${MODEL_PROFILE_API_PREFIX}/capabilities/probe`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...toRequestBody(input),
        model_id: modelId,
        capability,
      }),
      signal,
    }
  )

  return toCapabilityProbeResult(response)
}

export async function probeSavedModelCapability(
  profileId: string,
  input: SavedModelProfileTestInput,
  modelId: string,
  capability: ModelCapability,
  signal?: AbortSignal
): Promise<ModelCapabilityProbeResult> {
  const response = await requestJson<ModelCapabilityProbeResponse>(
    profileEndpoint(profileId, "/capabilities/probe"),
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...(input.baseUrl === undefined ? {} : { base_url: input.baseUrl }),
        ...(input.authToken === undefined
          ? {}
          : { auth_token: input.authToken }),
        model_id: modelId,
        capability,
      }),
      signal,
    }
  )

  return toCapabilityProbeResult(response)
}

function toCapabilityProbeResult(
  response: ModelCapabilityProbeResponse
): ModelCapabilityProbeResult {
  return {
    modelId: response.model_id,
    capability: response.capability,
    supported: response.supported,
  }
}

export function emptyModelCapabilityCatalog(): ModelCapabilityCatalog {
  return {
    imageUnderstanding: [],
    imageGeneration: [],
    imageEdit: [],
  }
}

function toCapabilityCatalog(
  raw: ModelCapabilityCatalogResponse | undefined
): ModelCapabilityCatalog {
  return {
    imageUnderstanding: [...(raw?.image_understanding ?? [])],
    imageGeneration: [...(raw?.image_generation ?? [])],
    imageEdit: [...(raw?.image_edit ?? [])],
  }
}

function catalogKey(
  capability: ModelCapability
): keyof ModelCapabilityCatalog {
  switch (capability) {
    case "image_understanding":
      return "imageUnderstanding"
    case "image_generation":
      return "imageGeneration"
    case "image_edit":
      return "imageEdit"
  }
}

export function catalogModelIds(
  catalog: ModelCapabilityCatalog | undefined
): string[] {
  if (catalog === undefined) {
    return []
  }
  return [
    ...new Set([
      ...catalog.imageUnderstanding,
      ...catalog.imageGeneration,
      ...catalog.imageEdit,
    ]),
  ]
}

export function withProbedCapability(
  catalog: ModelCapabilityCatalog,
  capability: ModelCapability,
  modelId: string,
  supported: boolean
): ModelCapabilityCatalog {
  if (!supported) {
    return catalog
  }
  const key = catalogKey(capability)
  if (catalog[key].includes(modelId)) {
    return catalog
  }
  return { ...catalog, [key]: [...catalog[key], modelId] }
}

export function cachedModelCapability(
  catalog: ModelCapabilityCatalog | undefined,
  modelId: string | null | undefined,
  capability: ModelCapability
): boolean | null {
  const normalizedModelId = modelId?.trim() ?? ""
  if (normalizedModelId === "" || catalog === undefined) {
    return null
  }
  return catalog[catalogKey(capability)].includes(normalizedModelId)
    ? true
    : null
}
