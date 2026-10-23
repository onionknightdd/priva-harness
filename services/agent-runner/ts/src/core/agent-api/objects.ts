import { z } from 'zod'

import { EFFORT_LEVELS } from '../contract/agent-provider.js'
import { RUN_MODES } from '../resource/session.js'
import type { IdPrefix } from './ids.js'
import { TOOL_KINDS } from './tool-kind.js'

export function idSchema(prefix: IdPrefix) {
  return z.string().regex(new RegExp(`^${prefix}_[0-9A-Za-z]+$`, 'u'), `Expected a ${prefix}_ ID`)
}

export const timestampSchema = z.iso.datetime()
const count = z.number().int().nonnegative()

// Content blocks shared by message items, tool output and run input.
export const textBlockSchema = z.strictObject({ type: z.literal('text'), text: z.string() })
export const imageBlockSchema = z.strictObject({
  type: z.literal('image'),
  image_path: z.string().min(1).optional(),
  image_url: z.string().min(1).optional(),
  media_type: z.string().min(1).optional(),
  alt: z.string().optional(),
}).refine((block) => (block.image_path === undefined) !== (block.image_url === undefined),
  'An image block has exactly one of image_path or image_url')
export const fileBlockSchema = z.strictObject({
  type: z.literal('file'),
  file_path: z.string().min(1),
  name: z.string().min(1),
  media_type: z.string().min(1),
  size: count,
})
export const jsonBlockSchema = z.strictObject({ type: z.literal('json'), value: z.unknown() })
export const contentBlockSchema = z.discriminatedUnion('type', [textBlockSchema, imageBlockSchema, fileBlockSchema, jsonBlockSchema])
export type ContentBlock = z.infer<typeof contentBlockSchema>

export const usageSchema = z.strictObject({
  input_tokens: count,
  output_tokens: count,
  cache_read_tokens: count.optional(),
  cache_write_tokens: count.optional(),
  cost_usd: z.number().nonnegative().optional(),
})
export type Usage = z.infer<typeof usageSchema>

export const errorDetailSchema = z.strictObject({ code: z.string().min(1), message: z.string() })

// Settings use the same `profileId:modelId` reference as the WebUI.
export const contextWindowSchema = z.union([z.literal(200_000), z.literal(1_000_000)])
export const sessionSettingsSchema = z.strictObject({
  model: z.string().min(1),
  effort: z.enum(EFFORT_LEVELS).optional(),
  context_window: contextWindowSchema,
})
export type SessionSettings = z.infer<typeof sessionSettingsSchema>

export const RUN_STATUSES = ['queued', 'in_progress', 'completed', 'failed', 'cancelled', 'interrupted'] as const
export const STOP_REASONS = ['end_turn', 'cancelled', 'interrupted', 'error', 'max_turns', 'budget_exceeded'] as const
export const TASK_STATUSES = ['pending', 'running', 'paused', 'completed', 'failed', 'cancelled', 'unknown'] as const
export type RunStatus = (typeof RUN_STATUSES)[number]
export type StopReason = (typeof STOP_REASONS)[number]
export type TaskStatus = (typeof TASK_STATUSES)[number]

export const runInputSchema = z.discriminatedUnion('type', [
  z.strictObject({
    type: z.literal('user_message'),
    message_id: idSchema('msg'),
    source: z.enum(['api', 'web', 'terminal']),
    content: z.array(contentBlockSchema),
  }),
  z.strictObject({
    type: z.literal('task_result'),
    task_id: idSchema('task'),
    status: z.enum(TASK_STATUSES),
    summary: z.string().optional(),
    event: z.string().optional(),
  }),
  z.strictObject({ type: z.literal('agent_task'), item_id: idSchema('itm'), prompt: z.string() }),
  z.strictObject({
    type: z.literal('inbox_message'),
    from: z.strictObject({
      kind: z.enum(['coordinator', 'peer']),
      thread_id: idSchema('thr').optional(),
      name: z.string().optional(),
    }),
    content: z.array(contentBlockSchema),
  }),
])
export type RunInput = z.infer<typeof runInputSchema>

