import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { FastifyInstance } from 'fastify'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { AgentHarness } from '../../../../src/harness/agent-harness.js'
import { LiveRunRegistry } from '../../../../src/harness/run/live-run-registry.js'
import { NodeUserFileSystem } from '../../../../src/infrastructure/filesystem/node-user-file-system.js'
import { SLASH_COMMANDS_ROUTE } from '../../../../src/transport/http/route/slash-commands.js'
import { buildHttpServer } from '../../../../src/transport/http/server.js'
import { FakeAgentProvider } from '../../../support/fake-agent-provider.js'
import { createTestAgentServices } from '../../../support/model-profile.js'

describe('/api/sandbox/agent/slash-commands', () => {
  let testRoot: string
  let server: FastifyInstance
  let claude: FakeAgentProvider
  let pi: FakeAgentProvider

  beforeEach(async () => {
    testRoot = await mkdtemp(join(tmpdir(), 'priva-slash-http-test-'))
    await mkdir(join(testRoot, 'runtime'))
    claude = new FakeAgentProvider('claude', [])
    pi = new FakeAgentProvider('pi', [])
    claude.slashCommands = [
      {
        name: 'compact',
        description: 'Compact context',
        kind: 'command',
        origin: 'builtin',
      },
      {
        name: 'review',
        description: 'Review a change',
        argumentHint: '<file>',
        aliases: ['pr'],
        kind: 'skill',
        origin: 'project',
      },
    ]
    pi.slashCommands = [
      {
        name: 'model',
        description: 'Select model',
        kind: 'command',
        origin: 'builtin',
      },
    ]
    const { modelProfileService, agentProfileService } = createTestAgentServices(join(testRoot, 'runtime'))
    await modelProfileService.createProfile({
      label: 'Gateway',
      baseUrl: 'https://api.example.com/v1',
      authToken: 'secret',
      defaultModel: 'unique-model',
    })
    const providers = { claude, pi }
    server = buildHttpServer({
      userFileSystem: new NodeUserFileSystem({ initialDirectory: testRoot }),
      modelProfileService,
      agentProfileService,
      agentHarness: new AgentHarness({
        providers,
        cwd: testRoot,
        liveRuns: new LiveRunRegistry(),
      }),
    })
    await server.ready()
  })

  afterEach(async () => {
    await server.close()
    await rm(testRoot, { recursive: true, force: true })
  })

  it('lists Claude commands with snake_case optional fields and a default model spec', async () => {
    const response = await server.inject({
      method: 'GET',
      url: `${SLASH_COMMANDS_ROUTE}?harness=claude&cwd=${encodeURIComponent(testRoot)}`,
    })
    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual({
      harness: 'claude',
      cwd: testRoot,
      commands: [
        {
          name: 'compact',
          description: 'Compact context',
          kind: 'command',
          origin: 'builtin',
        },
        {
          name: 'review',
          description: 'Review a change',
          argument_hint: '<file>',
          aliases: ['pr'],
          kind: 'skill',
          origin: 'project',
        },
      ],
    })
    expect(claude.slashRequests).toHaveLength(1)
    expect(claude.slashRequests[0]?.cwd).toBe(testRoot)
    expect(claude.slashRequests[0]?.spec).toMatchObject({
      provider: 'claude',
      model: 'unique-model',
      authToken: 'secret',
    })
  })

  it('lists Pi commands without requiring a model profile spec', async () => {
    const response = await server.inject({
      method: 'GET',
      url: `${SLASH_COMMANDS_ROUTE}?harness=pi`,
    })
    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual({
      harness: 'pi',
      cwd: testRoot,
      commands: [
        {
          name: 'model',
          description: 'Select model',
          kind: 'command',
          origin: 'builtin',
        },
      ],
    })
    expect(pi.slashRequests).toEqual([{ cwd: testRoot }])
  })
})
