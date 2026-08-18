const MODEL_PROFILE_API_PREFIX = "/api/sandbox/credentials/profiles"

type ModelCapabilitiesResponse = {
  image: boolean | null
  image_read_transport:
    | "chat_completions"
    | "images_edits"
    | "unsupported"
    | null
}

type ModelProfileSummaryResponse = {
  id: string
  label: string
  base_url: string
  auth_token: string
  default_model: string | null
  model_capabilities: Record<string, ModelCapabilitiesResponse>
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

export type ModelProfileSummary = {
  id: string
  label: string
  baseUrl: string
  defaultModel: string | null
  authTokenSet: boolean
  modelCount: number | null
}

export type ModelProfileCollection = {
  profiles: ModelProfileSummary[]
  defaultProfileId: string | null
}

export type ModelProfileCreateInput = {
  id: string
  label: string
  baseUrl: string
  authToken: string
  defaultModel: string | null
}

export type ModelProfileUpdateInput = {
  label: string
  baseUrl: string
  authToken?: string
  defaultModel: string | null
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
    authTokenSet: profile.auth_token_set,
    modelCount: profile.model_count,
  }
}

function toRequestBody(input: ModelProfileCreateInput) {
  return {
    id: input.id,
    label: input.label,
    base_url: input.baseUrl,
    auth_token: input.authToken,
    default_model: input.defaultModel,
  }
}

export async function listModelProfiles(): Promise<ModelProfileCollection> {
  const response = await requestJson<ModelProfileCollectionResponse>(
    MODEL_PROFILE_API_PREFIX
  )

  return {
    profiles: response.profiles.map(toProfileSummary),
    defaultProfileId: response.default_profile_id,
  }
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

export async function testSavedModelProfile(profileId: string) {
  const response = await requestJson<ModelListResponse>(
    profileEndpoint(profileId, "/test"),
    { method: "POST" }
  )

  return response.models.map((model) => model.id)
}
