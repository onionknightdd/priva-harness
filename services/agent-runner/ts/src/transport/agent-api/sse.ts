import type { FastifyReply } from 'fastify'

import { isDurableEvent, type AgentApiEvent } from '../../core/agent-api/events.js'

const HEARTBEAT_MS = 15_000

export interface SseWriter {
  send(event: AgentApiEvent): void
  close(): void
  /** Runs once when the client disconnects or the stream is closed. */
  onClose(listener: () => void): void
}

/** Durable events carry `id:` so EventSource reconnects with `Last-Event-ID`; ephemeral ones do not. */
export function encodeAgentApiSse(event: AgentApiEvent): string {
  const id = isDurableEvent(event) ? `id: ${String(event.seq)}\n` : ''
  return `${id}event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`
}

export function openSse(reply: FastifyReply): SseWriter {
  const requestId = reply.getHeader('request-id')
  reply.hijack()
  const raw = reply.raw
  raw.writeHead(200, {
    'content-type': 'text/event-stream; charset=utf-8',
    'cache-control': 'no-store',
    'x-accel-buffering': 'no',
    connection: 'keep-alive',
    ...(typeof requestId === 'string' ? { 'request-id': requestId } : {}),
  })
  const listeners: (() => void)[] = []
  let closed = false
  const heartbeat = setInterval(() => { raw.write(': keep-alive\n\n') }, HEARTBEAT_MS)
  heartbeat.unref()
  const finish = (): void => {
    if (closed) return
    closed = true
    clearInterval(heartbeat)
    for (const listener of listeners.splice(0)) listener()
  }
  raw.on('close', finish)
  return {
    send(event) {
      if (!closed) raw.write(encodeAgentApiSse(event))
    },
    close() {
      if (closed) return
      finish()
      raw.end()
    },
    onClose(listener) {
      if (closed) listener()
      else listeners.push(listener)
    },
  }
}
