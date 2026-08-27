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
  readonly promptSuggestions?: boolean
}

export interface AttachFrame {
  readonly type: 'attach'
  readonly harness: RunHarnessId
  readonly sinceSeq: number
  readonly sessionId?: string
  readonly runId?: string
}

export interface AbortFrame {
  readonly type: 'abort'
  readonly harness: RunHarnessId
  readonly sessionId?: string
  readonly runId?: string
}

export type ClientFrame = InitFrame | AttachFrame | AbortFrame

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
  if (type === 'init') return parseInitFrame(raw)
  if (type === 'attach') return parseAttachFrame(raw)
  if (type === 'abort') return parseAbortFrame(raw)
  return { ok: false, message: 'First message must be type init, attach, or abort' }
}

export function parseInitFrame(raw: unknown): ParseInitResult {
  if (!isRecord(raw)) {
    return { ok: false, message: 'Frame must be a JSON object' }
  }
  if (raw['type'] !== 'init') {
    return { ok: false, message: 'First WebSocket frame must be type "init".' }
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
      type: 'init',
      text,
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

export function parseAttachFrame(raw: Record<string, unknown>): ParseClientResult {
  const harness = raw['harness']
  if (!isRunHarnessId(harness)) {
    return { ok: false, message: 'Attach harness must be claude or pi' }
  }
  const sinceSeq = parseSinceSeq(raw['sinceSeq'])
  if (sinceSeq === undefined) {
    return { ok: false, message: 'Attach sinceSeq must be a non-negative integer' }
  }
  const sessionId = raw['sessionId']
  if (sessionId !== undefined && (typeof sessionId !== 'string' || sessionId.trim() === '')) {
    return { ok: false, message: 'Attach sessionId must be a non-empty string' }
  }
  const runId = raw['runId']
  if (runId !== undefined && (typeof runId !== 'string' || runId.trim() === '')) {
    return { ok: false, message: 'Attach runId must be a non-empty string' }
  }
  if (sessionId === undefined && runId === undefined) {
    return { ok: false, message: 'Attach requires sessionId or runId' }
  }
  return {
    ok: true,
    frame: {
      type: 'attach',
      harness,
      sinceSeq,
      ...(sessionId === undefined ? {} : { sessionId: sessionId.trim() }),
      ...(runId === undefined ? {} : { runId: runId.trim() }),
    },
  }
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
      type: 'abort',
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

function parseSinceSeq(value: unknown): number | undefined {
  if (value === undefined) return 0
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) return undefined
  return value
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
