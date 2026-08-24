import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { FastifyInstance } from 'fastify'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import type { ModelEndpointClient } from '../../../../src/core/contract/model-profile.js'
import {
  GENERATED_MODEL_PROFILE_ID_PATTERN,
  type ModelCapability,
  type ModelProfile,
  ModelProfileError,
} from '../../../../src/core/resource/model-profile.js'
import { NodeUserFileSystem } from '../../../../src/infrastructure/filesystem/node-user-file-system.js'
import { buildHttpServer } from '../../../../src/transport/http/server.js'
import { createTestAgentServices } from '../../../support/model-profile.js'

describe('/api/sandbox/credentials/profiles', () => {
  let testRoot: string
  let server: FastifyInstance
  let endpointClient: RecordingEndpointClient

  beforeEach(async () => {
    testRoot = await mkdtemp(join(tmpdir(), 'priva-model-profile-http-test-'))
    const workspace = join(testRoot, 'workspace')
    await mkdir(workspace)
    endpointClient = new RecordingEndpointClient()
    const services = createTestAgentServices(
      join(testRoot, 'runtime'),
      endpointClient,
    )
    server = buildHttpServer({
      userFileSystem: new NodeUserFileSystem({ initialDirectory: workspace }),
      modelProfileService: services.modelProfileService,
      agentProfileService: services.agentProfileService,
    })
    await server.ready()
  })

  afterEach(async () => {
    await server.close()
    await rm(testRoot, { recursive: true, force: true })
  })

  it('provides unauthenticated CRUD and preserves the public snake_case schema', async () => {
    const createResponse = await server.inject({
      method: 'POST',
      url: '/api/sandbox/credentials/profiles',
      payload: {
        ...profilePayload('gateway'),
        image_understanding_model: 'vision-a',
        image_generation_model: 'image-a',
        image_edit_model: 'edit-a',
      },
    })
    expect(createResponse.statusCode).toBe(201)
    const createdId = generatedProfileId(createResponse.json())
    expect(createResponse.json()).toEqual({
      id: createdId,
      label: 'gateway',
      base_url: 'https://api.example.com',
      auth_token: 'secret',
      auth_token_set: true,
      default_model: 'model-a',
      image_understanding_model: 'vision-a',
      image_generation_model: 'image-a',
      image_edit_model: 'edit-a',
      model_capabilities: {},
      model_count: null,
    })

    const listResponse = await server.inject({
      method: 'GET',
      url: '/api/sandbox/credentials/profiles',
    })
    expect(listResponse.statusCode).toBe(200)
    expect(listResponse.json()).toMatchObject({
      default_profile_id: createdId,
      profiles: [{ id: createdId, auth_token_set: true }],
    })

    const updateResponse = await server.inject({
      method: 'PATCH',
      url: `/api/sandbox/credentials/profiles/${createdId}`,
      payload: {
        label: 'Renamed',
        default_model: null,
        image_edit_model: 'edit-b',
      },
    })
    expect(updateResponse.statusCode).toBe(200)
    expect(updateResponse.json()).toMatchObject({
      label: 'Renamed',
      default_model: null,
      image_understanding_model: 'vision-a',
      image_generation_model: 'image-a',
      image_edit_model: 'edit-b',
    })

    const getResponse = await server.inject({
      method: 'GET',
      url: `/api/sandbox/credentials/profiles/${createdId}`,
    })
    expect(getResponse.statusCode).toBe(200)
    expect(getResponse.json()).not.toHaveProperty('auth_token_set')

    const secondCreate = await server.inject({
      method: 'POST',
      url: '/api/sandbox/credentials/profiles',
      payload: profilePayload('gateway'),
    })
    expect(secondCreate.statusCode).toBe(201)
    const secondId = generatedProfileId(secondCreate.json())
    expect(secondId).not.toBe(createdId)

    const clientSuppliedId = await server.inject({
      method: 'POST',
      url: '/api/sandbox/credentials/profiles',
      payload: { ...profilePayload('custom'), id: 'custom-id' },
    })
    expect(clientSuppliedId.statusCode).toBe(201)
    expect(generatedProfileId(clientSuppliedId.json())).not.toBe('custom-id')
  })

  it('rejects harness-specific fixed model slots', async () => {
    const response = await server.inject({
      method: 'POST',
      url: '/api/sandbox/credentials/profiles',
      payload: {
        ...profilePayload('claude-specific'),
        opus_model: 'claude-opus',
      },
    })

    expect(response.statusCode).toBe(422)
  })

  it('lists and tests models using saved and unsaved profile values', async () => {
    const savedId = await createProfile(server, 'saved')

    const listResponse = await server.inject({
      method: 'GET',
      url: `/api/sandbox/credentials/profiles/${savedId}/models`,
    })
    expect(listResponse.statusCode).toBe(200)
    expect(listResponse.json()).toEqual({ models: [{ id: 'model-a' }, { id: 'model-b' }] })

    const savedTestResponse = await server.inject({
      method: 'POST',
      url: `/api/sandbox/credentials/profiles/${savedId}/test`,
      payload: {},
    })
    expect(savedTestResponse.statusCode).toBe(200)

    const savedDraftTestResponse = await server.inject({
      method: 'POST',
      url: `/api/sandbox/credentials/profiles/${savedId}/test`,
      payload: {
        base_url: 'https://changed.example.com/v1',
        auth_token: 'changed-secret',
      },
    })
    expect(savedDraftTestResponse.statusCode).toBe(200)
    expect(endpointClient.listedProfiles.at(-1)).toMatchObject({
      id: savedId,
      baseUrl: 'https://changed.example.com/v1',
      authToken: 'changed-secret',
    })

    const savedBaseUrlTestResponse = await server.inject({
      method: 'POST',
      url: `/api/sandbox/credentials/profiles/${savedId}/test`,
      payload: { base_url: 'https://stored-key.example.com/v1' },
    })
    expect(savedBaseUrlTestResponse.statusCode).toBe(200)
    expect(endpointClient.listedProfiles.at(-1)).toMatchObject({
      id: savedId,
      baseUrl: 'https://stored-key.example.com/v1',
      authToken: 'secret',
    })

    const draftTestResponse = await server.inject({
      method: 'POST',
      url: '/api/sandbox/credentials/profiles/test',
      payload: {
        ...profilePayload('draft'),
        base_url: 'https://draft.example.com/v1',
        auth_token: 'draft-secret',
      },
    })
    expect(draftTestResponse.statusCode).toBe(200)
    const listedDraft = endpointClient.listedProfiles.at(-1)
    expect(listedDraft?.id).toMatch(GENERATED_MODEL_PROFILE_ID_PATTERN)
    expect(listedDraft).toMatchObject({
      baseUrl: 'https://draft.example.com/v1',
      authToken: 'draft-secret',
    })
  })

  it('probes draft and saved multimodal capabilities with current credentials', async () => {
    const profileId = await createProfile(server, 'gateway')

    const savedProbe = await server.inject({
      method: 'POST',
      url: `/api/sandbox/credentials/profiles/${profileId}/capabilities/probe`,
      payload: {
        base_url: 'https://changed.example.com/v1',
        auth_token: 'changed-secret',
        model_id: 'image-a',
        capability: 'image_generation',
      },
    })
    expect(savedProbe.statusCode).toBe(200)
    expect(savedProbe.json()).toEqual({
      model_id: 'image-a',
      capability: 'image_generation',
      supported: true,
    })
    expect(endpointClient.probes.at(-1)).toMatchObject({
      profile: {
        id: profileId,
        baseUrl: 'https://changed.example.com/v1',
        authToken: 'changed-secret',
      },
      modelId: 'image-a',
      capability: 'image_generation',
    })

    const cached = await server.inject({
      method: 'GET',
      url: `/api/sandbox/credentials/profiles/${profileId}`,
    })
    expect(cached.json()).toMatchObject({
      model_capabilities: {
        'image-a': {
          image_understanding: null,
          image_generation: true,
          image_edit: null,
        },
      },
    })

    const draftProbe = await server.inject({
      method: 'POST',
      url: '/api/sandbox/credentials/profiles/capabilities/probe',
      payload: {
        ...profilePayload('draft'),
        base_url: 'https://draft.example.com/v1',
        auth_token: 'draft-secret',
        model_id: 'edit-a',
        capability: 'image_edit',
      },
    })
    expect(draftProbe.statusCode).toBe(200)
    expect(draftProbe.json()).toEqual({
      model_id: 'edit-a',
      capability: 'image_edit',
      supported: true,
    })
    const draftProbeRecord = endpointClient.probes.at(-1)
    expect(draftProbeRecord?.profile.id).toMatch(GENERATED_MODEL_PROFILE_ID_PATTERN)
    expect(draftProbeRecord).toMatchObject({
      profile: {
        baseUrl: 'https://draft.example.com/v1',
        authToken: 'draft-secret',
      },
      modelId: 'edit-a',
      capability: 'image_edit',
    })
    expect((await server.inject({
      method: 'GET',
      url: `/api/sandbox/credentials/profiles/${profileId}`,
    })).json()).toMatchObject({
      model_capabilities: {
        'image-a': {
          image_generation: true,
        },
      },
    })
  })

  it('returns the upstream error when multimodal probing fails', async () => {
    const profileId = await createProfile(server, 'gateway')
    endpointClient.probeError = new ModelProfileError(
      'upstream-auth-failed',
      'authentication failed',
    )

    const probe = await server.inject({
      method: 'POST',
      url: `/api/sandbox/credentials/profiles/${profileId}/capabilities/probe`,
      payload: {
        model_id: 'model-a',
        capability: 'image_understanding',
      },
    })
    expect(probe.statusCode).toBe(400)
    expect(probe.json()).toEqual({ detail: 'authentication failed' })
    expect((await server.inject({
      method: 'GET',
      url: `/api/sandbox/credentials/profiles/${profileId}`,
    })).json()).toMatchObject({ model_capabilities: {} })
  })

  it('requires a ready profile before changing the default and promotes on deletion', async () => {
    const firstId = await createProfile(server, 'first')
    const secondId = await createProfile(server, 'second', null)

    const notReady = await server.inject({
      method: 'PUT',
      url: `/api/sandbox/credentials/profiles/${secondId}/default`,
      payload: {},
    })
    expect(notReady.statusCode).toBe(409)
    expect(notReady.json()).toEqual({ detail: 'profile_not_ready' })

    await server.inject({
      method: 'PATCH',
      url: `/api/sandbox/credentials/profiles/${secondId}`,
      payload: { default_model: 'model-b' },
    })
    const setDefault = await server.inject({
      method: 'PUT',
      url: `/api/sandbox/credentials/profiles/${secondId}/default`,
    })
    expect(setDefault.json()).toEqual({ default_profile_id: secondId })

    const deleted = await server.inject({
      method: 'DELETE',
      url: `/api/sandbox/credentials/profiles/${secondId}`,
    })
    expect(deleted.statusCode).toBe(204)
    const listing = await server.inject({
      method: 'GET',
      url: '/api/sandbox/credentials/profiles',
    })
    expect(listing.json()).toMatchObject({ default_profile_id: firstId })
  })
})

