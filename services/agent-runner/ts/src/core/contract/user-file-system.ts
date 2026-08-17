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
  commit(directory: string): Promise<UserFileUploadResult>
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
  beginUpload(fileName: string): Promise<PendingUserFileUpload>
}
