import type { FastifyPluginCallback } from 'fastify'

import type {
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
  probeImageCapabilitySchema,
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
  readonly id: string
  readonly label: string
  readonly base_url: string
  readonly auth_token: string
  readonly default_model?: string | null
}

interface ModelProfilePatchBody {
  readonly label?: string
  readonly base_url?: string
  readonly auth_token?: string
  readonly default_model?: string | null
}

interface ImageCapabilityProbeBody {
  readonly model_id: string
}

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

  fastify.post<{ Params: ProfileIdParams }>(
    `${MODEL_PROFILE_ROUTE_PREFIX}/:profileId/test`,
    { schema: testSavedModelProfileSchema },
    async (request) => ({
      models: await service.testSavedProfile(request.params.profileId),
    }),
  )

  fastify.post<{ Params: ProfileIdParams; Body: ImageCapabilityProbeBody }>(
    `${MODEL_PROFILE_ROUTE_PREFIX}/:profileId/image-capability/probe`,
    { schema: probeImageCapabilitySchema },
    async (request) => {
      const result = await service.probeImageCapability(
        request.params.profileId,
        request.body.model_id,
        { force: true },
      )
      return {
        profile_id: result.profileId,
        model_id: result.modelId,
        image: result.image,
        cached: result.cached,
      }
    },
  )

  done()
}

function fromCreateBody(body: ModelProfileCreateBody): ModelProfileCreateInput {
  return {
    id: body.id,
    label: body.label,
    baseUrl: body.base_url,
    authToken: body.auth_token,
    defaultModel: body.default_model ?? null,
  }
}

function fromPatchBody(body: ModelProfilePatchBody): ModelProfilePatch {
  return {
    ...(body.label === undefined ? {} : { label: body.label }),
    ...(body.base_url === undefined ? {} : { baseUrl: body.base_url }),
    ...(body.auth_token === undefined ? {} : { authToken: body.auth_token }),
    ...(body.default_model === undefined ? {} : { defaultModel: body.default_model }),
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
    model_capabilities: Object.fromEntries(
      Object.entries(profile.modelCapabilities).map(([modelId, capabilities]) => [
        modelId,
        {
          image: capabilities.image,
          image_read_transport: capabilities.imageReadTransport,
        },
      ]),
    ),
  }
}
