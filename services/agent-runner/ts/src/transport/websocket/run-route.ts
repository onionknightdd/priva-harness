import { randomUUID } from 'node:crypto'

import type { FastifyPluginCallback } from 'fastify'
import type { WebSocket } from 'ws'

import type { ProviderRunSpec } from '../../core/contract/agent-provider.js'
import {
  providerIdForHarness,
  rewriteProviderBaseUrl,
} from '../../core/resource/run-harness.js'
import type { AgentHarness } from '../../harness/agent-harness.js'
import type { AgentProfileService } from '../../harness/config/agent-profile-service.js'
import type { ModelProfileService } from '../../harness/config/model-profile-service.js'
import { encodeEvent } from '../../core/event/encode-event.js'
import { EnvelopeStamper } from '../../harness/run/envelope-stamper.js'
import {
  parseInitFrame,
  sessionTargetFromInit,
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
  const abort = new AbortController()
  const onClose = (): void => abort.abort()
  socket.once('close', onClose)

  try {
    const runId = randomUUID()
    let harnessName = 'unknown'

    const raw = await readFirstMessage(socket)
    if (isAborted(abort.signal)) return

    let parsed: unknown
    try {
      parsed = JSON.parse(raw) as unknown
    } catch {
      sendError(socket, 'Init frame must be JSON', runId, harnessName)
      socket.close()
      return
    }

    const init = parseInitFrame(parsed)
    if (!init.ok) {
      sendError(socket, init.message, runId, harnessName)
      socket.close()
      return
    }
    harnessName = init.frame.harness

    let spec: ProviderRunSpec
    try {
      spec = await buildRunSpec(options, init.frame)
    } catch (error) {
      sendError(socket, error instanceof Error ? error.message : String(error), runId, harnessName)
      socket.close()
      return
    }

    for await (const event of options.harness.run(
      { text: init.frame.text },
      { signal: abort.signal },
      spec,
      { runId, session: sessionTargetFromInit(init.frame) },
    )) {
      if (isAborted(abort.signal) || !socketOpen(socket)) break
      socket.send(encodeEvent(event))
    }
    if (socketOpen(socket)) socket.close()
  } catch (error) {
    if (!isAborted(abort.signal) && socketOpen(socket)) {
      sendError(socket, error instanceof Error ? error.message : String(error), randomUUID(), 'unknown')
      socket.close()
    }
  } finally {
    socket.off('close', onClose)
    abort.abort()
  }
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

function socketOpen(socket: WebSocket): boolean {
  return socket.readyState === 1
}

function isAborted(signal: AbortSignal): boolean {
  return signal.aborted
}

function rawToString(data: WebSocket.RawData): string {
  if (typeof data === 'string') return data
  if (Buffer.isBuffer(data)) return data.toString('utf8')
  if (Array.isArray(data)) return Buffer.concat(data).toString('utf8')
  return Buffer.from(data).toString('utf8')
}
