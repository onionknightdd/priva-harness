import type {
  ModelEndpointClient,
  ModelProfileCapabilities,
  ModelProfileResolver,
  ModelProfileStore,
} from '../../core/contract/model-profile.js'
import {
  createModelProfile,
  type ImageCapabilityProbeResult,
  type ModelCapabilities,
  type ModelInfo,
  type ModelProfile,
  type ModelProfileCollection,
  type ModelProfileCreateInput,
  ModelProfileError,
  type ModelProfilePatch,
  type ModelProfileSummary,
  normalizeModelId,
  normalizeModelProfileId,
  patchModelProfile,
  type ResolvedModelProfile,
  resolveModelProfile,
  summarizeModelProfile,
} from '../../core/resource/model-profile.js'

export interface ModelProfilesResponse {
  readonly profiles: readonly ModelProfileSummary[]
  readonly defaultProfileId: string | null
}

export class ModelProfileService implements ModelProfileCapabilities, ModelProfileResolver {
  private readonly probeTasks = new Map<string, Promise<ImageCapabilityProbeResult>>()

  constructor(
    private readonly store: ModelProfileStore,
    private readonly endpointClient: ModelEndpointClient,
  ) {}

  async listProfiles(): Promise<ModelProfilesResponse> {
    const collection = await this.store.read()
    return {
      profiles: collection.profiles.map((profile) => summarizeModelProfile(profile)),
      defaultProfileId: collection.defaultProfileId,
    }
  }

  async getProfile(profileId: string): Promise<ModelProfile> {
    const normalizedId = normalizeModelProfileId(profileId)
    return findProfile(await this.store.read(), normalizedId)
  }

  async createProfile(input: ModelProfileCreateInput): Promise<ModelProfileSummary> {
    const profile = createModelProfile(input)
    return await this.store.transact((collection) => {
      if (collection.profiles.some((candidate) => candidate.id === profile.id)) {
        throw new ModelProfileError('profile-id-exists', 'profile_id_exists')
      }
      return {
        collection: {
          ...collection,
          defaultProfileId: collection.defaultProfileId ?? profile.id,
          profiles: [...collection.profiles, profile],
        },
        result: summarizeModelProfile(profile),
      }
    })
  }

  async updateProfile(
    profileId: string,
    patch: ModelProfilePatch,
  ): Promise<ModelProfileSummary> {
    const normalizedId = normalizeModelProfileId(profileId)
    return await this.store.transact((collection) => {
      const current = findProfile(collection, normalizedId)
      const updated = patchModelProfile(current, patch)
      return {
        collection: {
          ...collection,
          profiles: collection.profiles.map((profile) =>
            profile.id === normalizedId ? updated : profile),
        },
        result: summarizeModelProfile(updated),
      }
    })
  }

  async setDefaultProfile(profileId: string): Promise<string> {
    const normalizedId = normalizeModelProfileId(profileId)
    return await this.store.transact((collection) => {
      const profile = findProfile(collection, normalizedId)
      if (
        profile.baseUrl === ''
        || profile.authToken === ''
        || profile.defaultModel === null
      ) {
        throw new ModelProfileError('profile-not-ready', 'profile_not_ready')
      }
      return {
        collection: { ...collection, defaultProfileId: normalizedId },
        result: normalizedId,
      }
    })
  }

  async deleteProfile(profileId: string): Promise<void> {
    const normalizedId = normalizeModelProfileId(profileId)
    await this.store.transact((collection) => {
      findProfile(collection, normalizedId)
      const profiles = collection.profiles.filter((profile) => profile.id !== normalizedId)
      const defaultProfileId = collection.defaultProfileId === normalizedId
        ? profiles[0]?.id ?? null
        : collection.defaultProfileId
      return {
        collection: { ...collection, defaultProfileId, profiles },
        result: undefined,
      }
    })
  }

  async listModels(profileId: string, signal?: AbortSignal): Promise<readonly ModelInfo[]> {
    const profile = await this.getProfile(profileId)
    return await this.endpointClient.listModels(profile, signal)
  }

  async testSavedProfile(
    profileId: string,
    signal?: AbortSignal,
  ): Promise<readonly ModelInfo[]> {
    return await this.listModels(profileId, signal)
  }

