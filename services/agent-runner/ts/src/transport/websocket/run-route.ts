import type { FastifyPluginCallback } from 'fastify'
import { randomUUID } from 'node:crypto'
import type { WebSocket } from 'ws'

import type { SessionRef } from '../../core/contract/agent-provider.js'
import type { UserFileSystem } from '../../core/contract/user-file-system.js'
import type { StreamFrame } from '../../core/event/agent-event.js'
import { encodeEvent } from '../../core/event/encode-event.js'
import { providerIdForHarness } from '../../core/resource/run-harness.js'
import type { AgentHarness } from '../../harness/agent-harness.js'
import type { AgentProfileService } from '../../harness/config/agent-profile-service.js'
import type { ModelProfileService } from '../../harness/config/model-profile-service.js'
import { EnvelopeStamper } from '../../harness/run/envelope-stamper.js'
import type { LiveRun } from '../../harness/run/live-run.js'
import type { SessionStream } from '../../harness/session/session-stream.js'
import { buildRunSpec } from './run-spec.js'
import {
  parseClientFrame,
  sessionTargetFromInit,
  type AbortFrame,
} from './schema/run-frames.js'

export const SESSION_WEBSOCKET_PATH = '/api/sandbox/agent/ws/session'

export interface RunRouteOptions {
  readonly fileSystem: UserFileSystem
  readonly harness: AgentHarness
  readonly modelProfileService: ModelProfileService
  readonly agentProfileService: AgentProfileService
  readonly cwd: string
}

export const runWebsocketRoutes: FastifyPluginCallback<RunRouteOptions> = (fastify, options, done) => {
  fastify.get(SESSION_WEBSOCKET_PATH, { websocket: true }, (socket) => {
    handleRunSocket(socket, options)
  })
  done()
}

