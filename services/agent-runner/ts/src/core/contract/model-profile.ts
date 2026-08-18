import type {
  ImageCapabilityProbeResult,
  ModelInfo,
  ModelProfile,
  ModelProfileCollection,
  ResolvedModelProfile,
} from '../resource/model-profile.js'

export interface ModelProfileTransaction<T> {
  readonly collection: ModelProfileCollection
  readonly result: T
}

export interface ModelProfileStore {
  read(): Promise<ModelProfileCollection>

  transact<T>(
    operation: (collection: ModelProfileCollection) => ModelProfileTransaction<T>,
  ): Promise<T>

  withCapabilityProbeLock<T>(
    profileId: string,
    modelId: string,
    operation: () => Promise<T>,
  ): Promise<T>
}

export interface ModelEndpointClient {
  listModels(
    profile: ModelProfile,
    signal?: AbortSignal,
  ): Promise<readonly ModelInfo[]>

  probeImageCapability(
    profile: ModelProfile,
    modelId: string,
    signal?: AbortSignal,
  ): Promise<boolean>
}

export interface ModelProfileResolver {
  resolve(
    reference: string | null | undefined,
  ): Promise<ResolvedModelProfile>
}

export interface ModelProfileCapabilities {
  probeImageCapability(
    profileId: string,
    modelId: string,
    options?: { readonly force?: boolean },
  ): Promise<ImageCapabilityProbeResult>
}
