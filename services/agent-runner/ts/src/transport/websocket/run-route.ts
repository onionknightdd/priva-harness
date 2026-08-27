import { randomUUID } from 'node:crypto'

import type { FastifyPluginCallback } from 'fastify'
import type { WebSocket } from 'ws'

import type { ProviderRunSpec, SessionRef } from '../../core/contract/agent-provider.js'
import type { StreamFrame } from '../../core/event/agent-event.js'
import { encodeEvent } from '../../core/event/encode-event.js'
import {
  providerIdForHarness,
  rewriteProviderBaseUrl,
} from '../../core/resource/run-harness.js'
import { SessionError } from '../../core/resource/session.js'
import type { AgentHarness } from '../../harness/agent-harness.js'
import type { AgentProfileService } from '../../harness/config/agent-profile-service.js'
import type { ModelProfileService } from '../../harness/config/model-profile-service.js'
import { EnvelopeStamper } from '../../harness/run/envelope-stamper.js'
import type { LiveRun } from '../../harness/run/live-run.js'
import {
  parseClientFrame,
  sessionTargetFromInit,
  type AbortFrame,
  type AttachFrame,
  type InitFrame,
} from './schema/run-frames.js'

export const RUN_WEBSOCKET_PATH = '/api/sandbox/agent/ws/run'

export interface RunRouteOptions {
  readonly harness: AgentHarness
  readonly modelProfileService: ModelProfileService
  readonly agentProfileService: AgentProfileService
  readonly cwd: string
}

export const runWebsocketRoutes: FastifyPluginCallback<RunRouteOptions> = (fastify, options, done) => {
  fastify.get(RUN_WEBSOCKET_PATH, { websocket: true }, (socket) => {
    void handleRunSocket(socket, options)
  })
  done()
}

async function handleRunSocket(
  socket: WebSocket,
  options: RunRouteOptions,
): Promise<void> {
  let live: LiveRun | undefined
  let listener: ((frame: StreamFrame) => void) | undefined

  try {
    const raw = await readFirstMessage(socket)
    let parsed: unknown
    try {
      parsed = JSON.parse(raw) as unknown
    } catch {
      sendError(socket, 'Init frame must be JSON', randomUUID(), 'unknown')
      socket.close()
      return
    }

    const client = parseClientFrame(parsed)
    if (!client.ok) {
      sendError(socket, client.message, randomUUID(), harnessOf(parsed) ?? 'unknown')
      socket.close()
      return
    }

    const frame = client.frame
    if (frame.type === 'init') {
      live = await startInit(socket, options, frame)
    } else {
      live = resolveLive(options.harness, frame)
      if (live === undefined) {
        sendError(socket, 'No live run to attach', randomUUID(), frame.harness)
        socket.close()
        return
      }
      if (frame.type === 'abort') {
        live.abort.abort()
      }
    }
    if (live === undefined) return

    const sinceSeq = frame.type === 'attach' ? frame.sinceSeq : 0
    const queued: StreamFrame[] = []
    let replaying = true
    listener = (event) => {
      if (replaying) {
        queued.push(event)
        return
      }
      if (socketOpen(socket)) socket.send(encodeEvent(event))
    }
    const subscription = live.subscribe(listener, sinceSeq)
    let lastSent = sinceSeq
    if (subscription.gap) {
      if (socketOpen(socket)) socket.send(encodeEvent(live.gapFrame()))
    } else {
      for (const replayed of subscription.replay) {
        if (socketOpen(socket)) socket.send(encodeEvent(replayed))
        lastSent = replayed.seq
      }
    }
    replaying = false
    for (const extra of queued) {
      if (extra.seq <= lastSent) continue
      if (socketOpen(socket)) socket.send(encodeEvent(extra))
      lastSent = extra.seq
    }

    const onLater = (data: WebSocket.RawData): void => {
      let later: unknown
      try {
        later = JSON.parse(rawToString(data)) as unknown
      } catch {
        return
      }
      const parsedLater = parseClientFrame(later)
      if (!parsedLater.ok || parsedLater.frame.type !== 'abort') return
      const target = resolveLive(options.harness, parsedLater.frame) ?? live
      target?.abort.abort()
    }
    socket.on('message', onLater)

    await live.waitForComplete()
    socket.off('message', onLater)
    if (socketOpen(socket)) socket.close()
  } catch (error) {
    const message = error instanceof SessionError
      ? error.message
      : error instanceof Error ? error.message : String(error)
    if (socketOpen(socket)) {
      sendError(socket, message, live?.runId ?? randomUUID(), live?.provider ?? 'unknown')
      socket.close()
    }
  } finally {
    if (live !== undefined && listener !== undefined) {
      live.unsubscribe(listener)
    }
  }
}

async function startInit(
  socket: WebSocket,
  options: RunRouteOptions,
  frame: InitFrame,
): Promise<LiveRun | undefined> {
  let spec: ProviderRunSpec
  try {
    spec = await buildRunSpec(options, frame)
  } catch (error) {
    sendError(socket, error instanceof Error ? error.message : String(error), randomUUID(), frame.harness)
    socket.close()
    return undefined
  }
  return options.harness.launch(
    { text: frame.text },
    spec,
    { session: sessionTargetFromInit(frame) },
  )
}

function resolveLive(
  harness: AgentHarness,
  frame: AttachFrame | AbortFrame,
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

async function buildRunSpec(
  options: RunRouteOptions,
  frame: InitFrame,
): Promise<ProviderRunSpec> {
  const resolved = await options.modelProfileService.resolve(frame.model)
  const agentProfile = await options.agentProfileService.read()
  return {
    cwd: frame.cwd,
    provider: providerIdForHarness(frame.harness),
    model: resolved.model,
    baseUrl: rewriteProviderBaseUrl(resolved.profile.baseUrl, frame.harness),
    authToken: resolved.profile.authToken,
    profileId: resolved.profile.id,
    modelContext: resolved.capabilities.context,
    queueBehavior: agentProfile.queueBehavior,
    ...(frame.effort === undefined ? {} : { effort: frame.effort }),
    ...(frame.promptSuggestions === undefined
      ? {}
      : { promptSuggestions: frame.promptSuggestions }),
  }
}

function readFirstMessage(socket: WebSocket): Promise<string> {
  return new Promise((resolve, reject) => {
    const onMessage = (data: WebSocket.RawData): void => {
      cleanup()
      resolve(rawToString(data))
    }
    const onError = (error: Error): void => {
      cleanup()
      reject(error)
    }
    const onClose = (): void => {
      cleanup()
      reject(new Error('socket closed before init'))
    }
    const cleanup = (): void => {
      socket.off('message', onMessage)
      socket.off('error', onError)
      socket.off('close', onClose)
    }
    socket.once('message', onMessage)
    socket.once('error', onError)
    socket.once('close', onClose)
  })
}

function sendError(socket: WebSocket, message: string, runId: string, harness: string): void {
  if (!socketOpen(socket)) return
  const stamper = new EnvelopeStamper(runId, harness)
  socket.send(encodeEvent(stamper.stamp({ type: 'error', message })))
}

function harnessOf(raw: unknown): string | undefined {
  if (typeof raw !== 'object' || raw === null) return undefined
  const harness = (raw as { harness?: unknown }).harness
  return typeof harness === 'string' ? harness : undefined
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
