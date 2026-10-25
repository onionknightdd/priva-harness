const GIT_API_PREFIX = "/api/sandbox/git"

export type GitChange = {
  path: string
  originalPath: string | null
  indexStatus: string
  worktreeStatus: string
  conflicted: boolean
}

export type GitBranch = {
  name: string
  current: boolean
  remote: boolean
  upstream: string | null
}

export type GitRepository = {
  cwd: string
  root: string | null
  branch: string | null
  commit: string | null
  upstream: string | null
  remote: string | null
  remotes: string[]
  ahead: number
  behind: number
  operation: "merge" | "rebase" | "cherry-pick" | null
  changes: GitChange[]
  branches: GitBranch[]
}

export type GitCommit = {
  id: string
  shortId: string
  parents: string[]
  subject: string
  body: string
  authorName: string
  authoredAt: string
}

export type GitCommitFile = {
  path: string
  originalPath: string | null
  status: string
  additions: number | null
  deletions: number | null
}

export type GitHistory = { commits: GitCommit[]; hasMore: boolean }
export type GitCommitDetails = { commit: GitCommit; files: GitCommitFile[] }
export type GitDiffArea = "staged" | "unstaged" | "untracked" | "commit"
export type GitDiff = {
  path: string
  oldPath: string | null
  area: GitDiffArea
  oldLabel: string
  newLabel: string
  patch: string
  oldContent: string | null
  newContent: string | null
  binary: boolean
  truncated: boolean
}

export type GitAction = "stage" | "unstage" | "commit" | "switch" | "create-branch" | "set-upstream" | "fetch" | "pull" | "push"
export type GitActionOptions = {
  action: GitAction
  paths?: string[]
  message?: string
  branch?: string
  startPoint?: string
  remote?: string
}
export type GitActionInput = GitActionOptions & {
  cwd: string
  expectedBranch: string | null
  expectedCommit: string | null
}
export type GitActionResult = { repository: GitRepository; message: string }

export class GitRepositoryApiError extends Error {
  readonly status: number

  constructor(status: number, message: string) {
    super(message)
    this.name = "GitRepositoryApiError"
    this.status = status
  }
}

async function requestJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { cache: "no-store", ...init })
  if (!response.ok) {
    let detail = response.statusText || `HTTP ${response.status}`
    try {
      const payload: { detail?: string } = await response.json()
      if (payload.detail) detail = payload.detail
    } catch {
      // A proxy may return an HTML error instead of the runner's JSON response.
    }
    throw new GitRepositoryApiError(response.status, detail)
  }
  return response.json()
}

export function readGitRepository(cwd: string, signal?: AbortSignal) {
  return requestJson<GitRepository>(`${GIT_API_PREFIX}/repository?${new URLSearchParams({ cwd })}`, { signal })
}

export function readGitHistory(cwd: string, options: { skip?: number; limit?: number } = {}, signal?: AbortSignal) {
  const query = new URLSearchParams({ cwd })
  if (options.skip !== undefined) query.set("skip", String(options.skip))
  if (options.limit !== undefined) query.set("limit", String(options.limit))
  return requestJson<GitHistory>(`${GIT_API_PREFIX}/history?${query}`, { signal })
}

export function readGitCommit(cwd: string, commit: string, signal?: AbortSignal) {
  return requestJson<GitCommitDetails>(`${GIT_API_PREFIX}/commit?${new URLSearchParams({ cwd, commit })}`, { signal })
}

export function readGitDiff(cwd: string, options: { path: string; area: GitDiffArea; commit?: string }, signal?: AbortSignal) {
  const query = new URLSearchParams({ cwd, path: options.path, area: options.area })
  if (options.commit !== undefined) query.set("commit", options.commit)
  return requestJson<GitDiff>(`${GIT_API_PREFIX}/diff?${query}`, { signal })
}

export function performGitAction(input: GitActionInput) {
  // Writes deliberately have no AbortSignal: navigation cannot undo a Git mutation.
  return requestJson<GitActionResult>(`${GIT_API_PREFIX}/action`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  })
}

export const GIT_UPDATED_EVENT = "git-updated"
export type GitUpdatedDetail = { cwd: string; root: string | null }

export function dispatchGitUpdated(detail: GitUpdatedDetail) {
  window.dispatchEvent(new window.CustomEvent<GitUpdatedDetail>(GIT_UPDATED_EVENT, { detail }))
}
