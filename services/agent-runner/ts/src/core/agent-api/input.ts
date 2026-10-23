import { z } from 'zod'

import { EFFORT_LEVELS, QUEUE_BEHAVIORS } from '../contract/agent-provider.js'
import { RUN_MODES } from '../resource/session.js'
import { contextWindowSchema, questionAnswerSchema } from './objects.js'

const DATA_URL = /^data:[^,;]+(?:;[^,;]+)*;base64,/u

export const textPartSchema = z.strictObject({ type: z.literal('text'), text: z.string() })
export const imagePartSchema = z.strictObject({
  type: z.literal('image'),
  image_url: z.string().regex(DATA_URL, 'image_url must be a base64 data: URL').optional(),
  image_path: z.string().min(1).optional(),
}).refine((part) => (part.image_url === undefined) !== (part.image_path === undefined),
  'An image part needs exactly one of image_url or image_path')
export const filePartSchema = z.strictObject({
  type: z.literal('file'),
  file_path: z.string().min(1).optional(),
  file_data: z.string().regex(DATA_URL, 'file_data must be a base64 data: URL').optional(),
  filename: z.string().min(1).optional(),
}).refine((part) => (part.file_path === undefined) !== (part.file_data === undefined),
  'A file part needs exactly one of file_path or file_data')
  .refine((part) => part.file_data === undefined || part.filename !== undefined, 'file_data requires filename')
  .refine((part) => part.file_path === undefined || part.filename === undefined, 'filename is only used with file_data')

export const messagePartSchema = z.discriminatedUnion('type', [textPartSchema, imagePartSchema, filePartSchema])
export type MessagePart = z.infer<typeof messagePartSchema>

export const userMessageSchema = z.strictObject({ parts: z.array(messagePartSchema).min(1) })
  .refine((message) => message.parts.some((part) => part.type !== 'text' || part.text.trim() !== ''),
    'A message needs non-empty text, an image, or a file')
export type UserMessage = z.infer<typeof userMessageSchema>

export const deliverySchema = z.enum(QUEUE_BEHAVIORS)
export type Delivery = z.infer<typeof deliverySchema>

/** How `POST …/messages` answers: 202 at once, the run after waiting for it, or the run's SSE (the default). */
export const RESPONSE_MODES = ['accepted', 'wait', 'stream'] as const
export type ResponseMode = (typeof RESPONSE_MODES)[number]

export const streamOptionsSchema = z.strictObject({
  deltas: z.boolean().optional(),
  threads: z.enum(['all', 'main']).optional(),
  native: z.boolean().optional(),
})
export type StreamOptions = z.infer<typeof streamOptionsSchema>

export const settingsPatchSchema = z.strictObject({
  model: z.string().trim().min(1).optional(),
  effort: z.enum(EFFORT_LEVELS).optional(),
  context_window: contextWindowSchema.optional(),
})
export type SettingsPatch = z.infer<typeof settingsPatchSchema>

const sendFields = {
  delivery: deliverySchema.optional(),
  response: z.enum(RESPONSE_MODES).optional(),
  /** Whether the run may pause for a person to answer; otherwise interactions are declined as unattended. */
  allow_interrupt: z.boolean().optional(),
  stream_options: streamOptionsSchema.optional(),
}

const streamOptionsNeedStream = (body: { readonly response?: ResponseMode | undefined; readonly stream_options?: unknown }): boolean =>
  body.stream_options === undefined || (body.response ?? 'stream') === 'stream'
const STREAM_OPTIONS_ISSUE = { message: 'stream_options only apply to response = stream', path: ['stream_options'] }

export const createSessionBodySchema = z.strictObject({
  harness: z.enum(['claude', 'pi']).optional(),
  workdir: z.string().optional(),
  /** Claude only and fixed once created; Pi sessions ignore it. */
  run_mode: z.enum(RUN_MODES).optional(),
  settings: settingsPatchSchema.optional(),
  message: userMessageSchema.optional(),
  ...sendFields,
}).refine((body) => body.message !== undefined || (body.delivery === undefined && body.response === undefined
  && body.allow_interrupt === undefined && body.stream_options === undefined),
'delivery, response, allow_interrupt and stream_options require message')
  .refine(streamOptionsNeedStream, STREAM_OPTIONS_ISSUE)
export type CreateSessionBody = z.infer<typeof createSessionBodySchema>

export const sendMessageBodySchema = z.strictObject({ message: userMessageSchema, ...sendFields })
  .refine(streamOptionsNeedStream, STREAM_OPTIONS_ISSUE)
export type SendMessageBody = z.infer<typeof sendMessageBodySchema>

export const patchSessionBodySchema = z.strictObject({
  title: z.string().trim().min(1).optional(),
  settings: settingsPatchSchema.optional(),
}).refine((body) => body.title !== undefined || body.settings !== undefined, 'Provide title or settings')
export type PatchSessionBody = z.infer<typeof patchSessionBodySchema>

export const interactionResponseBodySchema = z.discriminatedUnion('decision', [
  z.strictObject({ decision: z.literal('allow'), answers: z.record(z.string(), questionAnswerSchema).optional() }),
  z.strictObject({ decision: z.literal('deny') }),
])
export type InteractionResponseBody = z.infer<typeof interactionResponseBodySchema>

export const eventsQuerySchema = z.strictObject({
  after: z.coerce.number().int().nonnegative().optional(),
  deltas: z.stringbool().optional(),
  threads: z.enum(['all', 'main']).optional(),
  native: z.stringbool().optional(),
})

export const runsQuerySchema = z.strictObject({
  thread: z.enum(['all', 'main']).optional(),
  order: z.enum(['asc', 'desc']).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
  cursor: z.string().min(1).optional(),
})

export const runQuerySchema = z.strictObject({ wait: z.stringbool().optional() })

export const sessionsQuerySchema = z.strictObject({
  limit: z.coerce.number().int().min(1).max(100).optional(),
  cursor: z.string().min(1).optional(),
})

// WebSocket command frames equal the HTTP bodies plus `type` and `request_id`.
const commandBase = { request_id: z.string().min(1) }
export const clientCommandSchema = z.discriminatedUnion('type', [
  z.strictObject({ ...commandBase, type: z.literal('message.send'), idempotency_key: z.string().min(1).optional(),
    message: userMessageSchema, delivery: deliverySchema.optional(), allow_interrupt: z.boolean().optional() }),
  z.strictObject({ ...commandBase, type: z.literal('run.cancel'), run_id: z.string().min(1) }),
  z.strictObject({ ...commandBase, type: z.literal('interaction.respond'), interaction_id: z.string().min(1),
    decision: z.enum(['allow', 'deny']), answers: z.record(z.string(), questionAnswerSchema).optional() }),
  z.strictObject({ ...commandBase, type: z.literal('task.stop'), task_id: z.string().min(1) }),
  z.strictObject({ ...commandBase, type: z.literal('settings.update'), settings: settingsPatchSchema }),
])
export type ClientCommand = z.infer<typeof clientCommandSchema>
