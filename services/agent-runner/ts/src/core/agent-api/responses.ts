import { z } from 'zod'

import {
  idSchema,
  interactionSchema,
  runSchema,
  runWithItemsSchema,
  sessionSchema,
  timestampSchema,
} from './objects.js'

const count = z.number().int().nonnegative()

export const capabilitiesSchema = z.strictObject({
  api_version: z.literal('v1'),
  harnesses: z.array(z.enum(['claude', 'pi'])).optional(),
  defaults: z.strictObject({ harness: z.enum(['claude', 'pi']), model: z.string().nullable() }).optional(),
  profiles: z.array(z.strictObject({
    id: z.string().min(1),
    label: z.string(),
    default_model: z.string().nullable(),
    image_input_models: z.array(z.string()),
  })).optional(),
  agent: z.strictObject({ id: z.string().min(1), name: z.string(), release: z.number().int().positive(), description: z.string().optional() }).optional(),
  limits: z.strictObject({ max_upload_bytes: count, max_inline_bytes: count, max_queued_runs: count, max_wait_seconds: count }),
  features: z.strictObject({
    websocket: z.boolean(),
    native_events: z.boolean(),
    interactions: z.boolean(),
    task_stop: z.boolean(),
    settings_update: z.boolean(),
    deliveries: z.array(z.enum(['follow-up', 'steer', 'interrupt'])),
  }),
})
export type Capabilities = z.infer<typeof capabilitiesSchema>

export const runRefSchema = z.strictObject({ id: idSchema('run'), status: z.enum(['queued', 'in_progress']) })

export const messageAcceptedSchema = z.strictObject({
  message: z.strictObject({ id: idSchema('msg') }),
  run: runRefSchema,
  last_event_seq: count,
})
export type MessageAccepted = z.infer<typeof messageAcceptedSchema>

/** A run that ended, or paused on interactions it allows to interrupt it; `interactions` are the pending ones. */
export const runResultSchema = z.strictObject({
  run: runSchema,
  interactions: z.array(interactionSchema),
})
export type RunResult = z.infer<typeof runResultSchema>

/** `response = wait` once the run ended or paused within the wait limit. */
export const messageResultSchema = z.strictObject({
  message: z.strictObject({ id: idSchema('msg') }),
  ...runResultSchema.shape,
  last_event_seq: count,
})
export type MessageResult = z.infer<typeof messageResultSchema>

export const sessionCreatedSchema = z.strictObject({
  session: sessionSchema,
  message: z.strictObject({ id: idSchema('msg') }).optional(),
  run: z.union([runRefSchema, runSchema]).optional(),
  interactions: z.array(interactionSchema).optional(),
  last_event_seq: count.optional(),
})
export type SessionCreated = z.infer<typeof sessionCreatedSchema>

/** Scenario B: agent-studio exchanges the API key for a session token. */
export const publishedSessionCreatedSchema = z.strictObject({
  session: sessionSchema,
  token: z.string().min(1),
  token_expires_at: timestampSchema,
})

export const sessionUpdatedSchema = z.strictObject({
  session: sessionSchema,
  settings_change: z.strictObject({ id: idSchema('chg'), status: z.literal('pending') }).optional(),
})

export const sessionsPageSchema = z.strictObject({ data: z.array(sessionSchema), next_cursor: z.string().nullable() })
export const runsPageSchema = z.strictObject({ data: z.array(runWithItemsSchema), next_cursor: z.string().nullable() })

export const fileUploadedSchema = z.strictObject({
  id: idSchema('file'),
  path: z.string().min(1),
  name: z.string().min(1),
  media_type: z.string().min(1),
  size: count,
})
export type FileUploaded = z.infer<typeof fileUploadedSchema>

export const runCancelAcceptedSchema = z.strictObject({
  run: z.strictObject({ id: idSchema('run'), status: z.literal('cancelling') }),
})
export const interactionAcceptedSchema = z.strictObject({
  interaction: z.strictObject({ id: idSchema('int'), status: z.literal('submitted') }),
})
export const taskStopAcceptedSchema = z.strictObject({
  task: z.strictObject({ id: idSchema('task'), status: z.string().min(1), stop_requested: z.literal(true) }),
})
