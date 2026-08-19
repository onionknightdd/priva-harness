import type { FastifyPluginCallback } from 'fastify'

import type {
  ModelCapability,
  ModelProfile,
  ModelProfileCreateInput,
  ModelProfilePatch,
  ModelProfileSummary,
} from '../../../core/resource/model-profile.js'
import type { ModelProfileService } from '../../../harness/config/model-profile-service.js'
import {
  createModelProfileSchema,
  deleteModelProfileSchema,
  getModelProfileSchema,
  listModelProfilesSchema,
  listProfileModelsSchema,
  probeDraftModelCapabilitySchema,
  probeSavedModelCapabilitySchema,
  setDefaultModelProfileSchema,
  testDraftModelProfileSchema,
  testSavedModelProfileSchema,
  updateModelProfileSchema,
} from '../schema/model-profile-schema.js'

const MODEL_PROFILE_ROUTE_PREFIX = '/api/sandbox/credentials/profiles'

interface ProfileIdParams {
  readonly profileId: string
}

interface ModelProfileCreateBody {
  readonly label: string
  readonly base_url: string
  readonly auth_token: string
  readonly default_model?: string | null
  readonly image_understanding_model?: string | null
  readonly image_generation_model?: string | null
  readonly image_edit_model?: string | null
}

interface ModelProfilePatchBody {
  readonly label?: string
  readonly base_url?: string
  readonly auth_token?: string
  readonly default_model?: string | null
  readonly image_understanding_model?: string | null
  readonly image_generation_model?: string | null
  readonly image_edit_model?: string | null
}

interface SavedModelProfileTestBody {
  readonly base_url?: string
  readonly auth_token?: string
}

interface ModelCapabilityProbeBody {
  readonly model_id: string
  readonly capability: ModelCapability
}

interface DraftModelCapabilityProbeBody
  extends ModelProfileCreateBody, ModelCapabilityProbeBody {}

interface SavedModelCapabilityProbeBody
  extends SavedModelProfileTestBody, ModelCapabilityProbeBody {}

export interface ModelProfileRoutesOptions {
  readonly service: ModelProfileService
}

export const modelProfileRoutes: FastifyPluginCallback<ModelProfileRoutesOptions> = (
  fastify,
  options,
  done,
) => {
  const { service } = options

  fastify.get(
    MODEL_PROFILE_ROUTE_PREFIX,
    { schema: listModelProfilesSchema },
    async () => {
      const response = await service.listProfiles()
      return {
        profiles: response.profiles.map(toProfileSummaryResponse),
        default_profile_id: response.defaultProfileId,
      }
    },
  )

  fastify.post<{ Body: ModelProfileCreateBody }>(
    MODEL_PROFILE_ROUTE_PREFIX,
    { schema: createModelProfileSchema },
    async (request, reply) => {
      const profile = await service.createProfile(fromCreateBody(request.body))
      return await reply.code(201).send(toProfileSummaryResponse(profile))
    },
  )

  fastify.post<{ Body: DraftModelCapabilityProbeBody }>(
    `${MODEL_PROFILE_ROUTE_PREFIX}/capabilities/probe`,
    { schema: probeDraftModelCapabilitySchema },
    async (request) => toCapabilityProbeResponse(
      await service.probeDraftModelCapability(
        fromCreateBody(request.body),
        request.body.model_id,
        request.body.capability,
      ),
    ),
  )

  fastify.post<{ Body: ModelProfileCreateBody }>(
    `${MODEL_PROFILE_ROUTE_PREFIX}/test`,
    { schema: testDraftModelProfileSchema },
    async (request) => ({
      models: await service.testDraftProfile(fromCreateBody(request.body)),
    }),
  )

  fastify.get<{ Params: ProfileIdParams }>(
    `${MODEL_PROFILE_ROUTE_PREFIX}/:profileId`,
    { schema: getModelProfileSchema },
    async (request) => toProfileResponse(
      await service.getProfile(request.params.profileId),
    ),
  )

  fastify.patch<{ Params: ProfileIdParams; Body: ModelProfilePatchBody }>(
    `${MODEL_PROFILE_ROUTE_PREFIX}/:profileId`,
    { schema: updateModelProfileSchema },
    async (request) => toProfileSummaryResponse(
      await service.updateProfile(
        request.params.profileId,
        fromPatchBody(request.body),
      ),
    ),
  )

  fastify.put<{ Params: ProfileIdParams }>(
    `${MODEL_PROFILE_ROUTE_PREFIX}/:profileId/default`,
    { schema: setDefaultModelProfileSchema },
    async (request) => ({
      default_profile_id: await service.setDefaultProfile(request.params.profileId),
    }),
  )

  fastify.delete<{ Params: ProfileIdParams }>(
    `${MODEL_PROFILE_ROUTE_PREFIX}/:profileId`,
    { schema: deleteModelProfileSchema },
    async (request, reply) => {
      await service.deleteProfile(request.params.profileId)
      return await reply.code(204).send()
    },
  )

  fastify.get<{ Params: ProfileIdParams }>(
    `${MODEL_PROFILE_ROUTE_PREFIX}/:profileId/models`,
    { schema: listProfileModelsSchema },
    async (request) => ({
      models: await service.listModels(request.params.profileId),
    }),
  )

  fastify.post<{ Params: ProfileIdParams; Body: SavedModelProfileTestBody }>(
    `${MODEL_PROFILE_ROUTE_PREFIX}/:profileId/test`,
    { schema: testSavedModelProfileSchema },
    async (request) => ({
      models: await service.testSavedProfile(
        request.params.profileId,
        fromSavedTestBody(request.body),
      ),
    }),
  )

  fastify.post<{
    Params: ProfileIdParams
    Body: SavedModelCapabilityProbeBody
  }>(
    `${MODEL_PROFILE_ROUTE_PREFIX}/:profileId/capabilities/probe`,
    { schema: probeSavedModelCapabilitySchema },
    async (request) => toCapabilityProbeResponse(
      await service.probeSavedModelCapability(
        request.params.profileId,
        fromSavedTestBody(request.body),
        request.body.model_id,
        request.body.capability,
      ),
    ),
  )

  done()
}

