import path from 'node:path'
import { randomUUID } from 'node:crypto'
import type { FastifyPluginCallback } from 'fastify'
import { z } from 'zod'
import { WhiteboardError, whiteboardContextSchema, whiteboardWriteSchema, whiteboardSessionIdSchema } from '../../../core/resource/whiteboard.js'
import type { WhiteboardService, WhiteboardEvent } from '../../../harness/whiteboard/whiteboard-service.js'

const locationSchema = z.object({ path: z.string().min(1).max(8192), cwd: z.string().min(1).max(8192).optional() }).strict()
const sessionSchema = z.object({ cwd: z.string().min(1).max(8192), sessionId: whiteboardSessionIdSchema }).strict()
const readSchema = locationSchema.extend(sessionSchema.shape)
const writeSchema = readSchema.extend({ ...whiteboardWriteSchema.shape, owner: z.string().max(200) }).strict()
const clientMessageSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('write'), requestId: z.string().min(1).max(128), ops: whiteboardWriteSchema.shape.ops }).strict(),
  z.object({ type: z.literal('context'), ...whiteboardContextSchema.shape }).strict(),
])

export const whiteboardRoutes: FastifyPluginCallback<{ service: WhiteboardService }> = (server, { service }, done) => {
  server.setErrorHandler((error, request, reply) => {
    if (error instanceof WhiteboardError) { void reply.code(error.statusCode).send({ detail: error.message }); return }
    if (error instanceof z.ZodError) { void reply.code(400).send({ detail: error.message }); return }
    request.log.error({ err: error }, 'Whiteboard request failed')
    void reply.code(500).send({ detail: 'Could not access whiteboard' })
  })
  server.post('/api/sandbox/whiteboards/list', async (request) => {
    const input = sessionSchema.parse(request.body)
    return { files: await service.listSession(input.cwd, input.sessionId) }
  })
  server.post('/api/sandbox/whiteboards/read', async (request) => {
    const input = readSchema.parse(request.body)
    const file = await service.resolveSessionPath(input.path, input.cwd, input.sessionId)
    const board = await service.read(file)
    const { contexts, claims } = service.presence(file)
    return { path: file, board, contexts, claims }
  })
  server.post('/api/sandbox/whiteboards/write', { bodyLimit: 4 * 1024 * 1024 }, async (request) => {
    const input = writeSchema.parse(request.body)
    const file = await service.resolveSessionPath(input.path, input.cwd, input.sessionId, true)
    const board = await service.write(file, { ops: input.ops, ...(input.title === undefined ? {} : { title: input.title }), ...(input.claim === undefined ? {} : { claim: input.claim }) }, 'agent', input.owner)
    return { path: file, board }
  })
  server.get('/api/sandbox/whiteboards/stream', { websocket: true }, (socket, request) => {
    const id = randomUUID()
    let file: string | undefined, unsubscribe: (() => void) | undefined, ready = false
    const buffered: WhiteboardEvent[] = []
    const isOpen = (): boolean => socket.readyState === 1
    const send = (value: unknown): void => {
      if (!isOpen()) return
      if (socket.bufferedAmount > 8 * 1024 * 1024) { socket.close(1008, 'Whiteboard client is too slow'); return }
      socket.send(JSON.stringify(value))
    }
    const fail = (error: unknown, requestId?: string): void => {
      if (!(error instanceof WhiteboardError || error instanceof z.ZodError || error instanceof SyntaxError)) request.log.error({ err: error }, 'Whiteboard socket failed')
      send({ type: 'error', ...(requestId === undefined ? {} : { requestId }), message: error instanceof WhiteboardError || error instanceof z.ZodError || error instanceof SyntaxError ? error.message : 'Could not access whiteboard' })
    }
    socket.once('close', () => {
      unsubscribe?.(); clearInterval(expiry)
      if (file) service.updateContext(file, id, null)
    })
    socket.on('error', (error) => request.log.warn({ err: error }, 'Whiteboard socket error'))
    const expiry = setInterval(() => { if (file && ready) send(service.presence(file)) }, 10_000)
    expiry.unref()
    const initialize = (async () => {
      const input = locationSchema.parse(request.query)
      file = await service.resolvePath(input.path, input.cwd, false, true)
      if (!isOpen()) return
      unsubscribe = service.subscribe(file, (event) => { if (ready) send(event); else buffered.push(event) })
      const board = await service.read(file).catch((error: unknown) => {
        if (error instanceof WhiteboardError && error.statusCode === 404) return { v: 1 as const, title: path.basename(input.path, '.board.json'), revision: 0, order: [], elements: {} }
        throw error
      })
      if (!isOpen()) return
      send({ type: 'snapshot', path: file, board })
      for (const event of buffered) if (event.type !== 'change' || event.revision > board.revision) send(event)
      buffered.length = 0
      ready = true
      send(service.presence(file))
    })()
    void initialize.catch((error: unknown) => { fail(error); socket.close(1008, 'Cannot open whiteboard') })
    let messages: Promise<void> = initialize
    socket.on('message', (data, binary) => {
      const bytes = Array.isArray(data) ? Buffer.concat(data) : data instanceof ArrayBuffer ? Buffer.from(data) : data
      if (binary || bytes.length > 4 * 1024 * 1024) { socket.close(1009, 'Invalid whiteboard message'); return }
      // Keep browser edits ordered, including messages arriving during snapshot.
      messages = messages.then(async () => {
        if (!isOpen() || !file) return
        let requestId: string | undefined
        try {
          const raw: unknown = JSON.parse(bytes.toString('utf8'))
          if (typeof raw === 'object' && raw !== null && 'requestId' in raw && typeof raw.requestId === 'string') requestId = raw.requestId.slice(0, 128)
          const message = clientMessageSchema.parse(raw)
          if (message.type === 'write') {
            const board = await service.write(file, { ops: message.ops }, 'user', id)
            send({ type: 'ack', requestId: message.requestId, revision: board.revision })
          } else {
            service.updateContext(file, id, { selection: message.selection,
              ...(message.viewport ? { viewport: message.viewport } : {}), ...(message.issues ? { issues: message.issues } : {}) })
          }
        } catch (error) { fail(error, requestId) }
      }).catch(() => { /* Initialization reports its own error and closes. */ })
    })
  })
  done()
}
