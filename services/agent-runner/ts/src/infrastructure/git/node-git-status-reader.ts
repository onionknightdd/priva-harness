import { execFile } from 'node:child_process'
import { realpath, stat } from 'node:fs/promises'
import { isAbsolute, relative, sep } from 'node:path'
import { promisify } from 'node:util'

import type { GitStatusReader } from '../../core/contract/git-status-reader.js'
import { GitStatusError, type GitStatus } from '../../core/resource/git-status.js'

const execFileAsync = promisify(execFile)

export class NodeGitStatusReader implements GitStatusReader {
  constructor(private readonly workspaceDirectory: string) {}

  async read(requestedCwd: string): Promise<GitStatus> {
    const cwd = await this.resolveDirectory(requestedCwd)
    const empty = { cwd, root: null, branch: null, commit: null }
    const env = gitEnvironment()
    try {
      let root: string
      try {
        root = await runGit(cwd, ['rev-parse', '--show-toplevel'], env)
      } catch (error) {
        // Only absence of a worktree is an empty result. Broken repositories,
        // unsafe ownership, missing Git, and timeouts must remain visible errors.
        if (isGitExit(error, 128) && typeof error.stderr === 'string'
          && (error.stderr.startsWith('fatal: not a git repository (or any of the parent directories):')
            || error.stderr.trim() === 'fatal: this operation must be run in a work tree')) {
          return empty
        }
        throw error
      }

      let branch: string | null
      try {
        branch = await runGit(cwd, ['symbolic-ref', '--quiet', '--short', 'HEAD'], env)
      } catch (error) {
        if (!isGitExit(error, 1)) throw error
        branch = null
      }

      let commit: string | null
      try {
        commit = await runGit(cwd, ['rev-parse', '--verify', '--quiet', '--short=7', 'HEAD'], env)
      } catch (error) {
        // A newly initialized repository has a branch but no commit yet.
        if (branch === null || !isGitExit(error, 1)) throw error
        commit = null
      }
      return { cwd, root, branch, commit }
    } catch (error) {
      if (hasCode(error, 'ENOENT')) {
        throw new GitStatusError(503, 'Git is unavailable. Install Git on the runner and retry.', { cause: error })
      }
      throw new GitStatusError(500, 'Could not read Git status. Check repository access and retry.', { cause: error })
    }
  }

  private async resolveDirectory(requestedCwd: string): Promise<string> {
    if (!isAbsolute(requestedCwd) || requestedCwd.includes('\0')) {
      throw new GitStatusError(400, 'cwd must be an absolute directory path')
    }
    try {
      const [workspace, cwd] = await Promise.all([
        realpath(this.workspaceDirectory), realpath(requestedCwd),
      ])
      const pathFromRoot = relative(workspace, cwd)
      if (pathFromRoot === '..' || pathFromRoot.startsWith(`..${sep}`) || isAbsolute(pathFromRoot)) {
        throw new GitStatusError(403, 'Directory is outside WORKSPACE_DIR')
      }
      if (!(await stat(cwd)).isDirectory()) {
        throw new GitStatusError(400, 'cwd must point to a directory')
      }
      return cwd
    } catch (error) {
      if (error instanceof GitStatusError) throw error
      if (hasCode(error, 'ENOENT') || hasCode(error, 'ENOTDIR')) {
        throw new GitStatusError(404, 'Working directory not found', { cause: error })
      }
      if (hasCode(error, 'EACCES') || hasCode(error, 'EPERM')) {
        throw new GitStatusError(403, 'Cannot access the working directory', { cause: error })
      }
      throw new GitStatusError(500, 'Could not read the working directory', { cause: error })
    }
  }
}

async function runGit(cwd: string, args: string[], env: NodeJS.ProcessEnv): Promise<string> {
  const { stdout } = await execFileAsync('git', ['-C', cwd, ...args], {
    env, encoding: 'utf8', timeout: 3000, maxBuffer: 64 * 1024,
  })
  return stdout.replace(/\r?\n$/u, '')
}

function gitEnvironment(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env, LC_ALL: 'C', GIT_OPTIONAL_LOCKS: '0' }
  // A runner launched from a Git hook must still inspect the requested cwd.
  delete env['GIT_DIR']
  delete env['GIT_WORK_TREE']
  delete env['GIT_COMMON_DIR']
  delete env['GIT_INDEX_FILE']
  delete env['GIT_OBJECT_DIRECTORY']
  delete env['GIT_ALTERNATE_OBJECT_DIRECTORIES']
  return env
}

function hasCode(error: unknown, code: string): boolean {
  return error instanceof Error && 'code' in error && error.code === code
}

function isGitExit(error: unknown, code: number): error is Error & { stderr?: unknown } {
  return error instanceof Error && 'code' in error && error.code === code
    && !('killed' in error && error.killed)
}
