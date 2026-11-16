import { z } from 'zod'

import {
  idSchema,
  interactionSchema,
  itemSchema,
  runSchema,
  sessionSettingsSchema,
  sessionStatusSchema,
  taskSchema,
  timestampSchema,
} from './objects.js'

const durable = {
  seq: z.number().int().positive(),
  created_at: timestampSchema,
  run_id: idSchema('run').optional(),
  thread_id: idSchema('thr').optional(),
}

const durableEvent = <T extends string, S extends z.ZodRawShape>(type: T, shape: S) =>
  z.strictObject({ ...durable, type: z.literal(type), ...shape })

export const sessionErrorSchema = z.strictObject({
  code: z.string().min(1),
  message: z.string(),
  retry: z.strictObject({
    status: z.enum(['retrying', 'exhausted', 'terminal']),
    attempt: z.number().int().positive().optional(),
    max_attempts: z.number().int().positive().optional(),
    next_retry_at: timestampSchema.optional(),
  }).optional(),
  change_id: idSchema('chg').optional(),
  interaction_id: idSchema('int').optional(),
})

export const SETTINGS_SOURCES = ['api', 'web', 'native_command'] as const

export const durableEventSchema = z.discriminatedUnion('type', [
  durableEvent('session.status_changed', { status: sessionStatusSchema }),
  durableEvent('session.settings_changed', {
    settings: sessionSettingsSchema,
    source: z.enum(SETTINGS_SOURCES),
    change_id: idSchema('chg').optional(),
  }),
  durableEvent('session.error', { error: sessionErrorSchema }),
  durableEvent('run.queued', { run: runSchema }),
  durableEvent('run.started', { run: runSchema }),
  durableEvent('run.updated', { run: runSchema }),
  durableEvent('run.completed', { run: runSchema }),
  durableEvent('item.started', { item: itemSchema }),
  durableEvent('item.updated', { item: itemSchema }),
  durableEvent('item.completed', { item: itemSchema }),
  durableEvent('interaction.requested', { interaction: interactionSchema }),
  durableEvent('interaction.resolved', { interaction: interactionSchema }),
  durableEvent('task.started', { task: taskSchema }),
  durableEvent('task.updated', { task: taskSchema }),
  durableEvent('task.completed', { task: taskSchema }),
])
export type DurableEvent = z.infer<typeof durableEventSchema>
export type DurableEventType = DurableEvent['type']
export const DURABLE_EVENT_TYPES = durableEventSchema.options.map((option) => option.shape.type.value)

export const itemDeltaSchema = z.discriminatedUnion('type', [
  z.strictObject({ type: z.literal('text'), index: z.number().int().nonnegative().optional(), text: z.string() }),
  z.strictObject({ type: z.literal('input_json'), text: z.string() }),
  z.strictObject({ type: z.literal('output'), stream: z.enum(['stdout', 'stderr']), text: z.string() }),
])
export type ItemDelta = z.infer<typeof itemDeltaSchema>

export const NATIVE_SOURCES = ['sdk', 'transcript', 'hook', 'display', 'status_line', 'host'] as const

export const itemDeltaEventSchema = z.strictObject({
  type: z.literal('item.delta'),
  run_id: idSchema('run'),
  thread_id: idSchema('thr').optional(),
  item_id: idSchema('itm'),
  delta: itemDeltaSchema,
})
export const itemResyncEventSchema = z.strictObject({
  type: z.literal('item.updated'),
  resync: z.literal(true),
  run_id: idSchema('run'),
  thread_id: idSchema('thr').optional(),
  item: itemSchema,
})
export const nativeEventSchema = z.strictObject({
  type: z.literal('native'),
  thread_id: idSchema('thr').optional(),
  harness: z.enum(['claude', 'pi']),
  source: z.enum(NATIVE_SOURCES),
  refs: z.strictObject({ run_id: idSchema('run').optional(), item_id: idSchema('itm').optional() }).optional(),
  event: z.unknown(),
})
export const ephemeralEventSchema = z.union([itemDeltaEventSchema, itemResyncEventSchema, nativeEventSchema])
export type EphemeralEvent = z.infer<typeof ephemeralEventSchema>

export const agentApiEventSchema = z.union([durableEventSchema, ephemeralEventSchema])
export type AgentApiEvent = z.infer<typeof agentApiEventSchema>

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never
/** A durable event before the event log assigns its sequence number and time. */
export type DurableEventDraft = DistributiveOmit<DurableEvent, 'seq' | 'created_at'>

export function isDurableEvent(event: AgentApiEvent): event is DurableEvent {
  return 'seq' in event
}