class RecordingEndpointClient implements ModelEndpointClient {
  readonly listedProfiles: ModelProfile[] = []
  readonly probes: {
    readonly profile: ModelProfile
    readonly modelId: string
    readonly capability: ModelCapability
  }[] = []
  probeError: Error | undefined

  listModels(profile: ModelProfile) {
    this.listedProfiles.push(profile)
    return Promise.resolve([{ id: 'model-a' }, { id: 'model-b' }])
  }

  probeModelCapability(
    profile: ModelProfile,
    modelId: string,
    capability: ModelCapability,
  ) {
    this.probes.push({ profile, modelId, capability })
    if (this.probeError !== undefined) return Promise.reject(this.probeError)
    return Promise.resolve(true)
  }
}

function profilePayload(label: string, defaultModel: string | null = 'model-a') {
  return {
    label,
    base_url: 'https://api.example.com',
    auth_token: 'secret',
    default_model: defaultModel,
  }
}

async function createProfile(
  server: FastifyInstance,
  label: string,
  defaultModel: string | null = 'model-a',
): Promise<string> {
  const response = await server.inject({
    method: 'POST',
    url: '/api/sandbox/credentials/profiles',
    payload: profilePayload(label, defaultModel),
  })
  expect(response.statusCode).toBe(201)
  return generatedProfileId(response.json())
}

function generatedProfileId(body: unknown): string {
  if (typeof body !== 'object' || body === null || !('id' in body)) {
    throw new Error('Create response is missing id')
  }
  const { id } = body
  if (typeof id !== 'string') {
    throw new Error('Create response id must be a string')
  }
  expect(id).toMatch(GENERATED_MODEL_PROFILE_ID_PATTERN)
  return id
}
