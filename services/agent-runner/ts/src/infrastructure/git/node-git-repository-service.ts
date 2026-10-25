import { execFile } from 'node:child_process'
import { lstat, open, realpath, stat } from 'node:fs/promises'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { promisify } from 'node:util'

import type { GitRepositoryService } from '../../core/contract/git-repository-service.js'
import { GitRepositoryError, type GitAction, type GitCommit, type GitCommitFile, type GitDiff, type GitDiffArea, type GitRepository } from '../../core/resource/git-repository.js'
import { parseBranches, parseChanges, parseCommitFiles, parseCommits } from './git-output.js'

const execFileAsync = promisify(execFile)
const CONTENT_LIMIT = 256 * 1024
const PATCH_LIMIT = 512 * 1024
const LOG_FORMAT = '--format=%H%x00%h%x00%P%x00%s%x00%b%x00%an%x00%aI'
const mutationQueues = new Map<string, Promise<void>>()
interface RepositoryContext { cwd: string; root: string; gitDirectory: string; commonDirectory: string }
interface CommandOutput { stdout: Buffer; truncated: boolean }
interface Content { text: string | null; binary: boolean; truncated: boolean }

export class NodeGitRepositoryService implements GitRepositoryService {
  constructor(private readonly workspaceDirectory: string) {}

