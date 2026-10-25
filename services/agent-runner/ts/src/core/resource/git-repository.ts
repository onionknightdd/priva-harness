export interface GitChange {
  readonly path: string
  readonly originalPath: string | null
  readonly indexStatus: string
  readonly worktreeStatus: string
  readonly conflicted: boolean
}

export interface GitBranch {
  readonly name: string
  readonly current: boolean
  readonly remote: boolean
  readonly upstream: string | null
}

export interface GitRepository {
  readonly cwd: string
  readonly root: string | null
  readonly branch: string | null
  readonly commit: string | null
  readonly upstream: string | null
  readonly remote: string | null
  readonly remotes: string[]
  readonly ahead: number
  readonly behind: number
  readonly operation: 'merge' | 'rebase' | 'cherry-pick' | null
  readonly changes: GitChange[]
  readonly branches: GitBranch[]
}

export interface GitCommit {
  readonly id: string
  readonly shortId: string
  readonly parents: string[]
  readonly subject: string
  readonly body: string
  readonly authorName: string
  readonly authoredAt: string
}

export interface GitCommitFile {
  readonly path: string
  readonly originalPath: string | null
  readonly status: string
  readonly additions: number | null
  readonly deletions: number | null
}

export type GitDiffArea = 'staged' | 'unstaged' | 'untracked' | 'commit'

export interface GitDiff {
  readonly path: string
  readonly oldPath: string | null
  readonly area: GitDiffArea
  readonly oldLabel: string
  readonly newLabel: string
  readonly patch: string
  readonly oldContent: string | null
  readonly newContent: string | null
  readonly binary: boolean
  readonly truncated: boolean
}

export interface GitAction {
  readonly cwd: string
  readonly expectedBranch: string | null
  readonly expectedCommit: string | null
  readonly action: 'stage' | 'unstage' | 'commit' | 'switch' | 'create-branch' | 'set-upstream' | 'fetch' | 'pull' | 'push'
  readonly paths?: string[]
  readonly message?: string
  readonly branch?: string
  readonly startPoint?: string
  readonly remote?: string
}

export class GitRepositoryError extends Error {
  constructor(
    readonly statusCode: 400 | 403 | 404 | 409 | 413 | 500 | 503,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options)
    this.name = 'GitRepositoryError'
  }
}