function handleRunSocket(socket: WebSocket, options: RunRouteOptions): void {
  let unsubscribe: (() => void) | undefined
  let stopTerminalHistory: (() => Promise<void>) | undefined
  let stream: SessionStream | undefined
  let commandHarness = 'unknown'
  let commandType = ''
  let commandRunId = ''
  let commandRequestId: string | undefined
  let closed = false
  let commands = Promise.resolve()
  const followRebind = async (ref: SessionRef) => {
    await stopTerminalHistory?.()
    stopTerminalHistory = await options.harness.observeTerminalSession(ref)
    if (closed) { await stopTerminalHistory(); return }
    subscribe(options.harness.sessionStream(ref))
  }
  const subscribe = (next: SessionStream, cursor?: { streamId: string; seq: number }) => {
    unsubscribe?.()
    stream = next
    unsubscribe = next.subscribe((frame) => {
      if (socketOpen(socket)) socket.send(encodeEvent(frame))
      if (frame.type === 'session.rebound') {
        commands = commands.then(() => followRebind({ ...next.session, id: frame.nextSessionId }))
          .catch((error: unknown) => { sendError(socket, String(error), '', next.session.provider, 'session.subscribe') })
      }
    }, cursor)
  }
  socket.once('close', () => { closed = true; unsubscribe?.(); void stopTerminalHistory?.() })
  const handle = async (data: WebSocket.RawData): Promise<void> => {
    let raw: unknown
    commandType = ''; commandRunId = ''; commandRequestId = undefined
    try { raw = JSON.parse(rawToString(data)) as unknown } catch { throw new Error('Frame must be JSON') }
    if (typeof raw === 'object' && raw && 'harness' in raw && typeof raw.harness === 'string') commandHarness = raw.harness
    if (typeof raw === 'object' && raw && 'type' in raw && typeof raw.type === 'string') commandType = raw.type
    if (typeof raw === 'object' && raw && 'runId' in raw && typeof raw.runId === 'string') commandRunId = raw.runId
    if (typeof raw === 'object' && raw && 'requestId' in raw && typeof raw.requestId === 'string') commandRequestId = raw.requestId
    const parsed = parseClientFrame(raw)
    if (!parsed.ok) throw new Error(parsed.message)
    let frame = parsed.frame
    if (frame.type === 'session.subscribe') {
      const id = frame.sessionId
      await stopTerminalHistory?.()
      stopTerminalHistory = await options.harness.observeTerminalSession({ provider: frame.harness, id })
      if (!socketOpen(socket)) { await stopTerminalHistory(); return }
      const next = await options.harness.loadSessionStream({ provider: frame.harness, id })
      if (closed) return
      subscribe(next, frame.streamId ? { streamId: frame.streamId, seq: frame.sinceSeq } : undefined)
      // A reconnect also reconciles starts whose command response was lost.
      if (frame.streamId && socketOpen(socket)) socket.send(encodeEvent(next.snapshot()))
      return
    }
    if (frame.type === 'permission.respond') {
      if (stream?.session.id !== frame.sessionId || stream.session.provider !== frame.harness) throw new Error('Interaction belongs to another session')
      options.harness.respondPermission(stream.session, frame)
      return
    }
    if (frame.type === 'task.stop') {
      if (stream && (stream.session.id !== frame.sessionId || stream.session.provider !== frame.harness)) throw new Error('Task belongs to another session')
      await options.harness.stopTask({ provider: frame.harness, id: frame.sessionId }, frame.taskId)
      return
    }
    if (frame.type === 'run.abort') {
      if (frame.sessionId) {
        if (stream && (stream.session.id !== frame.sessionId || stream.session.provider !== frame.harness)) throw new Error('Run belongs to another session')
        if (await options.harness.abortTerminal({ provider: frame.harness, id: frame.sessionId }, frame.runId)) return
      }
      const live = resolveLive(options.harness, frame)
      if (live && (live.provider !== frame.harness || (stream && live.sessionId !== stream.session.id))) throw new Error('Run belongs to another session')
      if (!stream && live?.sessionId) subscribe(options.harness.sessionStream({ provider: live.provider, id: live.sessionId }))
      live?.abort.abort()
      return
    }
    if (stream) {
      if (frame.harness !== stream.session.provider || frame.fork) throw new Error('Start a new connection to change sessions')
      if (frame.sessionId === undefined) frame = { ...frame, sessionId: stream.session.id }
    }
    const spec = await buildRunSpec(options, frame)
    const attachments = frame.attachments === undefined ? undefined : await Promise.all(
      frame.attachments.map((attachment) => options.fileSystem.inspectAttachment(attachment.path)),
    )
    if (frame.sessionId && !frame.fork) {
      const next = await options.harness.loadSessionStream({ provider: frame.harness, id: frame.sessionId })
      if (stream && stream !== next) throw new Error('Start a new connection to change sessions')
      if (!stream && !closed) subscribe(next)
    }
    if (closed) return
    if (frame.harness === 'claude') {
      // Every Claude UI conversation starts with its native driver. Opening
      // the Terminal view later only attaches a viewer to this same process.
      const opened = await options.harness.openTerminal(sessionTargetFromInit(frame), spec,
        { cols: 120, rows: 40, ...(frame.theme ? { colorScheme: frame.theme } : {}) })
      const next = options.harness.sessionStream(opened.session)
      if (socketOpen(socket) && stream !== next) subscribe(next)
      await stopTerminalHistory?.()
      stopTerminalHistory = await options.harness.observeTerminalHistory(opened.session, spec.cwd)
      if (!socketOpen(socket)) { await stopTerminalHistory(); return }
      await options.harness.submitTerminal(opened.session,
        { text: frame.text, ...(attachments ? { attachments } : {}) }, spec, frame.runId ?? randomUUID())
      return
    }
    const live = await options.harness.launch(
      { text: frame.text, ...(attachments ? { attachments } : {}) }, spec,
      { source: 'web', session: sessionTargetFromInit(frame), ...(frame.runId ? { runId: frame.runId } : {}) },
    )
    if (stream) return
    const id = await sessionOfLive(live)
    if (!id) { sendError(socket, 'Could not open the session', live.runId, frame.harness, 'run.start'); return }
    const next = options.harness.sessionStream({ provider: frame.harness, id })
    subscribe(next, { streamId: next.streamId, seq: 0 })
  }
  socket.on('message', (data) => {
    commands = commands.then(() => handle(data)).catch((error: unknown) => {
      sendError(socket, error instanceof Error ? error.message : String(error), commandRunId, stream?.session.provider ?? commandHarness, commandType, commandRequestId)
    })
  })
}

async function sessionOfLive(live: LiveRun): Promise<string | null> {
  if (live.sessionId) return live.sessionId
  return await new Promise((resolve) => {
    const listener = (frame: StreamFrame) => {
      if (!frame.sessionId && !['run.failed', 'run.aborted'].includes(frame.type)) return
      live.unsubscribe(listener)
      resolve(frame.sessionId ?? null)
    }
    const subscription = live.subscribe(listener)
    for (const frame of subscription.replay) listener(frame)
  })
}

function resolveLive(
  harness: AgentHarness,
  frame: AbortFrame,
): LiveRun | undefined {
  if (frame.runId !== undefined) {
    const byRun = harness.live(frame.runId)
    if (byRun?.status === 'running') return byRun
  }
  if (frame.sessionId !== undefined) {
    const ref: SessionRef = {
      provider: providerIdForHarness(frame.harness),
      id: frame.sessionId,
    }
    return harness.liveForSession(ref)
  }
  return undefined
}

function sendError(socket: WebSocket, message: string, runId: string, harness: string, code: string, requestId?: string): void {
  if (!socketOpen(socket)) return
  const stamper = new EnvelopeStamper(runId, harness)
  socket.send(encodeEvent(stamper.stamp({ type: 'error', message, code, ...(requestId ? { requestId } : {}) })))
}

function socketOpen(socket: WebSocket): boolean {
  return socket.readyState === 1
}

function rawToString(data: WebSocket.RawData): string {
  if (typeof data === 'string') return data
  if (Buffer.isBuffer(data)) return data.toString('utf8')
  if (Array.isArray(data)) return Buffer.concat(data).toString('utf8')
  return Buffer.from(data).toString('utf8')
}