  async read(requestedCwd: string): Promise<GitRepository> {
    const cwd = await this.resolveDirectory(requestedCwd)
    const context = await this.context(cwd)
    if (!context) return { cwd, root: null, branch: null, commit: null, upstream: null, remote: null, remotes: [], ahead: 0, behind: 0, operation: null, changes: [], branches: [] }
    const root = context.root
    const branch = await this.optional(root, ['symbolic-ref', '--quiet', '--short', 'HEAD'], [1])
    const commit = await this.optional(root, ['rev-parse', '--verify', '--quiet', 'HEAD'], [1])
    const [status, refs, remotesText, upstreamRef, remote] = await Promise.all([
      this.git(root, ['status', '--porcelain=v1', '-z', '--untracked-files=all']),
      this.git(root, ['for-each-ref', '--format=%(refname)%00%(HEAD)%00%(upstream)%00%(symref)', 'refs/heads/', 'refs/remotes/']),
      this.git(root, ['remote']),
      branch && commit ? this.optional(root, ['rev-parse', '--symbolic-full-name', '@{upstream}'], [128]) : null,
      branch ? this.optional(root, ['config', '--get', `branch.${branch}.remote`], [1]) : null,
    ])
    const upstream = upstreamRef?.replace(/^refs\/(heads|remotes)\//u, '') ?? null
    let ahead = 0
    let behind = 0
    if (upstream) {
      const counts = (await this.git(root, ['rev-list', '--left-right', '--count', 'HEAD...@{upstream}'])).trim().split(/\s+/u)
      ahead = Number(counts[0]); behind = Number(counts[1])
    }
    const operation = await exists(join(context.gitDirectory, 'rebase-merge')) || await exists(join(context.gitDirectory, 'rebase-apply')) ? 'rebase'
      : await exists(join(context.gitDirectory, 'MERGE_HEAD')) ? 'merge'
        : await exists(join(context.gitDirectory, 'CHERRY_PICK_HEAD')) ? 'cherry-pick' : null
    return { cwd, root, branch, commit, upstream, remote, remotes: remotesText.trim().split('\n').filter(Boolean), ahead, behind, operation,
      changes: parseChanges(status), branches: parseBranches(refs) }
  }

  async history(cwd: string, skip: number, limit: number): Promise<{ commits: GitCommit[]; hasMore: boolean }> {
    const context = await this.requiredContext(cwd)
    if (!await this.optional(context.root, ['rev-parse', '--verify', '--quiet', 'HEAD'], [1])) return { commits: [], hasMore: false }
    const commits = parseCommits(await this.git(context.root, ['log', '-z', LOG_FORMAT, `--skip=${skip}`, `--max-count=${limit + 1}`, 'HEAD', '--']))
    return { commits: commits.slice(0, limit), hasMore: commits.length > limit }
  }

  async commit(cwd: string, revision: string): Promise<{ commit: GitCommit; files: GitCommitFile[] }> {
    const context = await this.requiredContext(cwd)
    const commit = await this.commitMetadata(context.root, revision)
    const base = commit.parents[0]
    const args = base ? ['diff', base, commit.id] : ['diff-tree', '--root', '--no-commit-id', '-r', commit.id]
    const [names, counts] = await Promise.all([
      this.git(context.root, [...args, '--find-renames', '--name-status', '-z', '--']),
      this.git(context.root, [...args, '--find-renames', '--numstat', '-z', '--']),
    ])
    return { commit, files: parseCommitFiles(names, counts) }
  }

  async diff(cwd: string, path: string, area: GitDiffArea, revision?: string): Promise<GitDiff> {
    const context = await this.requiredContext(cwd)
    await this.validatePath(context, path)
    let oldPath: string | null
    let oldRevision: string | null
    let newRevision: string | null
    let oldLabel: string
    let newLabel: string
    let args: string[]
    if (area === 'commit') {
      if (!revision) throw new GitRepositoryError(400, 'A commit is required for commit diffs')
      const details = await this.commit(cwd, revision)
      const file = details.files.find((entry) => entry.path === path)
      if (!file) throw new GitRepositoryError(404, 'The selected file is not changed in this commit')
      oldPath = file.originalPath
      oldRevision = details.commit.parents[0] ?? null
      newRevision = details.commit.id
      oldLabel = oldRevision?.slice(0, 7) ?? 'Empty tree'
      newLabel = details.commit.shortId
      args = oldRevision ? ['diff', oldRevision, newRevision] : ['show', '--format=', newRevision]
    } else {
      const repository = await this.read(context.root)
      const change = repository.changes.find((entry) => entry.path === path)
      if (!change) throw new GitRepositoryError(404, 'This file no longer has changes. Refresh the Git view.')
      if (area === 'untracked' && change.indexStatus !== '?') throw new GitRepositoryError(409, 'This file is now tracked. Refresh the Git view.')
      oldPath = area === 'staged' ? change.originalPath : null
      oldRevision = area === 'staged' ? repository.commit : area === 'untracked' ? null : ''
      newRevision = area === 'staged' ? '' : null
      oldLabel = area === 'staged' ? 'HEAD' : area === 'untracked' ? 'Untracked' : 'Index'
      newLabel = area === 'staged' ? 'Index' : 'Working tree'
      args = ['diff', ...(area === 'staged' ? ['--cached'] : [])]
    }
    if (oldPath) await this.validatePath(context, oldPath)
    const oldContent = oldRevision === null ? emptyContent() : await this.blob(context.root, `${oldRevision}:${oldPath ?? path}`)
    const newContent = newRevision === null ? await this.worktreeContent(context, path) : await this.blob(context.root, `${newRevision}:${path}`)
    let patch: string
    let patchTruncated: boolean
    if (area === 'untracked') {
      patch = newContent.binary || newContent.text === null ? '' : untrackedPatch(path, newContent.text)
      patchTruncated = Buffer.byteLength(patch) > PATCH_LIMIT
      if (patchTruncated) patch = Buffer.from(patch).subarray(0, PATCH_LIMIT).toString('utf8')
    } else {
      const result = await this.command(context.root, [...args, '--no-ext-diff', '--no-textconv', '--find-renames', '--no-color', '--', path, ...(oldPath ? [oldPath] : [])], { maxBuffer: PATCH_LIMIT, truncate: true })
      patch = result.stdout.toString('utf8'); patchTruncated = result.truncated
    }
    return { path, oldPath, area, oldLabel, newLabel, patch, oldContent: oldContent.text, newContent: newContent.text,
      binary: oldContent.binary || newContent.binary || patch.includes('Binary files '), truncated: oldContent.truncated || newContent.truncated || patchTruncated }
  }

  async action(input: GitAction): Promise<{ repository: GitRepository; message: string }> {
    const context = await this.requiredContext(input.cwd)
    // Linked worktrees share refs, so writes are serialized by the common Git directory.
    const prior = mutationQueues.get(context.commonDirectory) ?? Promise.resolve()
    let release!: () => void
    const current = new Promise<void>((resolvePromise) => { release = resolvePromise })
    const queued = prior.then(() => current)
    mutationQueues.set(context.commonDirectory, queued)
    await prior
    try {
      const repository = await this.read(input.cwd)
      if (repository.branch !== input.expectedBranch || repository.commit !== input.expectedCommit) {
        throw new GitRepositoryError(409, 'Git HEAD changed. Refresh the Git view and retry your action.')
      }
      const message = await this.perform(context, repository, input)
      return { repository: await this.read(context.root), message }
    } finally {
      release()
      if (mutationQueues.get(context.commonDirectory) === queued) mutationQueues.delete(context.commonDirectory)
    }
  }

  private async perform(context: RepositoryContext, repository: GitRepository, input: GitAction): Promise<string> {
    const root = context.root
    if (input.action === 'stage' || input.action === 'unstage') {
      if (!input.paths?.length) throw new GitRepositoryError(400, 'Select at least one file')
      const paths = new Set<string>()
      for (const path of input.paths) {
        await this.validatePath(context, path)
        const change = repository.changes.find((entry) => entry.path === path)
        if (!change) throw new GitRepositoryError(409, `The status of ${path} changed. Refresh and retry.`)
        paths.add(change.path)
        if (change.originalPath) {
          await this.validatePath(context, change.originalPath)
          // A staged rename has already removed its source from the index. Adding
          // that absent source again fails; unstaging must still restore both sides.
          if (input.action === 'unstage' || !['R', 'C'].includes(change.indexStatus)) paths.add(change.originalPath)
        }
      }
      if (input.action === 'stage') await this.git(root, ['add', '--all', '--', ...paths])
      else if (repository.commit) await this.git(root, ['restore', '--staged', '--', ...paths])
      else await this.git(root, ['rm', '--cached', '--force', '--ignore-unmatch', '--', ...paths])
      return input.action === 'stage' ? 'Selected files staged' : 'Selected files unstaged'
    }
    if (input.action === 'commit') {
      if (!input.message?.trim()) throw new GitRepositoryError(400, 'Enter a commit message')
      if (repository.changes.some((change) => change.conflicted)) throw new GitRepositoryError(409, 'Resolve and stage all conflicts before committing')
      if (repository.operation === 'rebase' || repository.operation === 'cherry-pick') throw new GitRepositoryError(409, `Finish the ${repository.operation} in a terminal before committing here`)
      if (repository.operation !== 'merge' && !repository.changes.some((change) => change.indexStatus !== ' ' && change.indexStatus !== '?')) throw new GitRepositoryError(409, 'Stage changes before committing')
      await this.git(root, ['commit', '-m', input.message])
      return 'Staged changes committed'
    }
    if (input.action === 'switch' || input.action === 'create-branch') {
      if (repository.operation) throw new GitRepositoryError(409, `Finish the ${repository.operation} before switching branches`)
      const branch = input.branch
      if (!branch || branch.startsWith('-') || branch.includes('\0') || branch.includes('@{')) throw new GitRepositoryError(400, 'Enter a valid branch name')
      await this.git(root, ['check-ref-format', '--branch', branch])
      if (input.action === 'switch') {
        const selected = repository.branches.find((entry) => entry.name === branch)
        if (!selected) throw new GitRepositoryError(404, 'Branch no longer exists. Refresh and retry.')
        if (selected.remote) await this.git(root, ['switch', '--track', branch])
        else await this.git(root, ['switch', '--', branch])
      } else {
        if (input.startPoint) {
          const startPoint = await this.resolveCommit(root, input.startPoint)
          await this.git(root, ['switch', '-c', branch, startPoint])
        } else await this.git(root, ['switch', '-c', branch])
      }
      return `Switched to ${branch}`
    }
    if (input.action === 'set-upstream') {
      if (!repository.branch || !repository.commit) throw new GitRepositoryError(409, 'Check out a local branch with a commit before choosing an upstream')
      if (!input.branch) throw new GitRepositoryError(400, 'Select a remote branch')
      const selected = repository.branches.find((entry) => entry.remote && entry.name === input.branch)
      if (!selected) throw new GitRepositoryError(404, 'Remote branch no longer exists. Fetch remote updates and retry.')
      // A local branch can have the same short name as a remote-tracking ref.
      await this.git(root, ['branch', `--set-upstream-to=refs/remotes/${selected.name}`, '--', repository.branch])
      return `Upstream set to ${selected.name}`
    }
    if (!repository.remotes.length) throw new GitRepositoryError(409, 'No Git remote is configured. Add a remote in the terminal first.')
    if (input.remote && !repository.remotes.includes(input.remote)) throw new GitRepositoryError(400, 'Select a configured remote')
    if (input.action === 'fetch') {
      await this.git(root, ['fetch', ...(input.remote ? ['--', input.remote] : ['--all'])], true)
      return 'Remote references refreshed'
    }
    if (!repository.branch || !repository.commit) throw new GitRepositoryError(409, 'Check out a branch with a commit before using Pull or Push')
    if (repository.operation) throw new GitRepositoryError(409, `Finish the ${repository.operation} before using Pull or Push`)
    if (input.action === 'pull') {
      if (!repository.upstream) throw new GitRepositoryError(409, 'This branch has no upstream. Publish it with Push first.')
      if (repository.changes.length) throw new GitRepositoryError(409, 'Commit your changes before pulling')
      await this.git(root, ['-c', 'pull.rebase=false', '-c', 'pull.autostash=false', '-c', 'merge.autostash=false', 'pull', '--ff-only', '--no-rebase'], true)
      return 'Branch updated from upstream'
    }
    const remote = repository.upstream ? repository.remote : input.remote
    if (!remote || remote === '.') throw new GitRepositoryError(409, 'Select a remote to publish this branch')
    if (remote.startsWith('-')) throw new GitRepositoryError(400, 'Remote name must not start with a dash')
    // Explicit refspec ignores push.default, remote push refspecs, and mirror settings.
    const destination = repository.upstream ? await this.optional(root, ['config', '--get', `branch.${repository.branch}.merge`], [1]) : `refs/heads/${repository.branch}`
    if (!destination?.startsWith('refs/heads/')) throw new GitRepositoryError(409, 'The upstream must be a remote branch')
    await this.git(root, ['-c', `remote.${remote}.mirror=false`, '-c', 'push.recurseSubmodules=no', 'push', '--no-follow-tags', ...(repository.upstream ? [] : ['--set-upstream']), '--', remote, `HEAD:${destination}`], true)
    return repository.upstream ? 'Branch pushed to upstream' : 'Branch published with upstream tracking'
  }

  private async commitMetadata(root: string, revision: string): Promise<GitCommit> {
    const sha = await this.resolveCommit(root, revision)
    const commit = parseCommits(await this.git(root, ['log', '-1', '-z', LOG_FORMAT, sha, '--']))[0]
    if (!commit) throw new GitRepositoryError(404, 'Commit not found')
    return commit
  }

  private async resolveCommit(root: string, revision: string): Promise<string> {
    if (!/^[a-f0-9]{7,64}$/iu.test(revision)) throw new GitRepositoryError(400, 'Commit must be a hexadecimal commit ID')
    const sha = await this.optional(root, ['rev-parse', '--verify', '--quiet', `${revision}^{commit}`], [1, 128])
    if (!sha) throw new GitRepositoryError(404, 'Commit not found')
    return sha
  }

  private async blob(root: string, object: string): Promise<Content> {
    const type = await this.optional(root, ['cat-file', '-t', object], [128])
    if (type === null) return emptyContent()
    if (type !== 'blob') return { text: null, binary: true, truncated: false }
    const size = await this.optional(root, ['cat-file', '-s', object], [128])
    if (size === null) return emptyContent()
    if (Number(size) > CONTENT_LIMIT) return { text: null, binary: false, truncated: true }
    return decodeContent((await this.command(root, ['cat-file', 'blob', object])).stdout)
  }

  private async worktreeContent(context: RepositoryContext, path: string): Promise<Content> {
    const target = join(context.root, path)
    try {
      const metadata = await lstat(target)
      if (!metadata.isFile()) return { text: null, binary: true, truncated: false }
      if (metadata.size > CONTENT_LIMIT) return { text: null, binary: false, truncated: true }
      const file = await open(target, 'r')
      try {
        const buffer = Buffer.alloc(CONTENT_LIMIT + 1)
        const { bytesRead } = await file.read(buffer, 0, buffer.length, 0)
        return bytesRead > CONTENT_LIMIT ? { text: null, binary: false, truncated: true } : decodeContent(buffer.subarray(0, bytesRead))
      } finally { await file.close() }
    } catch (error) {
      if (hasCode(error, 'ENOENT')) return emptyContent()
      throw error
    }
  }

  private async requiredContext(cwd: string): Promise<RepositoryContext> {
    const context = await this.context(await this.resolveDirectory(cwd))
    if (!context) throw new GitRepositoryError(409, 'This directory is not a Git working tree')
    return context
  }

  private async context(cwd: string): Promise<RepositoryContext | null> {
    if (cwd.split(sep).some((part) => part.toLowerCase() === '.git')) throw new GitRepositoryError(403, 'Git administrative directories cannot be browsed')
    let root: string
    try { root = (await this.git(cwd, ['rev-parse', '--show-toplevel'])).trimEnd() } catch (error) {
      if (error instanceof GitRepositoryError && error.cause instanceof Error && 'stderr' in error.cause
        && typeof error.cause.stderr === 'string' && (error.cause.stderr.startsWith('fatal: not a git repository (or any of the parent directories):')
          || error.cause.stderr.trim() === 'fatal: this operation must be run in a work tree')) return null
      throw error
    }
    root = await this.resolveDirectory(root)
    const [gitDirectory, commonDirectory] = await Promise.all([
      this.git(root, ['rev-parse', '--absolute-git-dir']).then((value) => this.resolveDirectory(value.trimEnd())),
      this.git(root, ['rev-parse', '--path-format=absolute', '--git-common-dir']).then((value) => this.resolveDirectory(value.trimEnd())),
    ])
    if (within(gitDirectory, cwd) || within(commonDirectory, cwd)) throw new GitRepositoryError(403, 'Git administrative directories cannot be browsed')
    return { cwd, root, gitDirectory, commonDirectory }
  }

  private async resolveDirectory(requested: string): Promise<string> {
    if (!isAbsolute(requested) || requested.includes('\0')) throw new GitRepositoryError(400, 'cwd must be an absolute directory path')
    try {
      const [workspace, directory] = await Promise.all([realpath(this.workspaceDirectory), realpath(requested)])
      if (!within(workspace, directory)) throw new GitRepositoryError(403, 'Directory is outside WORKSPACE_DIR')
      if (!(await stat(directory)).isDirectory()) throw new GitRepositoryError(400, 'cwd must point to a directory')
      return directory
    } catch (error) {
      if (error instanceof GitRepositoryError) throw error
      if (hasCode(error, 'ENOENT') || hasCode(error, 'ENOTDIR')) throw new GitRepositoryError(404, 'Working directory not found', { cause: error })
      if (hasCode(error, 'EACCES') || hasCode(error, 'EPERM')) throw new GitRepositoryError(403, 'Cannot access the working directory', { cause: error })
      throw new GitRepositoryError(500, 'Could not read the working directory', { cause: error })
    }
  }

  private async validatePath(context: RepositoryContext, path: string): Promise<void> {
    if (!path || isAbsolute(path) || path.includes('\0') || path.includes('\\') || path.split('/').some((part) => part === '..' || part === '.' || part.toLowerCase() === '.git' || !part)) {
      throw new GitRepositoryError(400, 'File paths must be relative repository paths outside Git administrative directories')
    }
    let target = resolve(context.root, path)
    for (;;) {
      try {
        const resolved = await realpath(target)
        if (!within(context.root, resolved) || within(context.gitDirectory, resolved) || within(context.commonDirectory, resolved)) throw new GitRepositoryError(403, 'File path escapes the repository or points into Git administrative data')
        return
      } catch (error) {
        if (!hasCode(error, 'ENOENT')) throw error
        const parent = dirname(target)
        if (parent === target) throw new GitRepositoryError(403, 'Invalid repository path')
        target = parent
      }
    }
  }

  private async git(cwd: string, args: string[], remote = false): Promise<string> {
    return (await this.command(cwd, args, { remote })).stdout.toString('utf8')
  }

  private async optional(cwd: string, args: string[], codes: number[]): Promise<string | null> {
    try { return (await this.git(cwd, args)).trimEnd() } catch (error) {
      if (error instanceof GitRepositoryError && error.cause instanceof Error && 'code' in error.cause && codes.includes(Number(error.cause.code))) return null
      throw error
    }
  }

  private async command(cwd: string, args: string[], options: { remote?: boolean; maxBuffer?: number; truncate?: boolean } = {}): Promise<CommandOutput> {
    try {
      const { stdout } = await execFileAsync('git', ['--literal-pathspecs', '-c', 'core.quotepath=false', '-c', 'color.ui=false', '-c', 'core.pager=cat', '-C', cwd, ...args], {
        env: gitEnvironment(), encoding: 'buffer', timeout: options.remote ? 60_000 : 15_000, maxBuffer: options.maxBuffer ?? 4 * 1024 * 1024,
      })
      return { stdout, truncated: false }
    } catch (error) {
      if (options.truncate && hasCode(error, 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER') && error instanceof Error && 'stdout' in error && Buffer.isBuffer(error.stdout)) return { stdout: error.stdout.subarray(0, options.maxBuffer), truncated: true }
      if (hasCode(error, 'ENOENT')) throw new GitRepositoryError(503, 'Git is unavailable. Install Git on the runner and retry.', { cause: error })
      if (error instanceof Error && 'killed' in error && error.killed) throw new GitRepositoryError(503, 'Git operation timed out. Check the repository or remote connection and refresh before retrying.', { cause: error })
      const stderr = error instanceof Error && 'stderr' in error && Buffer.isBuffer(error.stderr) ? error.stderr.toString('utf8')
        : error instanceof Error && 'stderr' in error && typeof error.stderr === 'string' ? error.stderr : ''
      // Keep diagnostics actionable while avoiding credentials embedded in remote URLs.
      const detail = stderr.trim().replace(/(https?:\/\/)[^\s/@]+:[^\s/@]+@/gu, '$1[redacted]@').slice(0, 2000)
      const cause = error instanceof Error ? Object.assign(error, { stderr }) : error
      throw new GitRepositoryError(hasCode(error, 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER') ? 413 : 409, detail || 'Git operation failed. Check repository access and retry.', { cause })
    }
  }
}

function gitEnvironment(): NodeJS.ProcessEnv {
  const inherited = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^GIT_(DIR|WORK_TREE|COMMON_DIR|INDEX_FILE|OBJECT_DIRECTORY|ALTERNATE_OBJECT_DIRECTORIES|CONFIG_COUNT|CONFIG_KEY_.*|CONFIG_VALUE_.*|CONFIG_PARAMETERS|NAMESPACE|CEILING_DIRECTORIES|DISCOVERY_ACROSS_FILESYSTEM|EXTERNAL_DIFF|DIFF_OPTS)$/u.test(key)))
  return { ...inherited, LC_ALL: 'C', GIT_TERMINAL_PROMPT: '0', GIT_EDITOR: 'true', GIT_SEQUENCE_EDITOR: 'true', GCM_INTERACTIVE: 'never', GIT_SSH_COMMAND: 'ssh -oBatchMode=yes -oConnectTimeout=15', GIT_PAGER: 'cat' }
}
function within(root: string, path: string): boolean {
  const result = relative(root, path)
  return result !== '..' && !result.startsWith(`..${sep}`) && !isAbsolute(result)
}
function hasCode(error: unknown, code: string): boolean { return error instanceof Error && 'code' in error && error.code === code }
async function exists(path: string): Promise<boolean> {
  try { await stat(path); return true } catch (error) { if (hasCode(error, 'ENOENT')) return false; throw error }
}
function emptyContent(): Content { return { text: null, binary: false, truncated: false } }
function decodeContent(buffer: Buffer): Content {
  const binary = buffer.includes(0)
  return { text: binary ? null : buffer.toString('utf8'), binary, truncated: false }
}
function untrackedPatch(path: string, content: string): string {
  const lines = content.split('\n')
  if (lines.at(-1) === '') lines.pop()
  if (!lines.length) return `diff --git a/${path} b/${path}\nnew file mode 100644\n`
  return `diff --git a/${path} b/${path}\nnew file mode 100644\n--- /dev/null\n+++ b/${path}\n@@ -0,0 +1,${lines.length} @@\n${lines.map((line) => `+${line}`).join('\n')}\n${content.endsWith('\n') ? '' : '\\ No newline at end of file\n'}`
}
