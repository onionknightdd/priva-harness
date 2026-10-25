import type { GitAction, GitCommit, GitCommitFile, GitDiff, GitDiffArea, GitRepository } from '../resource/git-repository.js'

export interface GitRepositoryService {
  read(cwd: string): Promise<GitRepository>
  history(cwd: string, skip: number, limit: number): Promise<{ commits: GitCommit[]; hasMore: boolean }>
  commit(cwd: string, commit: string): Promise<{ commit: GitCommit; files: GitCommitFile[] }>
  diff(cwd: string, path: string, area: GitDiffArea, commit?: string): Promise<GitDiff>
  action(input: GitAction): Promise<{ repository: GitRepository; message: string }>
}
