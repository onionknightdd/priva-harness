export interface GitStatus {
  readonly cwd: string
  readonly root: string | null
  readonly branch: string | null
  readonly commit: string | null
}

export class GitStatusError extends Error {
  constructor(
    readonly statusCode: 400 | 403 | 404 | 500 | 503,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options)
    this.name = 'GitStatusError'
  }
}