export const runSchema = z.strictObject({
  id: idSchema('run'),
  thread_id: idSchema('thr').optional(),
  status: z.enum(RUN_STATUSES),
  position: z.number().int().positive().optional(),
  model: z.string().min(1).optional(),
  input: runInputSchema.nullable(),
  stop_reason: z.enum(STOP_REASONS).optional(),
  /** Text of the run's last assistant message, once the run has ended. */
  output_text: z.string().optional(),
  interrupted_by: z.strictObject({ message_id: idSchema('msg') }).optional(),
  error: errorDetailSchema.optional(),
  usage: usageSchema.optional(),
  context: z.strictObject({ used_tokens: count, limit_tokens: count }).optional(),
  duration_ms: count.optional(),
  created_at: timestampSchema,
  started_at: timestampSchema.optional(),
  completed_at: timestampSchema.optional(),
})
export type Run = z.infer<typeof runSchema>

const itemBase = {
  id: idSchema('itm'),
  created_at: timestampSchema.optional(),
  completed_at: timestampSchema.optional(),
}

export const toolDescriptorSchema = z.strictObject({
  name: z.string().min(1),
  kind: z.enum(TOOL_KINDS),
  server: z.string().min(1).optional(),
})

export const toolOutputSchema = z.strictObject({ content: z.array(contentBlockSchema), is_error: z.boolean() })

export const modelCallSchema = z.strictObject({
  operation: z.enum(['classify', 'generate_images']),
  model: z.string().min(1),
  status: z.enum(['running', 'completed', 'failed', 'cancelled']),
  duration_ms: count.optional(),
  usage: usageSchema.optional(),
  error: z.string().optional(),
})

export const TOOL_CALL_STATUSES = ['pending', 'running', 'completed', 'failed', 'declined', 'cancelled'] as const

export const messageItemSchema = z.strictObject({
  ...itemBase,
  type: z.literal('message'),
  status: z.enum(['in_progress', 'completed']),
  content: z.array(contentBlockSchema),
})
export const reasoningItemSchema = z.strictObject({
  ...itemBase,
  type: z.literal('reasoning'),
  status: z.enum(['in_progress', 'completed']),
  text: z.string().optional(),
  duration_ms: count.optional(),
})
export const toolCallItemSchema = z.strictObject({
  ...itemBase,
  type: z.literal('tool_call'),
  status: z.enum(TOOL_CALL_STATUSES),
  tool: toolDescriptorSchema,
  input: z.unknown().optional(),
  output: toolOutputSchema.optional(),
  task_id: idSchema('task').optional(),
  model_calls: z.array(modelCallSchema).optional(),
  duration_ms: count.optional(),
})
export const subagentItemSchema = z.strictObject({
  ...itemBase,
  type: z.literal('subagent'),
  status: z.enum(['running', 'completed', 'failed', 'cancelled']),
  agent: z.strictObject({ name: z.string().min(1), description: z.string().optional() }),
  thread_id: idSchema('thr'),
  mode: z.enum(['foreground', 'background']),
  input: z.strictObject({ prompt: z.string() }),
  output: toolOutputSchema.optional(),
  task_id: idSchema('task').optional(),
  usage: usageSchema.optional(),
  duration_ms: count.optional(),
})
export const compactionItemSchema = z.strictObject({
  ...itemBase,
  type: z.literal('compaction'),
  status: z.enum(['in_progress', 'completed', 'failed', 'cancelled']),
  trigger: z.enum(['auto', 'manual']),
  summary: z.string().optional(),
  context: z.strictObject({ tokens_before: count.optional(), tokens_after: count.optional() }).optional(),
})
export const contextResetItemSchema = z.strictObject({
  ...itemBase,
  type: z.literal('context_reset'),
  status: z.literal('completed'),
  reason: z.literal('clear'),
})
export const itemSchema = z.discriminatedUnion('type', [
  messageItemSchema, reasoningItemSchema, toolCallItemSchema, subagentItemSchema, compactionItemSchema, contextResetItemSchema,
])
export type Item = z.infer<typeof itemSchema>

export const WORKFLOW_AGENT_STATUSES = ['pending', 'running', 'completed', 'failed', 'cancelled', 'paused', 'skipped', 'unknown'] as const

