import { z } from 'zod'
import { interactionResponseSchema, type InteractionResponse } from '../../../core/resource/interaction.js'
import { userAttachmentSchema, type UserAttachment } from '../../../core/run/user-turn.js'
import {
  isEffortLevel,
  type EffortLevel,
  type SessionTarget,
} from '../../../core/contract/agent-provider.js'
import {
  isRunHarnessId,
  providerIdForHarness,
  type RunHarnessId,
} from '../../../core/resource/run-harness.js'

export interface InitFrame {
  readonly type: 'run.start'
  readonly runId?: string
  readonly text: string
  readonly attachments?: readonly UserAttachment[]
  readonly model: string
  readonly harness: RunHarnessId
  readonly cwd: string
  readonly effort?: EffortLevel
  readonly sessionId?: string
  readonly fork?: boolean
  readonly promptSuggestions?: boolean
}

export interface SubscribeFrame {
  readonly type: 'session.subscribe'
  readonly harness: RunHarnessId
  readonly sinceSeq: number
  readonly streamId?: string
  readonly sessionId: string
}

export interface AbortFrame {
  readonly type: 'run.abort'
  readonly harness: RunHarnessId
  readonly sessionId?: string
  readonly runId?: string
}

export interface StopTaskFrame { readonly type: 'task.stop'; readonly harness: RunHarnessId; readonly sessionId: string; readonly taskId: string }

export type PermissionFrame = { readonly type: 'permission.respond'; readonly harness: 'claude' | 'pi'; readonly sessionId: string } & InteractionResponse
export type ClientFrame = InitFrame | SubscribeFrame | AbortFrame | StopTaskFrame | PermissionFrame

export type ParseClientResult =
  | { readonly ok: true; readonly frame: ClientFrame }
  | { readonly ok: false; readonly message: string }

export type ParseInitResult =
  | { readonly ok: true; readonly frame: InitFrame }
  | { readonly ok: false; readonly message: string }

export function parseClientFrame(raw: unknown): ParseClientResult {
  if (!isRecord(raw)) {
    return { ok: false, message: 'Frame must be a JSON object' }
  }
  const type = raw['type']
  if (type === 'permission.respond') {
    const address = z.object({ type: z.literal('permission.respond'), harness: z.enum(['claude', 'pi']), sessionId: z.string().trim().min(1) }).safeParse(raw)
    const response = interactionResponseSchema.safeParse(raw)
    return address.success && response.success ? { ok: true, frame: { ...address.data, ...response.data } } : { ok: false, message: 'Invalid interaction response' }
  }
  if (type === 'task.stop') {
    const result = z.object({ type: z.literal('task.stop'), harness: z.enum(['claude', 'pi']), sessionId: z.string().trim().min(1), taskId: z.string().trim().min(1) }).safeParse(raw)
    return result.success ? { ok: true, frame: result.data } : { ok: false, message: 'Task stop requires harness, sessionId and taskId' }
  }
  if (type === 'run.start') return parseInitFrame(raw)
  if (type === 'session.subscribe') return parseSubscribeFrame(raw)
  if (type === 'run.abort') return parseAbortFrame(raw)
  return { ok: false, message: 'Message must be run.start, session.subscribe, run.abort, task.stop or permission.respond' }
}

