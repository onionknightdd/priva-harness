import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

import { zipSync } from 'fflate'
import type { FastifyInstance } from 'fastify'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { McpDetail, SkillDetail } from '../../../../src/core/resource/resource-catalog.js'
import type { McpCapabilities } from '../../../../src/core/contract/resource-service.js'
import { AgentHarness } from '../../../../src/harness/agent-harness.js'
import { LiveRunRegistry } from '../../../../src/harness/run/live-run-registry.js'
import { NodeUserFileSystem } from '../../../../src/infrastructure/filesystem/node-user-file-system.js'
import { LocalResourceService } from '../../../../src/infrastructure/resources/local-resource-service.js'
import { buildHttpServer } from '../../../../src/transport/http/server.js'
import { FakeAgentProvider } from '../../../support/fake-agent-provider.js'
import { createTestAgentServices } from '../../../support/model-profile.js'

describe('resource HTTP routes', () => {
  let root: string
  let server: FastifyInstance
  let harness: AgentHarness
  const url = (path: string) => `/api/sandbox/resource/${path}?harness=claude&cwd=${encodeURIComponent(root)}`

  beforeEach(async () => {
    root = await realpath(await mkdtemp(join(tmpdir(), 'priva-resource-http-')))
    await mkdir(join(root, '.git'))
    const claudeDir = join(root, 'claude')
    const piDir = join(root, 'pi')
    vi.stubEnv('CLAUDE_CONFIG_DIR', claudeDir)
    vi.stubEnv('PI_CODING_AGENT_DIR', piDir)
    harness = new AgentHarness({ providers: { claude: new FakeAgentProvider('claude', []), pi: new FakeAgentProvider('pi', []) }, cwd: root, liveRuns: new LiveRunRegistry() })
    server = buildHttpServer({
      ...createTestAgentServices(join(root, 'runtime')),
      userFileSystem: new NodeUserFileSystem({ initialDirectory: root }), agentHarness: harness,
      resourceService: new LocalResourceService({ activeCwd: root, claudeDir, piDir, discoverProjects: () => Promise.resolve([]) }),
    })
    await server.ready()
  })
  afterEach(async () => { await server.close(); vi.unstubAllEnvs(); await rm(root, { recursive: true, force: true }) })

  it('validates request shapes before any connection and works with no model profile', async () => {
    expect((await server.inject({ method: 'GET', url: url('skills') })).statusCode).toBe(200)
    expect((await server.inject({ method: 'GET', url: url('mcp') })).statusCode).toBe(200)
    expect((await server.inject({ method: 'GET', url: '/api/sandbox/resource/mcp?harness=unknown' })).statusCode).toBe(422)
    expect((await server.inject({ method: 'GET', url: url('mcp/not-an-id') })).statusCode).toBe(422)
    expect((await server.inject({ method: 'POST', url: url('mcp/validate'), payload: { id: 'id', definition: {} } })).statusCode).toBe(422)
    expect((await server.inject({ method: 'POST', url: url('mcp'), payload: { name: 'invalid', definition: { command: 'node', args: [1] } } })).statusCode).toBe(422)
  })

  it('supports MCP CRUD, paginated capabilities and real tool invocation with scoped cwd/env', async () => {
    const invalidated = vi.spyOn(harness, 'invalidateResources')
    vi.stubEnv('RESOURCE_TEST_INPUT', 'expanded')
    const definition = { command: process.execPath, args: ['--import', import.meta.resolve('tsx'), resolve('tests/fixtures/resources/mcp-server.ts')], env: { RESOURCE_TEST_VALUE: '${RESOURCE_TEST_INPUT}' } }
    const created = await server.inject({ method: 'POST', url: url('mcp'), payload: { name: 'echo', scope: 'project', definition } })
    expect(created.statusCode).toBe(201)
    const detail = created.json<McpDetail>()
    expect((await server.inject({ method: 'GET', url: url(`mcp/${detail.id}`) })).json<McpDetail>().definition).toEqual(definition)
    const capabilities = await server.inject({ method: 'GET', url: url(`mcp/${detail.id}/capabilities`) })
    expect(capabilities.statusCode).toBe(200)
    expect(capabilities.json<McpCapabilities>().tools.map((tool) => tool['name'])).toEqual(['echo', 'second'])
    expect(capabilities.json<McpCapabilities>().resources).toHaveLength(1)
    expect(capabilities.json<McpCapabilities>().prompts).toHaveLength(1)
    expect((await server.inject({ method: 'POST', url: url('mcp/validate'), payload: { definition } })).statusCode).toBe(200)
    const called = await server.inject({ method: 'POST', url: url('mcp/validate/tool'), payload: { id: detail.id, name: 'echo', args: { value: 'hello' } } })
    expect(called.statusCode).toBe(200)
    const result = called.json<{ content: { text: string }[] }>()
    expect(JSON.parse(result.content[0]?.text ?? '{}')).toEqual({ args: { value: 'hello' }, cwd: root, env: 'expanded' })
    expect((await server.inject({ method: 'PATCH', url: url(`mcp/${detail.id}`), payload: { definition: { command: 'updated' } } })).statusCode).toBe(200)
    expect((await server.inject({ method: 'DELETE', url: url(`mcp/${detail.id}`) })).statusCode).toBe(204)
    expect((await server.inject({ method: 'GET', url: url(`mcp/${detail.id}`) })).statusCode).toBe(404)
    expect(invalidated).toHaveBeenCalledTimes(3)
  })

  it('serves bounded image/PDF assets while retaining text and path validation', async () => {
    const directory = join(root, '.claude', 'skills', 'assets')
    await mkdir(directory, { recursive: true })
    await writeFile(join(directory, 'SKILL.md'), '---\nname: assets\ndescription: Preview fixtures\n---\n# Assets')
    const image = Buffer.from([137, 80, 78, 71, 0, 255])
    const pdf = Buffer.from('%PDF-1.7\nfixture\n%%EOF')
    await writeFile(join(directory, 'image.PNG'), image)
    await writeFile(join(directory, 'document.pdf'), pdf)
    await writeFile(join(directory, 'diagram.svg'), '<svg xmlns="http://www.w3.org/2000/svg"/>')
    const listing = (await server.inject({ method: 'GET', url: url('skills') })).json<{ groups: { items: SkillDetail[] }[] }>()
    const skill = listing.groups.flatMap((group) => group.items).find((item) => item.name === 'assets')
    if (skill === undefined) throw new Error('Asset fixture was not discovered')
    const assetUrl = (path: string) => `${url(`skills/${skill.id}/asset`)}&path=${encodeURIComponent(path)}`
    const png = await server.inject({ method: 'GET', url: assetUrl('image.PNG') })
    expect(png.statusCode).toBe(200)
    expect(png.headers['content-type']).toBe('image/png')
    expect(png.rawPayload).toEqual(image)
    const document = await server.inject({ method: 'GET', url: assetUrl('document.pdf') })
    expect(document.headers['content-type']).toBe('application/pdf')
    expect(document.rawPayload).toEqual(pdf)
    const svg = await server.inject({ method: 'GET', url: assetUrl('diagram.svg') })
    expect(svg.headers['content-security-policy']).toContain('sandbox')
    expect(svg.headers['x-content-type-options']).toBe('nosniff')
    expect((await server.inject({ method: 'GET', url: `${url(`skills/${skill.id}/file`)}&path=diagram.svg` })).json<{ content: string }>().content).toContain('<svg')
    expect((await server.inject({ method: 'GET', url: `${url(`skills/${skill.id}/file`)}&path=image.PNG` })).statusCode).toBe(415)
    expect((await server.inject({ method: 'GET', url: assetUrl('SKILL.md') })).statusCode).toBe(415)
    expect((await server.inject({ method: 'GET', url: assetUrl('../../outside.png') })).statusCode).toBe(403)
    await writeFile(join(root, 'outside.png'), image)
    await symlink(join(root, 'outside.png'), join(directory, 'linked.png'))
    expect((await server.inject({ method: 'GET', url: assetUrl('linked.png') })).statusCode).toBe(403)
    expect((await server.inject({ method: 'GET', url: assetUrl('missing.png') })).statusCode).toBe(404)
    await writeFile(join(directory, 'large.png'), Buffer.alloc(20 * 1024 * 1024 + 1))
    expect((await server.inject({ method: 'GET', url: assetUrl('large.png') })).statusCode).toBe(413)
  })

  it('supports skill CRUD and archive routes and invalidates resources after successful mutations', async () => {
    const invalidated = vi.spyOn(harness, 'invalidateResources')
    const archive = zipSync({
      'test-skill/SKILL.md': Buffer.from('---\nname: test-skill\ndescription: Test skill\n---\n# Hello\n'),
      '__MACOSX/._test-skill': Buffer.from('AppleDouble metadata'),
      '__MACOSX/test-skill/._SKILL.md': Buffer.from('AppleDouble metadata'),
    })
    const boundary = 'resource-fixture-boundary'
    const body = Buffer.concat([Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="test.zip"\r\nContent-Type: application/zip\r\n\r\n`), archive, Buffer.from(`\r\n--${boundary}--\r\n`)])
    const uploaded = await server.inject({ method: 'POST', url: `${url('skills/upload')}&scope=project`, headers: { 'content-type': `multipart/form-data; boundary=${boundary}` }, payload: body })
    expect(uploaded.statusCode).toBe(201)
    const skill = uploaded.json<SkillDetail>()
    expect(skill.files.map((file) => file.path)).toEqual(['SKILL.md'])
    expect((await server.inject({ method: 'GET', url: url(`skills/${skill.id}`) })).statusCode).toBe(200)
    expect((await server.inject({ method: 'GET', url: `${url(`skills/${skill.id}/file`)}&path=SKILL.md` })).json<{ content: string }>().content).toContain('# Hello')
    const download = await server.inject({ method: 'GET', url: url(`skills/${skill.id}/download`) })
    expect(download.headers['content-type']).toBe('application/zip')
    expect(download.rawPayload.subarray(0, 2).toString()).toBe('PK')
    expect((await server.inject({ method: 'PATCH', url: url(`skills/${skill.id}`), payload: { enabled: false } })).json<SkillDetail>().enabled).toBe(false)
    expect((await server.inject({ method: 'DELETE', url: url(`skills/${skill.id}`) })).statusCode).toBe(204)
    expect(invalidated).toHaveBeenCalledTimes(3)
  })
})
