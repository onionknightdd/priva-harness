/** Text for an unknown thrown value, without assuming it is an Error. */
export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** True when a thrown value carries the given `code`, as Node system errors do. */
export function hasErrorCode(error: unknown, code: string): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === code
}
