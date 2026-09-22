import type { GitStatus } from '../resource/git-status.js'

export interface GitStatusReader {
  read(cwd: string): Promise<GitStatus>
}
