import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'

import type { FastifyInstance } from 'fastify'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { NodeUserFileSystem } from '../../../../src/infrastructure/filesystem/node-user-file-system.js'
import { NodeGitStatusReader } from '../../../../src/infrastructure/git/node-git-status-reader.js'
import { buildHttpServer } from '../../../../src/transport/http/server.js'
import { createTestAgentServices } from '../../../support/model-profile.js'

const execFileAsync = promisify(execFile)

describe('GET /api/sandbox/git/status', () => {
  let testRoot: string
  let workspace: string
  let repository: string
  let server: FastifyInstance

  async function git(args: string[], cwd = repository): Promise<string> {
    const { stdout } = await execFileAsync('git', ['-C', cwd, ...args], {
      env: { ...process.env, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null' },
    })
    return stdout.trim()
  }

  async function commit() {
    await git(['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.test',
      '-c', 'commit.gpgsign=false', 'commit', '--allow-empty', '-m', 'Initial'])
    return await git(['rev-parse', '--short=7', 'HEAD'])
  }

  const read = (cwd = repository) => server.inject({
    method: 'GET', url: `/api/sandbox/git/status?${new URLSearchParams({ cwd }).toString()}`,
  })

  beforeEach(async () => {
    testRoot = await realpath(await mkdtemp(join(tmpdir(), 'priva-git-http-')))
    workspace = join(testRoot, 'workspace')
    // Spaces and shell syntax must be passed as path data, never executed.
    repository = join(workspace, 'project $(false)')
    await mkdir(repository, { recursive: true })
    await git(['init', '--initial-branch=main'])
    const services = createTestAgentServices(join(testRoot, 'runtime'))
    server = buildHttpServer({
      userFileSystem: new NodeUserFileSystem({ initialDirectory: workspace }),
      gitStatusReader: new NodeGitStatusReader(workspace),
      modelProfileService: services.modelProfileService,
      agentProfileService: services.agentProfileService,
    })
    await server.ready()
  })

  afterEach(async () => {
    vi.unstubAllEnvs()
    await server.close()
    await rm(testRoot, { recursive: true, force: true })
  })

  it('reports the branch before the first commit, without an Agent session', async () => {
    const response = await read()
    expect(response.statusCode).toBe(200)
    expect(response.headers['cache-control']).toBe('no-store')
    expect(response.json<unknown>()).toEqual({ cwd: repository, root: repository, branch: 'main', commit: null })
  })

  it('reads the enclosing repository and refreshes after an external branch switch', async () => {
    const sha = await commit()
    const directory = join(repository, 'nested')
    await mkdir(directory)
    expect((await read(directory)).json<unknown>()).toEqual({ cwd: directory, root: repository, branch: 'main', commit: sha })
    await git(['switch', '-c', 'feature/current-branch'])
    expect((await read(directory)).json<unknown>()).toMatchObject({ branch: 'feature/current-branch', commit: sha })
  })

  it('returns a short commit for detached HEAD', async () => {
    const sha = await commit()
    await git(['checkout', '--detach'])
    expect((await read()).json<unknown>()).toEqual({ cwd: repository, root: repository, branch: null, commit: sha })
  })

  it('reads a linked worktree instead of the main checkout', async () => {
    const sha = await commit()
    const worktree = join(workspace, 'linked-worktree')
    await git(['worktree', 'add', '-b', 'feature/worktree', worktree])
    expect((await read(worktree)).json<unknown>()).toEqual({ cwd: worktree, root: worktree, branch: 'feature/worktree', commit: sha })
    expect((await read()).json<unknown>()).toMatchObject({ branch: 'main' })
  })

  it('returns empty metadata for a directory without a Git worktree', async () => {
    expect((await read(workspace)).json<unknown>()).toEqual({ cwd: workspace, root: null, branch: null, commit: null })
    const bare = join(workspace, 'bare')
    await git(['init', '--bare', bare])
    expect((await read(bare)).json<unknown>()).toEqual({ cwd: bare, root: null, branch: null, commit: null })
  })

  it('validates missing, relative, invalid, and nonexistent working directories', async () => {
    expect((await server.inject('/api/sandbox/git/status')).statusCode).toBe(422)
    expect((await read('')).statusCode).toBe(422)
    expect((await read('.')).statusCode).toBe(400)
    expect((await read(`${repository}\0`)).statusCode).toBe(400)
    expect((await read(join(workspace, 'missing'))).statusCode).toBe(404)
    const file = join(workspace, 'file.txt')
    await writeFile(file, 'content')
    expect((await read(file)).statusCode).toBe(400)
  })

  it('checks the workspace boundary after resolving symbolic links', async () => {
    const outside = join(testRoot, 'outside')
    await mkdir(outside)
    const link = join(workspace, 'outside-link')
    await symlink(outside, link, 'dir')
    expect((await read(outside)).statusCode).toBe(403)
    expect((await read(link)).statusCode).toBe(403)
    const insideLink = join(workspace, 'inside-link')
    await symlink(repository, insideLink, 'dir')
    expect((await read(insideLink)).json<unknown>()).toMatchObject({ cwd: repository, branch: 'main' })
  })

  it('does not let inherited Git environment redirect the requested directory', async () => {
    vi.stubEnv('GIT_DIR', join(repository, '.git'))
    vi.stubEnv('GIT_WORK_TREE', repository)
    expect((await read(workspace)).json<unknown>()).toEqual({ cwd: workspace, root: null, branch: null, commit: null })
  })

  it('reports an unavailable Git executable instead of hiding it as a non-repository', async () => {
    vi.stubEnv('PATH', testRoot)
    const response = await read()
    expect(response.statusCode).toBe(503)
    expect(response.json<{ detail: string }>().detail).toContain('Install Git')
  })

  it('reports a broken Git directory instead of hiding it as a non-repository', async () => {
    const broken = join(workspace, 'broken')
    await mkdir(broken)
    await writeFile(join(broken, '.git'), 'gitdir: /nonexistent/priva-git-test\n')
    const response = await read(broken)
    expect(response.statusCode).toBe(500)
    expect(response.json<{ detail: string }>().detail).toContain('Check repository access')
  })
})
