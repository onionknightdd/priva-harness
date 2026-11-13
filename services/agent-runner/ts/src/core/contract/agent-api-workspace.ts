import type { UserAttachment } from '../run/user-turn.js'

/**
 * File access for Agent API sessions. Every client-supplied path is relative
 * and must stay inside the session's working directory after symlinks resolve.
 */
export interface AgentApiWorkspace {
  /** Absolute Sandbox workspace root that session `workdir` values are relative to. */
  readonly root: string
  readonly maxUploadBytes: number
  /** Resolve a relative workdir to its absolute, existing directory. */
  resolveWorkdir(workdir: string): Promise<{ readonly absolute: string; readonly relative: string }>
  /** The workdir of a native session's cwd, or undefined when it lies outside the workspace. */
  workdirOf(cwd: string): Promise<string | undefined>
  /** Describe an existing file inside `cwd`; `param` names the request field for errors. */
  resolveFile(cwd: string, path: string, param: string): Promise<UserAttachment>
  /** Store inline content as a new attachment, like a WebUI upload. */
  writeAttachment(cwd: string, fileName: string, content: Uint8Array): Promise<UserAttachment>
  upload(cwd: string, fileName: string, content: AsyncIterable<Uint8Array>): Promise<UserAttachment>
  /** Path relative to `cwd` for responses and events. */
  relativePath(cwd: string, absolute: string): string
}
