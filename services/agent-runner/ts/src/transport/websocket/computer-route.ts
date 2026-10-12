import { createConnection } from 'node:net'

import type { FastifyBaseLogger, FastifyPluginCallback, FastifyRequest } from 'fastify'
import { createWebSocketStream, WebSocket, type RawData } from 'ws'

import type { ComputerConfig } from '../../computer-config.js'

const MAX_INPUT_BYTES = 8 * 1024 * 1024
const CONNECT_TIMEOUT_MS = 10_000
const CLOSE_TIMEOUT_MS = 2_000
const HEARTBEAT_INTERVAL_MS = 30_000

export const computerRoutes: FastifyPluginCallback<{ computer?: ComputerConfig }> = (
  fastify, { computer }, done,
) => {
  const connections = new Set<() => void>()
  fastify.get('/api/sandbox/computer', async (_request, reply) => {
    void reply.header('Cache-Control', 'no-store')
    return { available: computer !== undefined }
  })
  fastify.get('/api/sandbox/computer/stream', {
    websocket: true,
    preValidation: async (request, reply) => {
      if (computer === undefined) {
        void reply.code(503).send({ detail: 'The computer desktop is not configured' })
      } else if (!allowsOrigin(request, computer.allowedOrigins)) {
        void reply.code(403).send({ detail: 'The computer stream requires an allowed Origin' })
      } else if (request.raw.url?.includes('?')) {
        void reply.code(400).send({ detail: 'The computer stream does not accept query parameters' })
      }
    },
  }, (socket, request) => {
    if (computer === undefined) { socket.close(1011, 'Desktop not configured'); return }
    const stop = relayDesktop(socket, computer, request.log, () => connections.delete(stop))
    connections.add(stop)
  })
  fastify.addHook('preClose', (next) => {
    for (const stop of connections) stop()
    next()
  })
  done()
}

function allowsOrigin(request: FastifyRequest, allowedOrigins: readonly string[]): boolean {
  const origin = request.headers.origin
  if (!origin || origin === 'null') return false
  let parsed: URL
  try { parsed = new URL(origin) } catch { return false }
  if (origin !== parsed.origin || !['http:', 'https:'].includes(parsed.protocol)) return false
  if (allowedOrigins.includes(origin)) return true
  // Proxy headers are client-controlled unless the deployment explicitly trusts
  // that proxy. Vite's rewritten Host uses the explicit origin allowlist instead.
  return origin === `${request.protocol}://${request.headers.host ?? ''}`
}

function relayDesktop(
  socket: WebSocket,
  computer: ComputerConfig,
  log: FastifyBaseLogger,
  onClosed: () => void,
): () => void {
  const upstream = createConnection({ host: computer.host, port: computer.port })
  let closing = false
  let alive = true
  let forceClose: NodeJS.Timeout | undefined

  const close = (code: number, reason: string): void => {
    if (closing) return
    closing = true
    clearTimeout(connectTimeout)
    clearInterval(heartbeat)
    stream.unpipe(upstream)
    upstream.unpipe(stream)
    upstream.destroy()
    socket.close(code, reason)
    forceClose = setTimeout(() => socket.terminate(), CLOSE_TIMEOUT_MS)
    forceClose.unref()
  }
  const fail = (error: Error): void => {
    if (!closing) log.warn({ err: error }, 'Computer stream failed')
    close(1011, 'Desktop connection failed')
  }
  const connectTimeout = setTimeout(() => {
    close(1011, 'Desktop connection timed out')
  }, CONNECT_TIMEOUT_MS)
  connectTimeout.unref()
  const heartbeat = setInterval(() => {
    if (!alive) { close(1001, 'Desktop client disconnected'); return }
    alive = false
    if (socket.readyState === WebSocket.OPEN) socket.ping()
  }, HEARTBEAT_INTERVAL_MS)
  heartbeat.unref()

  // Register before the stream listener so invalid messages never reach VNC.
  // ws also bounds the individual wire message; this tighter application limit
  // leaves room for clipboard pastes without accepting arbitrarily large input.
  socket.on('message', (data: RawData, binary: boolean) => {
    if (!binary) close(1003, 'The desktop stream accepts binary RFB data only')
    else if (messageBytes(data) > MAX_INPUT_BYTES) close(1009, 'Desktop input exceeds 8 MiB')
  })
  const stream = createWebSocketStream(socket, {
    readableHighWaterMark: 64 * 1024,
    writableHighWaterMark: 64 * 1024,
  })
  // Both directions use stream backpressure. In particular, a slow browser
  // pauses the VNC socket instead of accumulating framebuffer updates in RAM.
  stream.pipe(upstream).pipe(stream)
  upstream.once('connect', () => { clearTimeout(connectTimeout); upstream.setNoDelay(true) })
  upstream.on('error', fail)
  upstream.on('close', () => {
    if (!upstream.readableEnded && !closing) close(1011, 'Desktop connection closed')
  })
  stream.on('error', fail)
  socket.on('pong', () => { alive = true })
  socket.on('error', fail)
  socket.once('close', () => {
    closing = true
    clearTimeout(connectTimeout)
    clearInterval(heartbeat)
    clearTimeout(forceClose)
    upstream.destroy()
    stream.destroy()
    onClosed()
  })
  return () => close(1001, 'Runner shutting down')
}

function messageBytes(data: RawData): number {
  if (Array.isArray(data)) return data.reduce((total, part) => total + part.byteLength, 0)
  return data.byteLength
}
