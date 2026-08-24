import type { AgentEvent } from '../../../core/event/agent-event.js'
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
  readonly type: 'init'
  readonly text: string
  readonly model: string
  readonly harness: RunHarnessId
  readonly cwd: string
  readonly effort?: EffortLevel
  readonly sessionId?: string
  readonly fork?: boolean
}

export type ServerFrame = AgentEvent & { readonly runId: string }

export interface ErrorFrame {
  readonly type: 'error'
  readonly message: string
}

export type ParseInitResult =
  | { readonly ok: true; readonly frame: InitFrame }
  | { readonly ok: false; readonly message: string }

export function parseInitFrame(raw: unknown): ParseInitResult {
  if (!isRecord(raw)) {
    return { ok: false, message: 'Init frame must be a JSON object' }
  }
  if (raw['type'] !== 'init') {
    return { ok: false, message: 'First message must be type init' }
  }
  const text = raw['text']
  if (typeof text !== 'string' || text.trim() === '') {
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
  if (harness === 'pi' && (sessionId !== undefined || fork === true)) {
    return { ok: false, message: 'Pi does not support resume or fork in this slice' }
  }
  return {
    ok: true,
    frame: {
      type: 'init',
      text,
      model: model.trim(),
      harness,
      cwd: cwd.trim(),
      ...(effort === undefined ? {} : { effort }),
      ...(sessionId === undefined ? {} : { sessionId: sessionId.trim() }),
      ...(fork === true ? { fork: true } : {}),
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

export function toServerFrame(event: AgentEvent, runId: string): ServerFrame {
  return { ...event, runId }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