function fromCreateBody(body: ModelProfileCreateBody): ModelProfileCreateInput {
  return {
    label: body.label,
    baseUrl: body.base_url,
    authToken: body.auth_token,
    defaultModel: body.default_model ?? null,
    imageUnderstandingModel: body.image_understanding_model ?? null,
    imageGenerationModel: body.image_generation_model ?? null,
    imageEditModel: body.image_edit_model ?? null,
  }
}

function fromPatchBody(body: ModelProfilePatchBody): ModelProfilePatch {
  return {
    ...(body.label === undefined ? {} : { label: body.label }),
    ...(body.base_url === undefined ? {} : { baseUrl: body.base_url }),
    ...(body.auth_token === undefined ? {} : { authToken: body.auth_token }),
    ...(body.default_model === undefined ? {} : { defaultModel: body.default_model }),
    ...(body.image_understanding_model === undefined
      ? {}
      : { imageUnderstandingModel: body.image_understanding_model }),
    ...(body.image_generation_model === undefined
      ? {}
      : { imageGenerationModel: body.image_generation_model }),
    ...(body.image_edit_model === undefined
      ? {}
      : { imageEditModel: body.image_edit_model }),
  }
}

function fromSavedTestBody(
  body: SavedModelProfileTestBody | undefined,
): Pick<ModelProfilePatch, 'baseUrl' | 'authToken'> {
  return {
    ...(body?.base_url === undefined ? {} : { baseUrl: body.base_url }),
    ...(body?.auth_token === undefined ? {} : { authToken: body.auth_token }),
  }
}

function toProfileSummaryResponse(profile: ModelProfileSummary): Record<string, unknown> {
  return {
    ...toProfileResponse(profile),
    auth_token_set: profile.authTokenSet,
    model_count: profile.modelCount,
  }
}

function toProfileResponse(profile: ModelProfile): Record<string, unknown> {
  return {
    id: profile.id,
    label: profile.label,
    base_url: profile.baseUrl,
    auth_token: profile.authToken,
    default_model: profile.defaultModel,
    image_understanding_model: profile.imageUnderstandingModel,
    image_generation_model: profile.imageGenerationModel,
    image_edit_model: profile.imageEditModel,
    model_capabilities: Object.fromEntries(
      Object.entries(profile.modelCapabilities).map(([modelId, capabilities]) => [
        modelId,
        {
          image_understanding: capabilities.imageUnderstanding,
          image_generation: capabilities.imageGeneration,
          image_edit: capabilities.imageEdit,
        },
      ]),
    ),
  }
}

function toCapabilityProbeResponse(result: {
  readonly modelId: string
  readonly capability: ModelCapability
  readonly supported: boolean
}): Record<string, unknown> {
  return {
    model_id: result.modelId,
    capability: result.capability,
    supported: result.supported,
  }
}
