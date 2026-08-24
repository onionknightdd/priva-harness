import { access, mkdir, mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { FastifyInstance } from 'fastify'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { NodeUserFileSystem } from '../../../../src/infrastructure/filesystem/node-user-file-system.js'
import { createRuntimeConfig } from '../../../../src/runtime-config.js'
import { AGENT_PROFILE_ROUTE } from '../../../../src/transport/http/route/agent-profile.js'
import { buildHttpServer } from '../../../../src/transport/http/server.js'
import { createTestAgentServices } from '../../../support/model-profile.js'

describe('/api/sandbox/agent/profile', () => {
  let testRoot: string
  let runtimeHome: string
  let server: FastifyInstance

  beforeEach(async () => {
    testRoot = await mkdtemp(join(tmpdir(), 'priva-agent-profile-http-test-'))
    runtimeHome = join(testRoot, 'runtime')
    const workspace = join(testRoot, 'workspace')
    await mkdir(workspace)
    const services = createTestAgentServices(runtimeHome)
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

  it('returns the default queue behavior without creating the settings file', async () => {
    const response = await server.inject({
      method: 'GET',
      url: AGENT_PROFILE_ROUTE,
    })

    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual({ queue_behavior: 'follow-up' })
    await expect(access(createRuntimeConfig(runtimeHome).settingsFilePath))
      .rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('persists queue behavior into bambuddy.settings.json', async () => {
    const patchResponse = await server.inject({
      method: 'PATCH',
      url: AGENT_PROFILE_ROUTE,
      payload: { queue_behavior: 'steer' },
    })
    expect(patchResponse.statusCode).toBe(200)
    expect(patchResponse.json()).toEqual({ queue_behavior: 'steer' })

    const settingsPath = createRuntimeConfig(runtimeHome).settingsFilePath
    expect(JSON.parse(await readFile(settingsPath, 'utf8'))).toMatchObject({
      version: 1,
      modelProfiles: {
        defaultProfileId: null,
        profiles: [],
      },
      agentProfile: { queueBehavior: 'steer' },
    })

    const getResponse = await server.inject({
      method: 'GET',
      url: AGENT_PROFILE_ROUTE,
    })
    expect(getResponse.json()).toEqual({ queue_behavior: 'steer' })
  })

  it('rejects an invalid queue behavior', async () => {
    const response = await server.inject({
      method: 'PATCH',
      url: AGENT_PROFILE_ROUTE,
      payload: { queue_behavior: 'later' },
    })
    expect(response.statusCode).toBe(422)
  })
})
