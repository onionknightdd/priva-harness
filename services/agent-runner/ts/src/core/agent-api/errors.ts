import { z } from 'zod'

export const ERROR_TYPES = [
  'invalid_request',
  'authentication',
  'permission',
  'not_found',
  'conflict',
  'rate_limit',
  'unavailable',
  'internal',
] as const
export type ErrorType = (typeof ERROR_TYPES)[number]

// Codes returned in HTTP responses and WebSocket replies. Errors that happen
// after a stream is open are events (`session.error`, failed runs) instead.
const ERROR_CODES = {
  validation_failed: ['invalid_request', 422],
  image_input_unsupported: ['invalid_request', 422],
  path_outside_workspace: ['invalid_request', 422],
  file_too_large: ['invalid_request', 413],
  cursor_invalid: ['invalid_request', 400],
  cursor_expired: ['invalid_request', 410],
  feature_unavailable: ['permission', 403],
  not_found: ['not_found', 404],
  queue_full: ['rate_limit', 429],
  idempotency_conflict: ['conflict', 409],
  session_driven_by_terminal: ['conflict', 409],
  session_busy: ['conflict', 409],
  interaction_resolved: ['conflict', 409],
  task_runtime_unavailable: ['conflict', 409],
  runtime_start_failed: ['unavailable', 503],
  internal_error: ['internal', 500],
} as const satisfies Record<string, readonly [ErrorType, number]>

export type ErrorCode = keyof typeof ERROR_CODES

export class AgentApiError extends Error {
  readonly code: ErrorCode
  readonly type: ErrorType
  readonly status: number
  readonly param: string | undefined
  readonly details: Readonly<Record<string, unknown>>

  constructor(code: ErrorCode, message: string, options: {
    readonly param?: string
    readonly details?: Readonly<Record<string, unknown>>
    readonly cause?: unknown
  } = {}) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause })
    this.name = 'AgentApiError'
    this.code = code
    this.type = ERROR_CODES[code][0]
    this.status = ERROR_CODES[code][1]
    this.param = options.param
    this.details = options.details ?? {}
  }
}

export const errorBodySchema = z.strictObject({
  error: z.strictObject({
    type: z.enum(ERROR_TYPES),
    code: z.string().min(1),
    message: z.string(),
    param: z.string().optional(),
    request_id: z.string().min(1),
    last_event_seq: z.number().int().nonnegative().optional(),
  }),
})
export type ErrorBody = z.infer<typeof errorBodySchema>

export function errorBody(error: AgentApiError, requestId: string): ErrorBody {
  return {
    error: {
      type: error.type,
      code: error.code,
      message: error.message,
      ...(error.param === undefined ? {} : { param: error.param }),
      request_id: requestId,
      ...error.details,
    },
  }
}

/** Zod issue paths become the `param` a client can point at, e.g. `message.parts[1]`. */
export function validationError(error: z.ZodError, prefix?: string): AgentApiError {
  const issue = error.issues[0]
  const path = [...(prefix === undefined ? [] : [prefix]), ...(issue?.path ?? [])]
  const param = path.reduce<string>((text, segment) => typeof segment === 'number'
    ? `${text}[${String(segment)}]`
    : text === '' ? String(segment) : `${text}.${String(segment)}`, '')
  return new AgentApiError('validation_failed', issue?.message ?? 'Invalid request',
    param === '' ? {} : { param })
}
