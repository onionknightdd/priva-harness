export const DEFAULT_USER_FILE_UPLOAD_LIMIT_BYTES = 100 * 1024 * 1024
export const USER_FILE_PREVIEW_LIMIT_BYTES = 1024 * 1024

export type UserFileEntryType = 'file' | 'directory'

export interface UserFileEntry {
  readonly path: string
  readonly name: string
  readonly type: UserFileEntryType
  readonly size: number | null
  readonly modified: number | null
  readonly permissions: string | null
}

export interface UserFileDirectory {
  readonly path: string
  readonly parent: string | null
  readonly entries: readonly UserFileEntry[]
}

export interface CreatedUserDirectory {
  readonly path: string
  readonly name: string
}

export interface DeletedUserPath {
  readonly status: 'ok'
  readonly path: string
}

export interface UserFileDownload {
  readonly path: string
  readonly name: string
  readonly mimeType: string
  readonly size: number
  readonly modified: number
  readonly content: AsyncIterable<Uint8Array>
}

export interface UserFilePreview {
  readonly path: string
  readonly name: string
  readonly mimeType: string
  readonly size: number
  readonly content: string | null
  readonly isBinary: boolean
  readonly previewUrl: string | null
}

export interface UserFileUploadResult {
  readonly status: 'ok'
  readonly path: string
  readonly name: string
  readonly size: number
}

export type UserFileErrorKind =
  | 'access-denied'
  | 'already-exists'
  | 'file-not-found'
  | 'invalid-path-segment'
  | 'invalid-request'
  | 'io-failure'
  | 'missing-field'
  | 'not-directory'
  | 'upload-too-large'

export class UserFileError extends Error {
  readonly kind: UserFileErrorKind

  constructor(kind: UserFileErrorKind, message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = 'UserFileError'
    this.kind = kind
  }
}