  async testDraftProfile(
    input: ModelProfileCreateInput,
    signal?: AbortSignal,
  ): Promise<readonly ModelInfo[]> {
    return await this.endpointClient.listModels(createModelProfile(input), signal)
  }

  async resolve(reference: string | null | undefined): Promise<ResolvedModelProfile> {
    return resolveModelProfile(reference, await this.store.read())
  }

  async probeImageCapability(
    profileId: string,
    modelId: string,
    options: { readonly force?: boolean } = {},
  ): Promise<ImageCapabilityProbeResult> {
    const normalizedProfileId = normalizeModelProfileId(profileId)
    const normalizedModelId = normalizeModelId(modelId)
    const force = options.force === true

    if (!force) {
      const cached = cachedImageCapability(
        await this.getProfile(normalizedProfileId),
        normalizedModelId,
      )
      if (cached !== null) {
        return imageProbeResult(normalizedProfileId, normalizedModelId, cached, true)
      }
    }

    const key = `${normalizedProfileId}\0${normalizedModelId}`
    const existing = this.probeTasks.get(key)
    if (existing !== undefined) return await existing

    const task = this.runImageCapabilityProbe(
      normalizedProfileId,
      normalizedModelId,
      force,
    )
    this.probeTasks.set(key, task)
    try {
      return await task
    } finally {
      if (this.probeTasks.get(key) === task) this.probeTasks.delete(key)
    }
  }

  private async runImageCapabilityProbe(
    profileId: string,
    modelId: string,
    force: boolean,
  ): Promise<ImageCapabilityProbeResult> {
    return await this.store.withCapabilityProbeLock(profileId, modelId, async () => {
      const profile = await this.getProfile(profileId)
      if (!force) {
        const cached = cachedImageCapability(profile, modelId)
        if (cached !== null) return imageProbeResult(profileId, modelId, cached, true)
      }

      let image: boolean
      try {
        image = await this.endpointClient.probeImageCapability(profile, modelId)
      } catch (error) {
        if (isUpstreamError(error)) {
          throw new ModelProfileError(
            'upstream-unavailable',
            'model_unavailable',
            { cause: error },
          )
        }
        throw error
      }
      await this.store.transact((collection) => {
        const currentProfile = findProfile(collection, profileId)
        const currentCapabilities = modelCapabilitiesFor(currentProfile, modelId)
          ?? emptyModelCapabilities()
        const updatedCapabilities: ModelCapabilities = {
          ...currentCapabilities,
          image,
          imageReadTransport: force
            ? null
            : currentCapabilities.imageReadTransport,
        }
        const updatedProfile: ModelProfile = {
          ...currentProfile,
          modelCapabilities: {
            ...currentProfile.modelCapabilities,
            [modelId]: updatedCapabilities,
          },
        }
        return {
          collection: {
            ...collection,
            profiles: collection.profiles.map((candidate) =>
              candidate.id === profileId ? updatedProfile : candidate),
          },
          result: undefined,
        }
      })
      return imageProbeResult(profileId, modelId, image, false)
    })
  }
}

function findProfile(collection: ModelProfileCollection, profileId: string): ModelProfile {
  const profile = collection.profiles.find((candidate) => candidate.id === profileId)
  if (profile === undefined) {
    throw new ModelProfileError('profile-not-found', 'profile_not_found')
  }
  return profile
}

function cachedImageCapability(profile: ModelProfile, modelId: string): boolean | null {
  return modelCapabilitiesFor(profile, modelId)?.image ?? null
}

function modelCapabilitiesFor(
  profile: ModelProfile,
  modelId: string,
): ModelCapabilities | undefined {
  return Object.hasOwn(profile.modelCapabilities, modelId)
    ? profile.modelCapabilities[modelId]
    : undefined
}

function emptyModelCapabilities(): ModelCapabilities {
  return { image: null, imageReadTransport: null }
}

function imageProbeResult(
  profileId: string,
  modelId: string,
  image: boolean,
  cached: boolean,
): ImageCapabilityProbeResult {
  return { profileId, modelId, image, cached }
}

function isUpstreamError(error: unknown): boolean {
  return error instanceof ModelProfileError && [
    'upstream-auth-failed',
    'upstream-invalid-response',
    'upstream-timeout',
    'upstream-unavailable',
  ].includes(error.kind)
}
