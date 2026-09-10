import { mkdir, mkdtemp, realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { FastifyInstance } from 'fastify'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { MemoryDetail, MemoryList, SubagentDetail } from '../../../../src/core/resource/agent-resources.js'
import { AgentHarness } from '../../../../src/harness/agent-harness.js'
import { LiveRunRegistry } from '../../../../src/harness/run/live-run-registry.js'
import { NodeUserFileSystem } from '../../../../src/infrastructure/filesystem/node-user-file-system.js'
import { LocalResourceService } from '../../../../src/infrastructure/resources/local-resource-service.js'
import { buildHttpServer } from '../../../../src/transport/http/server.js'
import { FakeAgentProvider } from '../../../support/fake-agent-provider.js'
import { createTestAgentServices } from '../../../support/model-profile.js'

describe('agent resource HTTP endpoints', () => {
  let root: string
  let server: FastifyInstance
  let service: LocalResourceService
  let provider: FakeAgentProvider
  let harness: AgentHarness
  const url = (path: string) => `/api/sandbox/resource/${path}?harness=claude&cwd=${encodeURIComponent(root)}`
  beforeEach(async () => {
    root = await realpath(await mkdtemp(join(tmpdir(), 'agent-resource-http-')))
    await mkdir(join(root, '.git'))
    const claudeDir = join(root, 'claude'); const piDir = join(root, 'pi')
    vi.stubEnv('CLAUDE_CONFIG_DIR', claudeDir); vi.stubEnv('PI_CODING_AGENT_DIR', piDir)
    provider = new FakeAgentProvider('claude', [{ type: 'assistant.delta', messageId: 'm', blockId: 'b', text: 'Test output' }, { type: 'run.completed', model: 'fixture-model', durationMs: 1 }])
    harness = new AgentHarness({ providers: { claude: provider, pi: new FakeAgentProvider('pi', []) }, cwd: root, liveRuns: new LiveRunRegistry() })
    const services = createTestAgentServices(join(root, 'runtime'))
    vi.spyOn(services.modelProfileService, 'resolve').mockResolvedValue({
      profile: { id: 'fixture', label: 'Fixture', baseUrl: 'https://fixture.invalid', authToken: 'fixture', defaultModel: 'fixture/model', imageUnderstandingModel: null, imageGenerationModel: null, imageEditModel: null, modelCapabilities: { imageUnderstanding: [], imageGeneration: [], imageEdit: [] } },
      model: 'fixture-model', modelId: 'fixture/model', capabilities: { context: null },
    })
    service = new LocalResourceService({ activeCwd: root, claudeDir, piDir, discoverProjects: () => Promise.resolve([]) })
    server = buildHttpServer({ ...services, userFileSystem: new NodeUserFileSystem({ initialDirectory: root }), agentHarness: harness, resourceService: service })
    await server.ready()
  })
  afterEach(async () => { await server.close(); await harness.disposePool(); vi.unstubAllEnvs(); await rm(root, { recursive: true, force: true }) })

  const createAgent = async () => {
    const list = await service.subagents.list({ harness: 'claude', cwd: root })
    const sourceId = list.groups.find((group) => group.source.cwd === root)?.source.id
    const result = await server.inject({ method: 'POST', url: url('subagents'), payload: { sourceId, definition: { name: 'reviewer', description: 'Review changes' }, prompt: 'Review carefully.' } })
    expect(result.statusCode).toBe(201)
    return result.json<SubagentDetail>()
  }

  it('serves catalog and CRUD with revision checks and resource invalidation', async () => {
    const invalidated = vi.spyOn(harness, 'invalidateResources')
    expect((await server.inject({ url: url('subagents/catalog') })).statusCode).toBe(200)
    const agent = await createAgent()
    const updated = await server.inject({ method: 'PATCH', url: url(`subagents/${agent.id}`), payload: { definition: agent.definition, prompt: 'Changed', revision: agent.revision } })
    expect(updated.statusCode).toBe(200)
    const stale = await server.inject({ method: 'PATCH', url: url(`subagents/${agent.id}`), payload: { definition: agent.definition, prompt: 'Again', revision: agent.revision } })
    expect(stale.statusCode).toBe(409)
    expect((await server.inject({ method: 'DELETE', url: url(`subagents/${agent.id}`), payload: { revision: updated.json<SubagentDetail>().revision } })).statusCode).toBe(204)
    expect(invalidated).toHaveBeenCalledTimes(3)
  })

  it('streams through the selected harness with the project cwd and disposes the test runtime', async () => {
    const agent = await createAgent()
    const response = await server.inject({ method: 'POST', url: url(`subagents/${agent.id}/test/stream`), payload: { prompt: 'Find a bug', model: 'fixture/model' } })
    expect(response.statusCode).toBe(200)
    expect(response.headers['content-type']).toContain('text/event-stream')
    expect(response.body).toContain('Test output')
    expect(provider.turns[0]?.text).toContain('"reviewer"')
    expect(provider.specs[0]?.cwd).toBe(root)
    expect(provider.released).toEqual(['dispose'])
    expect((await server.inject({ method: 'POST', url: url(`subagents/${agent.id}/test/stream`), payload: { prompt: '' } })).statusCode).toBe(422)
  })

  it('lists and edits instructions with the same scoped resource contract', async () => {
    const response = await server.inject({ url: url('memory') })
    expect(response.statusCode).toBe(200)
    const item = response.json<MemoryList>().groups.flatMap((group) => group.items).find((item) => item.path === join(root, 'CLAUDE.md'))
    expect(item).toBeDefined()
    const detail = (await server.inject({ url: url(`memory/${item?.id ?? ''}`) })).json<MemoryDetail>()
    const updated = await server.inject({ method: 'PATCH', url: url(`memory/${detail.id}`), payload: { content: 'Project instructions', revision: detail.revision } })
    expect(updated.statusCode).toBe(200)
    expect(updated.json<MemoryDetail>().content).toBe('Project instructions')
    expect((await server.inject({ method: 'PUT', url: url('memory/auto/enabled'), payload: { enabled: false } })).statusCode).toBe(200)
    expect((await server.inject({ url: '/api/sandbox/resource/memory?harness=invalid' })).statusCode).toBe(422)
  })
})
