import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, readFile, realpath, rename, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'

import type { FastifyInstance } from 'fastify'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { GitAction, GitCommit, GitCommitFile, GitDiff, GitRepository } from '../../../../src/core/resource/git-repository.js'
import { NodeUserFileSystem } from '../../../../src/infrastructure/filesystem/node-user-file-system.js'
import { NodeGitRepositoryService } from '../../../../src/infrastructure/git/node-git-repository-service.js'
import { buildHttpServer } from '../../../../src/transport/http/server.js'
import { createTestAgentServices } from '../../../support/model-profile.js'

const execFileAsync = promisify(execFile)

describe('Git workspace HTTP API', () => {
  let testRoot: string
  let workspace: string
  let repository: string
  let server: FastifyInstance
  async function git(args: string[], cwd = repository) {
    return (await execFileAsync('git', ['-C', cwd, ...args], { env: { ...process.env, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null' } })).stdout.trim()
  }
  const read = (endpoint: string, query: Record<string, string> = {}) => server.inject({ method: 'GET', url: `/api/sandbox/git/${endpoint}?${new URLSearchParams({ cwd: repository, ...query }).toString()}` })
  async function snapshot() { return (await read('repository')).json<GitRepository>() }
  async function action(input: Omit<GitAction, 'cwd' | 'expectedBranch' | 'expectedCommit'>, cwd = repository) {
    const state = (await read('repository', { cwd })).json<GitRepository>()
    return await server.inject({ method: 'POST', url: '/api/sandbox/git/action', payload: { cwd, expectedBranch: state.branch, expectedCommit: state.commit, ...input } })
  }
  async function commitFile(path = 'file.txt', content = 'first\n', message = 'Initial') {
    await writeFile(join(repository, path), content)
    await git(['add', '--', path])
    await git(['commit', '-m', message])
    return await git(['rev-parse', 'HEAD'])
  }
  beforeEach(async () => {
    testRoot = await realpath(await mkdtemp(join(tmpdir(), 'priva-git-view-')))
    workspace = join(testRoot, 'workspace')
    repository = join(workspace, 'project $(false)')
    await mkdir(repository, { recursive: true })
    await git(['init', '--initial-branch=main'])
    await git(['config', 'user.name', 'Fixture'])
    await git(['config', 'user.email', 'fixture@example.test'])
    await git(['config', 'commit.gpgsign', 'false'])
    const services = createTestAgentServices(join(testRoot, 'runtime'))
    server = buildHttpServer({ userFileSystem: new NodeUserFileSystem({ initialDirectory: workspace }), gitRepositoryService: new NodeGitRepositoryService(workspace), modelProfileService: services.modelProfileService, agentProfileService: services.agentProfileService })
    await server.ready()
  })
  afterEach(async () => { vi.unstubAllEnvs(); await server.close(); await rm(testRoot, { recursive: true, force: true }) })

  it('reads an unborn branch, stages literal filenames, unstages, and commits', async () => {
    const name = ':(glob)* weird\tname.txt'
    await writeFile(join(repository, name), 'hello\n')
    const response = await read('repository')
    expect(response.headers['cache-control']).toBe('no-store')
    expect(response.json<GitRepository>()).toMatchObject({ branch: 'main', commit: null, root: repository, changes: [{ path: name, indexStatus: '?', worktreeStatus: '?' }] })
    expect((await read('history')).json<unknown>()).toEqual({ commits: [], hasMore: false })
    expect((await action({ action: 'stage', paths: [name] })).statusCode).toBe(200)
    await writeFile(join(repository, name), 'newer\n')
    expect((await action({ action: 'unstage', paths: [name] })).statusCode).toBe(200)
    expect(await readFile(join(repository, name), 'utf8')).toBe('newer\n')
    await action({ action: 'stage', paths: [name] })
    const committed = await action({ action: 'commit', message: 'First commit' })
    expect(committed.statusCode, committed.body).toBe(200)
    expect(committed.json<{ repository: GitRepository }>().repository.commit).toMatch(/^[a-f0-9]{40}$/u)
    expect((await snapshot()).changes).toEqual([])
  })

  it('keeps staged and unstaged content distinct and unstage preserves working edits', async () => {
    await commitFile()
    await writeFile(join(repository, 'file.txt'), 'staged\n')
    await action({ action: 'stage', paths: ['file.txt'] })
    await writeFile(join(repository, 'file.txt'), 'working\n')
    expect((await snapshot()).changes).toEqual([{ path: 'file.txt', originalPath: null, indexStatus: 'M', worktreeStatus: 'M', conflicted: false }])
    expect((await read('diff', { path: 'file.txt', area: 'staged' })).json<GitDiff>()).toMatchObject({ oldContent: 'first\n', newContent: 'staged\n', binary: false })
    expect((await read('diff', { path: 'file.txt', area: 'unstaged' })).json<GitDiff>()).toMatchObject({ oldContent: 'staged\n', newContent: 'working\n' })
    expect((await action({ action: 'unstage', paths: ['file.txt'] })).statusCode).toBe(200)
    expect(await readFile(join(repository, 'file.txt'), 'utf8')).toBe('working\n')
  })

  it('shows untracked text, binary files, empty files, and bounded large files', async () => {
    await writeFile(join(repository, 'new.txt'), 'hello')
    const text = (await read('diff', { path: 'new.txt', area: 'untracked' })).json<GitDiff>()
    expect(text).toMatchObject({ oldContent: null, newContent: 'hello', binary: false, truncated: false })
    expect(text.patch).toContain('No newline at end of file')
    await writeFile(join(repository, 'binary.bin'), Buffer.from([0, 1, 2]))
    expect((await read('diff', { path: 'binary.bin', area: 'untracked' })).json<GitDiff>()).toMatchObject({ binary: true, newContent: null })
    await writeFile(join(repository, 'empty.txt'), '')
    expect((await read('diff', { path: 'empty.txt', area: 'untracked' })).json<GitDiff>()).toMatchObject({ newContent: '', truncated: false })
    await writeFile(join(repository, 'large.txt'), 'a'.repeat(300 * 1024))
    expect((await read('diff', { path: 'large.txt', area: 'untracked' })).json<GitDiff>()).toMatchObject({ truncated: true, newContent: null })
  })

  it('shows root commits, renames, deletions, and paginated history', async () => {
    const first = await commitFile('old name.txt')
    const rootDetails = (await read('commit', { commit: first })).json<{ commit: GitCommit; files: GitCommitFile[] }>()
    expect(rootDetails.commit.parents).toEqual([])
    expect(rootDetails.files).toEqual([{ path: 'old name.txt', originalPath: null, status: 'A', additions: 1, deletions: 0 }])
    expect((await read('diff', { path: 'old name.txt', area: 'commit', commit: first })).json<GitDiff>()).toMatchObject({ oldContent: null, newContent: 'first\n' })
    await rename(join(repository, 'old name.txt'), join(repository, 'new name.txt'))
    await git(['add', '-A'])
    expect((await snapshot()).changes[0]).toMatchObject({ path: 'new name.txt', originalPath: 'old name.txt', indexStatus: 'R' })
    expect((await read('diff', { path: 'new name.txt', area: 'staged' })).json<GitDiff>()).toMatchObject({ oldPath: 'old name.txt', oldContent: 'first\n', newContent: 'first\n' })
    await action({ action: 'commit', message: 'Rename\n\nDetails' })
    const second = (await snapshot()).commit ?? ''
    expect((await read('commit', { commit: second })).json<{ files: GitCommitFile[] }>().files).toEqual([{ path: 'new name.txt', originalPath: 'old name.txt', status: 'R', additions: 0, deletions: 0 }])
    const page = (await read('history', { limit: '1' })).json<{ commits: GitCommit[]; hasMore: boolean }>()
    expect(page).toMatchObject({ hasMore: true, commits: [{ subject: 'Rename', body: 'Details', parents: [first] }] })
    expect((await read('history', { skip: '1', limit: '1' })).json<{ commits: GitCommit[]; hasMore: boolean }>()).toMatchObject({ hasMore: false, commits: [{ id: first }] })
    await rm(join(repository, 'new name.txt'))
    expect((await read('diff', { path: 'new name.txt', area: 'unstaged' })).json<GitDiff>()).toMatchObject({ oldContent: 'first\n', newContent: null })
    expect((await action({ action: 'stage', paths: ['new name.txt'] })).statusCode).toBe(200)
    expect((await action({ action: 'commit', message: 'Delete' })).statusCode).toBe(200)
  })

  it('creates/switches branches and rejects stale HEAD mutations and invalid names', async () => {
    const initial = await commitFile()
    expect((await action({ action: 'create-branch', branch: 'feature/new' })).statusCode).toBe(200)
    expect((await snapshot()).branch).toBe('feature/new')
    const stale = await server.inject({ method: 'POST', url: '/api/sandbox/git/action', payload: { cwd: repository, expectedBranch: 'main', expectedCommit: initial, action: 'switch', branch: 'main' } })
    expect(stale.statusCode).toBe(409)
    const switched = await action({ action: 'switch', branch: 'main' })
    expect(switched.statusCode, switched.body).toBe(200)
    expect((await action({ action: 'create-branch', branch: '--orphan' })).statusCode).toBe(400)
    expect((await action({ action: 'create-branch', branch: '@{-1}' })).statusCode).toBe(400)
    await git(['checkout', '--detach'])
    expect((await snapshot()).branch).toBeNull()
    expect((await snapshot()).commit).toBe(initial)
  })

  it('sets a remote upstream without switching branches or changing the working tree', async () => {
    const initial = await commitFile()
    const bare = join(workspace, 'upstream.git')
    await git(['init', '--bare', '--initial-branch=main', bare])
    await git(['remote', 'add', 'origin', bare])
    await git(['push', 'origin', 'main'])
    await git(['branch', 'release', 'main'], bare)
    await git(['fetch', 'origin'])
    await git(['branch', 'origin/release'])
    await writeFile(join(repository, 'file.txt'), 'local draft\n')
    const status = await git(['status', '--porcelain'])

    const response = await action({ action: 'set-upstream', branch: 'origin/release' })
    expect(response.statusCode, response.body).toBe(200)
    expect(response.json<{ repository: GitRepository }>().repository).toMatchObject({ branch: 'main', commit: initial, remote: 'origin' })
    expect(response.json<{ repository: GitRepository }>().repository.upstream).toBe('origin/release')
    expect(response.json<{ repository: GitRepository }>().repository.branches.find((branch) => branch.current)?.upstream).toBe('origin/release')
    expect(await git(['config', '--get', 'branch.main.merge'])).toBe('refs/heads/release')
    expect(await git(['rev-parse', '--symbolic-full-name', '@{upstream}'])).toBe('refs/remotes/origin/release')
    expect(await readFile(join(repository, 'file.txt'), 'utf8')).toBe('local draft\n')
    expect(await git(['status', '--porcelain'])).toBe(status)
  })

  it('rejects invalid upstream choices and detached or unborn branches', async () => {
    expect((await action({ action: 'set-upstream', branch: 'origin/main' })).statusCode).toBe(409)
    await commitFile()
    expect((await action({ action: 'set-upstream' })).statusCode).toBe(400)
    expect((await action({ action: 'set-upstream', branch: 'main' })).statusCode).toBe(404)
    expect((await action({ action: 'set-upstream', branch: 'origin/missing' })).statusCode).toBe(404)
    await git(['checkout', '--detach'])
    expect((await action({ action: 'set-upstream', branch: 'origin/main' })).statusCode).toBe(409)
    expect((await snapshot()).upstream).toBeNull()
  })

  it('stages further edits to an indexed rename and unstages both sides without losing content', async () => {
    await commitFile('old.txt', 'first\nunchanged\n')
    await git(['mv', 'old.txt', 'new.txt'])
    await writeFile(join(repository, 'new.txt'), 'first\nunchanged\nsecond\n')
    expect((await snapshot()).changes[0]).toMatchObject({ path: 'new.txt', originalPath: 'old.txt', indexStatus: 'R', worktreeStatus: 'M' })
    const staged = await action({ action: 'stage', paths: ['new.txt'] })
    expect(staged.statusCode, staged.body).toBe(200)
    expect((await read('diff', { path: 'new.txt', area: 'staged' })).json<GitDiff>()).toMatchObject({ oldContent: 'first\nunchanged\n', newContent: 'first\nunchanged\nsecond\n' })
    await writeFile(join(repository, 'new.txt'), 'first\nunchanged\nsecond\nthird\n')
    const unstaged = await action({ action: 'unstage', paths: ['new.txt'] })
    expect(unstaged.statusCode, unstaged.body).toBe(200)
    expect(await readFile(join(repository, 'new.txt'), 'utf8')).toBe('first\nunchanged\nsecond\nthird\n')
    expect(await git(['show', ':old.txt'])).toBe('first\nunchanged')
    expect(await git(['diff', '--cached', '--name-only'])).toBe('')
  })

  it('returns repository state when switching removes the requested nested directory', async () => {
    await commitFile()
    await git(['branch', 'without-folder'])
    const nested = join(repository, 'nested')
    await mkdir(nested)
    await commitFile('nested/tracked.txt', 'nested\n', 'Add nested directory')
    const switched = await action({ action: 'switch', branch: 'without-folder' }, nested)
    expect(switched.statusCode, switched.body).toBe(200)
    expect(switched.json<{ repository: GitRepository }>().repository).toMatchObject({ cwd: repository, root: repository, branch: 'without-folder' })
  })

  it('supports linked worktrees and ignores inherited Git repository environment', async () => {
    const sha = await commitFile()
    const linked = join(workspace, 'linked')
    await git(['worktree', 'add', '-b', 'linked', linked])
    expect((await read('repository', { cwd: linked })).json<GitRepository>()).toMatchObject({ root: linked, branch: 'linked', commit: sha })
    vi.stubEnv('GIT_DIR', join(repository, '.git'))
    vi.stubEnv('GIT_WORK_TREE', repository)
    expect((await read('repository', { cwd: workspace })).json<GitRepository>()).toMatchObject({ root: null, changes: [] })
  })

  it('rejects path traversal, administrative paths, symlink escapes, and enclosing repositories outside workspace', async () => {
    await commitFile()
    for (const path of ['../outside', '.git/config', 'nested/../../outside', '/etc/passwd']) {
      expect((await read('diff', { path, area: 'unstaged' })).statusCode).toBe(400)
      expect((await action({ action: 'stage', paths: [path] })).statusCode).toBe(400)
    }
    const outside = join(testRoot, 'outside')
    await mkdir(outside)
    await writeFile(join(outside, 'secret'), 'secret')
    await symlink(outside, join(repository, 'escape'), 'dir')
    expect((await read('diff', { path: 'escape/secret', area: 'unstaged' })).statusCode).toBe(403)
    expect((await read('repository', { cwd: outside })).statusCode).toBe(403)
    expect((await read('repository', { cwd: join(repository, 'escape') })).statusCode).toBe(403)
    expect((await read('repository', { cwd: join(repository, '.git') })).statusCode).toBe(403)
    const nestedWorkspace = join(repository, 'nested-workspace')
    await mkdir(nestedWorkspace)
    await expect(new NodeGitRepositoryService(nestedWorkspace).read(nestedWorkspace)).rejects.toMatchObject({ statusCode: 403 })
  })

  it('serializes concurrent mutations and checks HEAD after acquiring the queue', async () => {
    const sha = await commitFile()
    const payload = { cwd: repository, expectedBranch: 'main', expectedCommit: sha, action: 'create-branch' }
    const responses = await Promise.all(['one', 'two'].map(async (branch) => await server.inject({ method: 'POST', url: '/api/sandbox/git/action', payload: { ...payload, branch } })))
    expect(responses.map((response) => response.statusCode).sort()).toEqual([200, 409])
    expect((await snapshot()).branches.filter((branch) => branch.name !== 'main')).toHaveLength(1)
  })

  it('returns empty metadata for plain directories and bare repositories', async () => {
    expect((await read('repository', { cwd: workspace })).json<GitRepository>()).toMatchObject({ root: null, branch: null, commit: null, changes: [], branches: [], remotes: [] })
    const bare = join(workspace, 'bare')
    await git(['init', '--bare', bare])
    expect((await read('repository', { cwd: bare })).json<GitRepository>()).toMatchObject({ root: null })
    expect((await read('history', { cwd: workspace })).statusCode).toBe(409)
  })

  it('validates inputs and reports missing identity, empty index, and missing Git', async () => {
    expect((await server.inject('/api/sandbox/git/repository')).statusCode).toBe(422)
    expect((await read('repository', { cwd: '.' })).statusCode).toBe(400)
    expect((await read('history', { limit: '101' })).statusCode).toBe(422)
    expect((await read('diff', { path: 'a', area: 'commit', commit: '--all' })).statusCode).toBe(422)
    expect((await action({ action: 'commit', message: 'Empty' })).statusCode).toBe(409)
    expect((await action({ action: 'commit', message: ' ' })).statusCode).toBe(400)
    await git(['config', 'user.name', ''])
    await writeFile(join(repository, 'new'), 'new')
    await action({ action: 'stage', paths: ['new'] })
    const identity = await action({ action: 'commit', message: 'Missing identity' })
    expect(identity.statusCode).toBe(409)
    expect(identity.json<{ detail: string }>().detail).toMatch(/identity|name/iu)
    vi.stubEnv('PATH', testRoot)
    expect((await read('repository')).statusCode).toBe(503)
  })

  it('publishes, fetches, fast-forward pulls, pushes, and tracks remote branches using a local bare remote', async () => {
    await commitFile()
    const bare = join(workspace, 'remote.git')
    await git(['init', '--bare', '--initial-branch=main', bare])
    await git(['remote', 'add', 'origin', bare])
    expect((await snapshot()).remotes).toEqual(['origin'])
    expect((await action({ action: 'pull' })).statusCode).toBe(409)
    const publish = await action({ action: 'push', remote: 'origin' })
    expect(publish.statusCode, publish.body).toBe(200)
    expect((await snapshot()).upstream).toBe('origin/main')
    const peer = join(workspace, 'peer')
    await git(['clone', bare, peer])
    await git(['config', 'user.name', 'Peer'], peer)
    await git(['config', 'user.email', 'peer@example.test'], peer)
    await git(['config', 'commit.gpgsign', 'false'], peer)
    await writeFile(join(peer, 'peer.txt'), 'remote\n')
    await git(['add', '.'], peer)
    await git(['commit', '-m', 'Peer change'], peer)
    await git(['push'], peer)
    expect((await action({ action: 'fetch' })).statusCode).toBe(200)
    expect((await snapshot()).behind).toBe(1)
    const pulled = await action({ action: 'pull' })
    expect(pulled.statusCode, pulled.body).toBe(200)
    expect(await readFile(join(repository, 'peer.txt'), 'utf8')).toBe('remote\n')
    await commitFile('local.txt', 'local\n', 'Local')
    expect((await snapshot()).ahead).toBe(1)
    expect((await action({ action: 'push' })).statusCode).toBe(200)
    expect(await git(['rev-parse', 'main'], bare)).toBe((await snapshot()).commit)
    await git(['switch', '-c', 'remote-feature'], peer)
    await git(['push', '-u', 'origin', 'remote-feature'], peer)
    await action({ action: 'fetch' })
    const switched = await action({ action: 'switch', branch: 'origin/remote-feature' })
    expect(switched.statusCode, switched.body).toBe(200)
    expect((await snapshot()).branch).toBe('remote-feature')
    expect((await snapshot()).upstream).toBe('origin/remote-feature')
  })

  it('rejects a diverged pull without modifying local HEAD', async () => {
    await commitFile()
    const bare = join(workspace, 'remote.git')
    await git(['init', '--bare', '--initial-branch=main', bare])
    await git(['remote', 'add', 'origin', bare])
    await action({ action: 'push', remote: 'origin' })
    const original = await git(['rev-parse', 'HEAD'])
    const local = await commitFile('local.txt', 'local\n', 'Local')
    await git(['switch', '-c', 'other', original])
    const remote = await commitFile('remote.txt', 'remote\n', 'Remote')
    await git(['push', 'origin', 'other:main'])
    await git(['switch', 'main'])
    const response = await action({ action: 'pull' })
    expect(response.statusCode).toBe(409)
    expect(await git(['rev-parse', 'HEAD'])).toBe(local)
    expect(await git(['rev-parse', 'main'], bare)).toBe(remote)
    expect((await action({ action: 'push' })).statusCode).toBe(409)
  })

  it('shows conflicts and refuses commit until they are resolved, then reports first-parent merge details', async () => {
    await commitFile()
    await git(['switch', '-c', 'other'])
    const other = await commitFile('file.txt', 'other\n', 'Other')
    await git(['switch', 'main'])
    const main = await commitFile('file.txt', 'main\n', 'Main')
    await expect(git(['merge', 'other'])).rejects.toThrow()
    expect((await snapshot()).operation).toBe('merge')
    expect((await snapshot()).changes[0]).toMatchObject({ conflicted: true })
    expect((await action({ action: 'commit', message: 'Merge' })).statusCode).toBe(409)
    await writeFile(join(repository, 'file.txt'), 'resolved\n')
    await action({ action: 'stage', paths: ['file.txt'] })
    expect((await action({ action: 'commit', message: 'Merge resolved' })).statusCode).toBe(200)
    const merged = (await snapshot()).commit ?? ''
    expect((await read('commit', { commit: merged })).json<{ commit: GitCommit }>()).toMatchObject({ commit: { parents: [main, other] } })
    expect((await read('diff', { path: 'file.txt', area: 'commit', commit: merged })).json<GitDiff>()).toMatchObject({ oldContent: 'main\n', newContent: 'resolved\n' })
  })
})