export const taskSchema = z.strictObject({
  id: idSchema('task'),
  kind: z.enum(['shell', 'agent', 'workflow', 'monitor', 'other']),
  status: z.enum(TASK_STATUSES),
  description: z.string().optional(),
  thread_id: idSchema('thr').optional(),
  origin: z.strictObject({ run_id: idSchema('run'), item_id: idSchema('itm').optional() }).optional(),
  workflow: z.strictObject({
    name: z.string().optional(),
    phases: z.array(z.strictObject({ index: count, title: z.string() })),
    agents: z.array(z.strictObject({
      label: z.string(),
      phase_index: count.optional(),
      thread_id: idSchema('thr').optional(),
      status: z.enum(WORKFLOW_AGENT_STATUSES),
      last_tool: z.string().optional(),
      tokens: count.optional(),
      duration_ms: count.optional(),
    })),
  }).optional(),
  last_event: z.strictObject({ text: z.string(), created_at: timestampSchema }).optional(),
  result: z.strictObject({ summary: z.string(), output_path: z.string().optional() }).optional(),
  usage: z.strictObject({ total_tokens: count }).optional(),
  stop_requested: z.boolean(),
  started_at: timestampSchema.optional(),
  completed_at: timestampSchema.optional(),
  duration_ms: count.optional(),
})
export type Task = z.infer<typeof taskSchema>

export const questionAnswerSchema = z.strictObject({ selected: z.array(z.string()), text: z.string() })
export const interactionResolutionSchema = z.strictObject({
  decision: z.enum(['allow', 'deny']),
  reason: z.enum(['answered', 'skipped', 'timeout', 'cancelled', 'unattended']),
  answers: z.record(z.string(), questionAnswerSchema).optional(),
})

const interactionBase = {
  id: idSchema('int'),
  run_id: idSchema('run').optional(),
  thread_id: idSchema('thr').optional(),
  item_id: idSchema('itm').optional(),
  title: z.string().optional(),
  reason: z.string().optional(),
  expires_at: timestampSchema,
  status: z.enum(['pending', 'resolved']),
  resolution: interactionResolutionSchema.optional(),
}

export const interactionQuestionSchema = z.strictObject({
  id: z.string().min(1),
  question: z.string().min(1),
  header: z.string().nullable(),
  options: z.array(z.strictObject({ label: z.string().min(1), description: z.string().nullable() })),
  multi_select: z.boolean(),
  allow_custom: z.boolean(),
  multiline: z.boolean(),
  initial_text: z.string().nullable(),
})

export const interactionSchema = z.discriminatedUnion('type', [
  z.strictObject({ ...interactionBase, type: z.literal('approval'), tool: toolDescriptorSchema, input: z.unknown().optional() }),
  z.strictObject({ ...interactionBase, type: z.literal('question'), questions: z.array(interactionQuestionSchema).min(1) }),
  z.strictObject({ ...interactionBase, type: z.literal('open_url'), url: z.url(), server: z.string().min(1).optional() }),
])
export type Interaction = z.infer<typeof interactionSchema>

export const sessionStatusSchema = z.strictObject({
  state: z.enum(['idle', 'running', 'requires_action']),
  stop_reason: z.enum(STOP_REASONS).optional(),
  interaction_ids: z.array(idSchema('int')).optional(),
  active_tasks: count,
})
export type SessionStatus = z.infer<typeof sessionStatusSchema>

export const SESSION_DRIVERS = ['sdk', 'terminal', 'none'] as const
export type SessionDriver = (typeof SESSION_DRIVERS)[number]

// Policies may omit fields (scenario B hides workdir and settings) but never change shapes.
export const sessionSchema = z.strictObject({
  id: idSchema('ses'),
  harness: z.enum(['claude', 'pi']).optional(),
  workdir: z.string().optional(),
  run_mode: z.enum(RUN_MODES).optional(),
  title: z.string().nullable().optional(),
  settings: sessionSettingsSchema.optional(),
  status: sessionStatusSchema,
  driver: z.enum(SESSION_DRIVERS).optional(),
  agent: z.strictObject({ id: z.string().min(1), name: z.string(), release: z.number().int().positive() }).optional(),
  last_event_seq: count,
  created_at: timestampSchema,
  updated_at: timestampSchema,
})
export type Session = z.infer<typeof sessionSchema>

export const sessionSnapshotSchema = z.strictObject({
  ...sessionSchema.shape,
  active_run: runSchema.nullable(),
  queued_runs: z.array(runSchema),
  interactions: z.array(interactionSchema),
  tasks: z.array(taskSchema),
})
export type SessionSnapshot = z.infer<typeof sessionSnapshotSchema>

export const runWithItemsSchema = z.strictObject({ ...runSchema.shape, items: z.array(itemSchema) })
export type RunWithItems = z.infer<typeof runWithItemsSchema>
