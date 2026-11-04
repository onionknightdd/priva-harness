import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { FastifyInstance } from 'fastify'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SkillDetail } from '../../../../src/core/resource/resource-catalog.js'
import { NodeUserFileSystem } from '../../../../src/infrastructure/filesystem/node-user-file-system.js'
import { NodeModelAssets } from '../../../../src/infrastructure/filesystem/node-model-assets.js'
import { PointCloudConversions } from '../../../../src/infrastructure/filesystem/point-cloud-conversions.js'
import { LocalResourceService } from '../../../../src/infrastructure/resources/local-resource-service.js'
import { buildHttpServer } from '../../../../src/transport/http/server.js'
import { createTestAgentServices } from '../../../support/model-profile.js'
import { copcHeader } from '../../../support/point-cloud.js'

describe('model resources and byte ranges', () => {
  let root: string
  let server: FastifyInstance
  let resources: LocalResourceService
  const url = (path: string, resource?: string) => `/api/sandbox/models/asset?${new URLSearchParams({ source: 'file', path,
    ...(resource === undefined ? {} : { resource }) }).toString()}`
  beforeEach(async () => {
    root = await realpath(await mkdtemp(join(tmpdir(), 'priva-model-assets-')))
    const files = new NodeUserFileSystem({ initialDirectory: root })
    vi.stubEnv('CLAUDE_CONFIG_DIR', join(root, 'claude'))
    resources = new LocalResourceService({ activeCwd: root, claudeDir: join(root, 'claude'),
      claudeConfigFilePath: join(root, 'claude.json'), piDir: join(root, 'pi'), discoverProjects: () => Promise.resolve([]) })
    const assets = new NodeModelAssets(files, resources)
    server = buildHttpServer({ ...createTestAgentServices(join(root, 'runtime')), userFileSystem: files,
      modelAssets: assets, resourceService: resources,
      pointClouds: new PointCloudConversions({ assets, files, cacheDirectory: join(root, 'cache') }) })
    await server.ready()
  })
  afterEach(async () => { await server.close(); vi.unstubAllEnvs(); await rm(root, { recursive: true, force: true }) })

  it('classifies ASCII models before the text limit and returns a changing 64-hex revision', async () => {
    for (const extension of ['obj', 'stl', 'ply', 'pcd', 'gltf', 'step', 'stp', 'iges', 'igs']) {
      const path = join(root, `model.${extension}`)
      await writeFile(path, 'a'.repeat(3 * 1024 * 1024 + 1))
      const response = await server.inject(`/api/sandbox/files/preview?${new URLSearchParams({ path }).toString()}`)
      expect(response.statusCode).toBe(200)
      expect(response.json<unknown>()).toMatchObject({ content: null, is_binary: true, preview_error: null })
      expect(response.json<{ revision: string }>().revision).toMatch(/^[a-f0-9]{64}$/u)
    }
    const path = join(root, 'model.obj')
    const inspect = `/api/sandbox/models/inspect?${new URLSearchParams({ source: 'file', path }).toString()}`
    const original = (await server.inject(inspect)).json<{ revision: string }>().revision
    await writeFile(path, 'v 0 0 0')
    expect((await server.inject(inspect)).json<{ revision: string }>().revision).not.toBe(original)
  })

  it('streams Range, suffix, HEAD and conditional downloads without reading the entire file', async () => {
    const path = join(root, 'model.glb')
    await writeFile(path, '0123456789')
    for (const route of [url(path), `/api/sandbox/files/download?${new URLSearchParams({ path }).toString()}`]) {
      const response = await server.inject({ url: route, headers: { range: 'bytes=2-5' } })
      expect(response.statusCode).toBe(206)
      expect(response.body).toBe('2345')
      expect(response.headers['content-range']).toBe('bytes 2-5/10')
      expect(response.headers['accept-ranges']).toBe('bytes')
      expect((await server.inject({ url: route, headers: { range: 'bytes=-3' } })).body).toBe('789')
      expect((await server.inject({ url: route, headers: { range: 'bytes=20-' } })).statusCode).toBe(416)
      const etag = String(response.headers.etag)
      expect((await server.inject({ url: route, headers: { 'if-none-match': etag } })).statusCode).toBe(304)
      expect((await server.inject({ url: route, headers: { range: 'bytes=2-5', 'if-range': '"old"' } })).statusCode).toBe(200)
      const head = await server.inject({ method: 'HEAD', url: route })
      expect(head.statusCode).toBe(200)
      expect(head.body).toBe('')
      expect(head.headers['content-length']).toBe('10')
    }
  })

  it('allows model-local nested dependencies while rejecting traversal, URI and symlink escapes', async () => {
    const directory = join(root, 'models')
    await mkdir(join(directory, 'textures'), { recursive: true })
    const path = join(directory, 'scene.gltf')
    await writeFile(path, '{}')
    await writeFile(join(directory, 'textures', 'a b.png'), 'texture')
    await writeFile(join(root, 'outside.bin'), 'private')
    await symlink(join(root, 'outside.bin'), join(directory, 'linked.bin'))
    expect((await server.inject(url(path, 'textures/a b.png'))).body).toBe('texture')
    for (const resource of ['../outside.bin', '/etc/passwd', 'https://example.test/a', '//example.test/a', 'linked.bin', 'textures\\a.png']) {
      expect((await server.inject(url(path, resource))).statusCode).toBe(403)
    }
    // Explicit manual file access outside the workspace remains supported.
    const outside = join(root, 'outside.bin')
    expect((await server.inject(`/api/sandbox/files/download?${new URLSearchParams({ path: outside }).toString()}`)).body).toBe('private')
  })

  it('resolves skill model resources under the selected skill and main-model directory', async () => {
    const directory = join(root, 'claude', 'skills', 'model')
    await mkdir(join(directory, 'models'), { recursive: true })
    await writeFile(join(directory, 'SKILL.md'), '---\nname: model\ndescription: Model fixture\n---\n# Model')
    await writeFile(join(directory, 'models', 'scene.gltf'), '{}')
    await writeFile(join(directory, 'models', 'data.bin'), 'buffer')
    const listing = await resources.skills.list({ harness: 'claude', cwd: root })
    const skill = listing.groups.flatMap((group) => group.items).find((item) => item.name === 'model') as SkillDetail | undefined
    expect(skill).toBeDefined()
    const query = new URLSearchParams({ source: 'skill', skillId: skill?.id ?? '', harness: 'claude', cwd: root, path: 'models/scene.gltf' })
    expect((await server.inject(`/api/sandbox/models/inspect?${query.toString()}`)).statusCode).toBe(200)
    query.set('resource', 'data.bin')
    expect((await server.inject(`/api/sandbox/models/asset?${query.toString()}`)).body).toBe('buffer')
    query.set('resource', '../SKILL.md')
    expect((await server.inject(`/api/sandbox/models/asset?${query.toString()}`)).statusCode).toBe(403)
    query.delete('resource')
    query.set('path', '../outside.glb')
    expect((await server.inject(`/api/sandbox/models/asset?${query.toString()}`)).statusCode).toBe(403)
  })

  it('serves existing COPC directly and rejects changed revisions', async () => {
    const path = join(root, 'cloud.copc.laz')
    await writeFile(path, copcHeader())
    const prepared = await server.inject({ method: 'POST', url: '/api/sandbox/pointclouds', payload: { source: { kind: 'file', path } } })
    expect(prepared.statusCode).toBe(200)
    const job = prepared.json<{ id: string; status: string; url: string }>()
    expect(job.status).toBe('ready')
    expect((await server.inject({ url: job.url, headers: { range: 'bytes=0-3' } })).body).toBe('LASF')
    await writeFile(path, Buffer.concat([copcHeader(), Buffer.from('changed')]))
    expect((await server.inject(job.url)).statusCode).toBe(409)
  })
})
