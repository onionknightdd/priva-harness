import { randomUUID } from 'node:crypto'

import type { FastifyPluginCallback } from 'fastify'
import type { WebSocket } from 'ws'

import type { AgentHarness } from '../../harness/agent-harness.js'
import { parseInitFrame, type ErrorFrame } from './schema/run-frames.js'
import { encodeServerFrame } from './wire-event-mapper.js'

export const RUN_WEBSOCKET_PATH = '/api/sandbox/agent/ws/run'

export interface RunRouteOptions {
  readonly harness: AgentHarness
}

export const runWebsocketRoutes: FastifyPluginCallback<RunRouteOptions> = (fastify, options, done) => {
  fastify.get(RUN_WEBSOCKET_PATH, { websocket: true }, (socket) => {
    void handleRunSocket(socket, options.harness)
  })
  done()
}

async function handleRunSocket(socket: WebSocket, harness: AgentHarness): Promise<void> {
  const abort = new AbortController()
  const onClose = (): void => abort.abort()
  socket.once('close', onClose)

  try {
    const raw = await readFirstMessage(socket)
    if (isAborted(abort.signal)) return

    let parsed: unknown
    try {
      parsed = JSON.parse(raw) as unknown
    } catch {
      sendError(socket, 'Init frame must be JSON')
      socket.close()
      return
    }

    const init = parseInitFrame(parsed)
    if (!init.ok) {
      sendError(socket, init.message)
      socket.close()
      return
    }

    const runId = randomUUID()
    for await (const event of harness.run({ text: init.frame.text }, { signal: abort.signal })) {
      if (isAborted(abort.signal) || !socketOpen(socket)) break
      socket.send(encodeServerFrame(event, runId))
    }
    if (socketOpen(socket)) socket.close()
  } catch (error) {
    if (!isAborted(abort.signal) && socketOpen(socket)) {
      sendError(socket, error instanceof Error ? error.message : String(error))
      socket.close()
    }
  } finally {
    socket.off('close', onClose)
    abort.abort()
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

function sendError(socket: WebSocket, message: string): void {
  if (!socketOpen(socket)) return
  const frame: ErrorFrame = { type: 'error', message }
  socket.send(JSON.stringify(frame))
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
