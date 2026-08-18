import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { FastifyInstance } from 'fastify'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import type { ModelEndpointClient } from '../../../../src/core/contract/model-profile.js'
import {
  type ModelProfile,
  ModelProfileError,
} from '../../../../src/core/resource/model-profile.js'
import { NodeUserFileSystem } from '../../../../src/infrastructure/filesystem/node-user-file-system.js'
import { buildHttpServer } from '../../../../src/transport/http/server.js'
import { createTestModelProfileService } from '../../../support/model-profile.js'

describe('/api/sandbox/credentials/profiles', () => {
  let testRoot: string
  let server: FastifyInstance
  let endpointClient: RecordingEndpointClient

  beforeEach(async () => {
    testRoot = await mkdtemp(join(tmpdir(), 'priva-model-profile-http-test-'))
    const workspace = join(testRoot, 'workspace')
    await mkdir(workspace)
    endpointClient = new RecordingEndpointClient()
    server = buildHttpServer({
      userFileSystem: new NodeUserFileSystem({ initialDirectory: workspace }),
      modelProfileService: createTestModelProfileService(
        join(testRoot, 'runtime'),
        endpointClient,
      ),
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
      payload: profilePayload('gateway'),
    })
    expect(createResponse.statusCode).toBe(201)
    expect(createResponse.json()).toEqual({
      id: 'gateway',
      label: 'gateway',
      base_url: 'https://api.example.com',
      auth_token: 'secret',
      auth_token_set: true,
      default_model: 'model-a',
      model_capabilities: {},
      model_count: null,
    })

    const listResponse = await server.inject({
      method: 'GET',
      url: '/api/sandbox/credentials/profiles',
    })
    expect(listResponse.statusCode).toBe(200)
    expect(listResponse.json()).toMatchObject({
      default_profile_id: 'gateway',
      profiles: [{ id: 'gateway', auth_token_set: true }],
    })

    const updateResponse = await server.inject({
      method: 'PATCH',
      url: '/api/sandbox/credentials/profiles/gateway',
      payload: { label: 'Renamed', default_model: null },
    })
    expect(updateResponse.statusCode).toBe(200)
    expect(updateResponse.json()).toMatchObject({
      label: 'Renamed',
      default_model: null,
    })

    const getResponse = await server.inject({
      method: 'GET',
      url: '/api/sandbox/credentials/profiles/gateway',
    })
    expect(getResponse.statusCode).toBe(200)
    expect(getResponse.json()).not.toHaveProperty('auth_token_set')

    const duplicateResponse = await server.inject({
      method: 'POST',
      url: '/api/sandbox/credentials/profiles',
      payload: profilePayload('gateway'),
    })
    expect(duplicateResponse.statusCode).toBe(409)
    expect(duplicateResponse.json()).toEqual({ detail: 'profile_id_exists' })
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
    await createProfile(server, 'saved')

    const listResponse = await server.inject({
      method: 'GET',
      url: '/api/sandbox/credentials/profiles/saved/models',
    })
    expect(listResponse.statusCode).toBe(200)
    expect(listResponse.json()).toEqual({ models: [{ id: 'model-a' }, { id: 'model-b' }] })

    const savedTestResponse = await server.inject({
      method: 'POST',
      url: '/api/sandbox/credentials/profiles/saved/test',
      payload: {},
    })
    expect(savedTestResponse.statusCode).toBe(200)

    const savedDraftTestResponse = await server.inject({
      method: 'POST',
      url: '/api/sandbox/credentials/profiles/saved/test',
      payload: {
        base_url: 'https://changed.example.com/v1',
        auth_token: 'changed-secret',
      },
    })
    expect(savedDraftTestResponse.statusCode).toBe(200)
    expect(endpointClient.listedProfiles.at(-1)).toMatchObject({
      id: 'saved',
      baseUrl: 'https://changed.example.com/v1',
      authToken: 'changed-secret',
    })

    const savedBaseUrlTestResponse = await server.inject({
      method: 'POST',
      url: '/api/sandbox/credentials/profiles/saved/test',
      payload: { base_url: 'https://stored-key.example.com/v1' },
    })
    expect(savedBaseUrlTestResponse.statusCode).toBe(200)
    expect(endpointClient.listedProfiles.at(-1)).toMatchObject({
      id: 'saved',
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
    expect(endpointClient.listedProfiles.at(-1)).toMatchObject({
      id: 'draft',
      baseUrl: 'https://draft.example.com/v1',
      authToken: 'draft-secret',
    })
  })

  it('force probes image capability, persists it, and resets the transport decision', async () => {
    await createProfile(server, 'gateway')
    const firstProbe = await server.inject({
      method: 'POST',
      url: '/api/sandbox/credentials/profiles/gateway/image-capability/probe',
      payload: { model_id: 'model-a' },
    })
    expect(firstProbe.statusCode).toBe(200)
    expect(firstProbe.json()).toEqual({
      profile_id: 'gateway',
      model_id: 'model-a',
      image: true,
      cached: false,
    })

    const getResponse = await server.inject({
      method: 'GET',
      url: '/api/sandbox/credentials/profiles/gateway',
    })
    expect(getResponse.json()).toMatchObject({
      model_capabilities: {
        'model-a': { image: true, image_read_transport: null },
      },
    })
    expect(endpointClient.probedModels).toEqual(['model-a'])
  })

  it('returns model_unavailable and leaves no cache when image probing fails', async () => {
    await createProfile(server, 'gateway')
    endpointClient.probeError = new ModelProfileError(
      'upstream-auth-failed',
      'authentication failed',
    )

    const probe = await server.inject({
      method: 'POST',
      url: '/api/sandbox/credentials/profiles/gateway/image-capability/probe',
      payload: { model_id: 'model-a' },
    })
    expect(probe.statusCode).toBe(502)
    expect(probe.json()).toEqual({ detail: 'model_unavailable' })

    const profile = await server.inject({
      method: 'GET',
      url: '/api/sandbox/credentials/profiles/gateway',
    })
    expect(profile.json()).toMatchObject({ model_capabilities: {} })
  })

  it('requires a ready profile before changing the default and promotes on deletion', async () => {
    await createProfile(server, 'first')
    await createProfile(server, 'second', null)

    const notReady = await server.inject({
      method: 'PUT',
      url: '/api/sandbox/credentials/profiles/second/default',
      payload: {},
    })
    expect(notReady.statusCode).toBe(409)
    expect(notReady.json()).toEqual({ detail: 'profile_not_ready' })

    await server.inject({
      method: 'PATCH',
      url: '/api/sandbox/credentials/profiles/second',
      payload: { default_model: 'model-b' },
    })
    const setDefault = await server.inject({
      method: 'PUT',
      url: '/api/sandbox/credentials/profiles/second/default',
    })
    expect(setDefault.json()).toEqual({ default_profile_id: 'second' })

    const deleted = await server.inject({
      method: 'DELETE',
      url: '/api/sandbox/credentials/profiles/second',
    })
    expect(deleted.statusCode).toBe(204)
    const listing = await server.inject({
      method: 'GET',
      url: '/api/sandbox/credentials/profiles',
    })
    expect(listing.json()).toMatchObject({ default_profile_id: 'first' })
  })
})

class RecordingEndpointClient implements ModelEndpointClient {
  readonly listedProfiles: ModelProfile[] = []
  readonly probedModels: string[] = []
  probeError: Error | undefined

  listModels(profile: ModelProfile) {
    this.listedProfiles.push(profile)
    return Promise.resolve([{ id: 'model-a' }, { id: 'model-b' }])
  }

  probeImageCapability(_profile: ModelProfile, modelId: string) {
    this.probedModels.push(modelId)
    if (this.probeError !== undefined) return Promise.reject(this.probeError)
    return Promise.resolve(true)
  }
}

function profilePayload(id: string, defaultModel: string | null = 'model-a') {
  return {
    id,
    label: id,
    base_url: 'https://api.example.com',
    auth_token: 'secret',
    default_model: defaultModel,
  }
}

async function createProfile(
  server: FastifyInstance,
  id: string,
  defaultModel: string | null = 'model-a',
): Promise<void> {
  const response = await server.inject({
    method: 'POST',
    url: '/api/sandbox/credentials/profiles',
    payload: profilePayload(id, defaultModel),
  })
  expect(response.statusCode).toBe(201)
}
