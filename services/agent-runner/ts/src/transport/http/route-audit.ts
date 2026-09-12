import type { DataRecorder } from '../../core/contract/data-recorder.js'

export interface RouteAuditFields {
  readonly target?: string
  readonly sessionId?: string
  readonly details?: unknown
}

// Records a successful mutating request. Called after the service call
// returned, so failed requests never appear as actions that happened.
// Details must stay free of secrets (auth tokens, MCP headers): pass ids,
// names and flags, not request bodies.
export function auditRoute(
  recorder: DataRecorder | undefined,
  action: string,
  fields: RouteAuditFields = {},
): void {
  recorder?.record({
    kind: 'audit',
    tsUtc: new Date().toISOString(),
    action,
    ...(fields.target === undefined ? {} : { target: fields.target }),
    ...(fields.sessionId === undefined ? {} : { sessionId: fields.sessionId }),
    details: fields.details ?? null,
  })
}