export function parseInitFrame(raw: unknown): ParseInitResult {
  if (!isRecord(raw)) {
    return { ok: false, message: 'Frame must be a JSON object' }
  }
  if (raw['type'] !== 'run.start') {
    return { ok: false, message: 'Run start frame must be type "run.start".' }
  }
  const runId = raw['runId']
  if (runId !== undefined && (typeof runId !== 'string' || !runId.trim())) {
    return { ok: false, message: 'Run start runId must be a non-empty string' }
  }
  const text = raw['text']
  const attachments = z.array(userAttachmentSchema).optional().safeParse(raw['attachments'])
  if (!attachments.success) {
    return { ok: false, message: 'Init attachments must contain a path, name, MIME type, and non-negative file size' }
  }
  if (typeof text !== 'string' || (text.trim() === '' && !attachments.data?.length)) {
    return { ok: false, message: 'Init text must be a non-empty string' }
  }
  const model = raw['model']
  if (typeof model !== 'string' || model.trim() === '') {
    return { ok: false, message: 'Init model must be a non-empty string' }
  }
  const harness = raw['harness']
  if (!isRunHarnessId(harness)) {
    return { ok: false, message: 'Init harness must be claude or pi' }
  }
  const cwd = raw['cwd']
  if (typeof cwd !== 'string' || cwd.trim() === '') {
    return { ok: false, message: 'Init cwd must be a non-empty string' }
  }
  const effort = raw['effort']
  if (effort !== undefined && !isEffortLevel(effort)) {
    return { ok: false, message: 'Init effort must be low, medium, high, xhigh, or max' }
  }
  const sessionId = raw['sessionId']
  if (sessionId !== undefined && (typeof sessionId !== 'string' || sessionId.trim() === '')) {
    return { ok: false, message: 'Init sessionId must be a non-empty string' }
  }
  const fork = raw['fork']
  if (fork !== undefined && typeof fork !== 'boolean') {
    return { ok: false, message: 'Init fork must be a boolean' }
  }
  if (fork === true && sessionId === undefined) {
    return { ok: false, message: 'Init fork requires sessionId' }
  }
  if (harness === 'pi' && fork === true) {
    return { ok: false, message: 'Pi does not support fork' }
  }
  const promptSuggestions = raw['promptSuggestions']
  if (promptSuggestions !== undefined && typeof promptSuggestions !== 'boolean') {
    return { ok: false, message: 'Init promptSuggestions must be a boolean' }
  }
  return {
    ok: true,
    frame: {
      type: 'run.start',
      ...(runId === undefined ? {} : { runId: runId.trim() }),
      text,
      ...(attachments.data?.length ? { attachments: attachments.data } : {}),
      model: model.trim(),
      harness,
      cwd: cwd.trim(),
      ...(effort === undefined ? {} : { effort }),
      ...(sessionId === undefined ? {} : { sessionId: sessionId.trim() }),
      ...(fork === true ? { fork: true } : {}),
      ...(promptSuggestions === undefined ? {} : { promptSuggestions }),
    },
  }
}

export function parseSubscribeFrame(raw: Record<string, unknown>): ParseClientResult {
  const result = z.object({
    type: z.literal('session.subscribe'), harness: z.enum(['claude', 'pi']),
    sessionId: z.string().trim().min(1), streamId: z.string().trim().min(1).optional(),
    sinceSeq: z.number().int().nonnegative().default(0),
  }).safeParse(raw)
  if (!result.success) return { ok: false, message: 'Session subscribe requires harness, sessionId and a valid cursor' }
  const { streamId, ...frame } = result.data
  return { ok: true, frame: { ...frame, ...(streamId === undefined ? {} : { streamId }) } }
}

export function parseAbortFrame(raw: Record<string, unknown>): ParseClientResult {
  const harness = raw['harness']
  if (!isRunHarnessId(harness)) {
    return { ok: false, message: 'Abort harness must be claude or pi' }
  }
  const sessionId = raw['sessionId']
  if (sessionId !== undefined && (typeof sessionId !== 'string' || sessionId.trim() === '')) {
    return { ok: false, message: 'Abort sessionId must be a non-empty string' }
  }
  const runId = raw['runId']
  if (runId !== undefined && (typeof runId !== 'string' || runId.trim() === '')) {
    return { ok: false, message: 'Abort runId must be a non-empty string' }
  }
  if (sessionId === undefined && runId === undefined) {
    return { ok: false, message: 'Abort requires sessionId or runId' }
  }
  return {
    ok: true,
    frame: {
      type: 'run.abort',
      harness,
      ...(sessionId === undefined ? {} : { sessionId: sessionId.trim() }),
      ...(runId === undefined ? {} : { runId: runId.trim() }),
    },
  }
}

export function sessionTargetFromInit(frame: InitFrame): SessionTarget {
  const provider = providerIdForHarness(frame.harness)
  if (frame.fork === true && frame.sessionId !== undefined) {
    return { kind: 'fork', source: { provider, id: frame.sessionId } }
  }
  if (frame.sessionId !== undefined) {
    return { kind: 'resume', session: { provider, id: frame.sessionId } }
  }
  return { kind: 'new', provider }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
