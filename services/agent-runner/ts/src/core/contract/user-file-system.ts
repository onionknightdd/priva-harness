import type { UserAttachment } from '../run/user-turn.js'
import type {
  CreatedUserDirectory,
  DeletedUserPath,
  UserFileDirectory,
  UserFileDownload,
  UserFilePreview,
  UserFileUploadResult,
} from '../resource/user-file.js'

export interface PendingUserFileUpload {
  readonly fileName: string

  write(content: AsyncIterable<Uint8Array>): Promise<void>
  commit(directory: string, purpose?: 'attachment'): Promise<UserFileUploadResult>
  abort(): Promise<void>
}

export interface UserFileSystem {
  readonly initialDirectory: string
  readonly maxUploadBytes: number

  listDirectory(path: string): Promise<UserFileDirectory>
  createDirectory(directory: string, name: string): Promise<CreatedUserDirectory>
  deletePath(path: string): Promise<DeletedUserPath>
  openDownload(path: string): Promise<UserFileDownload>
  previewFile(path: string): Promise<UserFilePreview>
  /**
   * Whether each path can be previewed as a file. Mirrors `previewFile`
   * without reading content: unreadable files still count as existing so the
   * UI links them and surfaces the access error on open.
   */
  filesExist(paths: readonly string[]): Promise<Record<string, boolean>>
  inspectAttachment(path: string): Promise<UserAttachment>
  beginUpload(fileName: string): Promise<PendingUserFileUpload>
}
