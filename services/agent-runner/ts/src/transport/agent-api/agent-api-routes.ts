import type { FastifyError, FastifyPluginCallback, FastifyReply, FastifyRequest } from 'fastify'
import { z } from 'zod'

import { AgentApiError, errorBody, validationError } from '../../core/agent-api/errors.js'
import type { AgentApiEvent } from '../../core/agent-api/events.js'
import { newId } from '../../core/agent-api/ids.js'
import {
  createSessionBodySchema,
  eventsQuerySchema,
  runQuerySchema,
  runsQuerySchema,
  sendMessageBodySchema,
  sessionsQuerySchema,
  type ResponseMode,
  type StreamOptions,
} from '../../core/agent-api/input.js'
import type { MessageAccepted, MessageResult } from '../../core/agent-api/responses.js'
import { SessionError } from '../../core/resource/session.js'
import { UserFileError } from '../../core/resource/user-file.js'
import type { AgentApiService, MessageInput } from '../../harness/agent-api/agent-api-service.js'
import { runScope, type SubscriptionOptions } from '../../harness/agent-api/event-subscription.js'
import { openSse } from './sse.js'

export const SANDBOX_AGENT_API_PREFIX = '/api/agent/v1/sandbox'

export interface AgentApiRoutesOptions {
  readonly service: AgentApiService
}

const sessionParams = z.strictObject({ ses: z.string().min(1) })
const runParams = z.strictObject({ ses: z.string().min(1), run: z.string().min(1) })
const requestIds = new WeakMap<FastifyRequest, string>()

/** Agent API v1 under one base path; the scenario A deployment mounts it at `SANDBOX_AGENT_API_PREFIX`. */
export const agentApiRoutes: FastifyPluginCallback<AgentApiRoutesOptions> = (fastify, options, done) => {
  const { service } = options

  fastify.addHook('onRequest', (request, reply, next) => {
    const id = newId('req')
    requestIds.set(request, id)
    void reply.header('Request-Id', id)
    next()
  })
  fastify.setErrorHandler((error, request, reply) => sendError(error, request, reply))

  fastify.get('/', async () => await service.capabilities())

  fastify.post('/sessions', async (request, reply) => {
    const body = parse(createSessionBodySchema, request.body ?? {})
    const record = await service.createSession(body)
    void reply.header('Location', `${request.url.replace(/\/$/u, '')}/${record.id}`)
    const { message } = body
    if (message === undefined) return await reply.code(201).send({ session: await service.session(record.id) })
    const key = idempotencyKey(request)
    const send = () => service.sendMessage(record.id, messageInput({ ...body, message }), key)
    const mode = body.response ?? 'stream'
    if (mode === 'stream') return await streamRun(service, reply, record.id, send, body.stream_options)
    const result = await respond(service, reply, record.id, mode, send)
    return await reply.code(201).send({ session: await service.session(record.id), ...result })
  })

  fastify.post('/sessions/:ses/messages', async (request, reply) => {
    const { ses } = parse(sessionParams, request.params)
    const body = parse(sendMessageBodySchema, request.body)
    const key = idempotencyKey(request)
    const send = () => service.sendMessage(ses, messageInput(body), key)
    const mode = body.response ?? 'stream'
    if (mode === 'stream') return await streamRun(service, reply, ses, send, body.stream_options)
    const result = await respond(service, reply, ses, mode, send)
    return await reply.code('interactions' in result ? 200 : 202).send(result)
  })

  fastify.get('/sessions/:ses/runs', async (request) => {
    const { ses } = parse(sessionParams, request.params)
    return await service.runs(ses, parse(runsQuerySchema, request.query))
  })

  fastify.get('/sessions/:ses/runs/:run', async (request, reply) => {
    const { ses, run } = parse(runParams, request.params)
    const { wait } = parse(runQuerySchema, request.query)
    return (await service.runResult(ses, run, { wait: wait ?? false, signal: disconnected(reply) })).result
  })

  fastify.get('/sessions/:ses/events', async (request, reply) => {
    const { ses } = parse(sessionParams, request.params)
    const query = parse(eventsQuerySchema, request.query)
    if (query.native === true) throw new AgentApiError('feature_unavailable', 'Native events are not available yet', { param: 'native' })
    const header = request.headers['last-event-id']
    const lastEventId = typeof header === 'string' && header.trim() !== '' ? Number(header) : undefined
    if (lastEventId !== undefined && (!Number.isInteger(lastEventId) || lastEventId < 0)) {
      throw new AgentApiError('cursor_invalid', 'Last-Event-ID must be a non-negative integer', { param: 'Last-Event-ID' })
    }
    if (lastEventId !== undefined && query.after !== undefined && lastEventId !== query.after) {
      throw new AgentApiError('cursor_invalid', 'after and Last-Event-ID disagree', { param: 'after' })
    }
    return await stream(service, reply, ses, {
      after: lastEventId ?? query.after ?? 0, deltas: query.deltas ?? true, threads: query.threads ?? 'all',
    })
  })

  fastify.get('/sessions', async (request) => {
    const query = parse(sessionsQuerySchema, request.query)
    return await service.listSessions(query.cursor, query.limit)
  })

  fastify.get('/sessions/:ses', async (request) => {
    const { ses } = parse(sessionParams, request.params)
    return await service.snapshot(ses)
  })

  fastify.delete('/sessions/:ses', async (request, reply) => {
    const { ses } = parse(sessionParams, request.params)
    await service.deleteSession(ses)
    return await reply.code(204).send()
  })

  fastify.post('/sessions/:ses/files', async (request, reply) => {
    const { ses } = parse(sessionParams, request.params)
    const file = await request.file({ limits: { files: 1, fileSize: service.maxUploadBytes } })
    if (file?.fieldname !== 'file') {
      throw new AgentApiError('validation_failed', 'Send exactly one multipart field named file', { param: 'file' })
    }
    return await reply.code(201).send(await service.uploadFile(ses, file.filename || 'upload', untruncated(file.file, service.maxUploadBytes)))
  })

  done()
}

function messageInput(body: MessageInput): MessageInput {
  return {
    message: body.message,
    ...(body.delivery === undefined ? {} : { delivery: body.delivery }),
    ...(body.allow_interrupt === undefined ? {} : { allow_interrupt: body.allow_interrupt }),
  }
}

/**
 * `accepted` returns the acceptance at once. `wait` returns the run once it
 * settles within the wait limit, and the acceptance otherwise; leaving early
 * only ends the wait, never the run.
 */
async function respond(service: AgentApiService, reply: FastifyReply, ses: string, mode: Exclude<ResponseMode, 'stream'>,
  send: () => Promise<{ accepted: MessageAccepted }>): Promise<MessageAccepted | MessageResult> {
  const { accepted } = await send()
  if (mode === 'accepted') return accepted
  const { result, settled } = await service.runResult(ses, accepted.run.id, { wait: true, signal: disconnected(reply) })
  return settled ? { message: accepted.message, ...result, last_event_seq: accepted.last_event_seq } : accepted
}

/** Aborts when the client goes away before the response is written. */
function disconnected(reply: FastifyReply): AbortSignal {
  const controller = new AbortController()
  reply.raw.once('close', () => { controller.abort() })
  return controller.signal
}

/**
 * `response = stream`: the events of one run, closing after its `run.completed`.
 * Following starts before the launch so no delta is missed; a retried
 * request replays the original run from its cursor. Disconnecting does not cancel the run.
 */
async function streamRun(service: AgentApiService, reply: FastifyReply, ses: string,
  send: () => Promise<{ accepted: MessageAccepted; replayed: boolean }>, options: StreamOptions | undefined): Promise<FastifyReply> {
  if (options?.native === true) throw new AgentApiError('feature_unavailable', 'Native events are not available yet', { param: 'stream_options.native' })
  return await stream(service, reply, ses, { after: 'now', deltas: options?.deltas ?? true, threads: options?.threads ?? 'all' }, send)
}

/** Subscribe before writing headers so cursor and send errors are still JSON responses. */
async function stream(service: AgentApiService, reply: FastifyReply, ses: string, options: SubscriptionOptions,
  send?: () => Promise<{ accepted: MessageAccepted; replayed: boolean }>): Promise<FastifyReply> {
  const relay = new EventRelay()
  let subscription = await service.subscribe(ses, options, relay.push)
  let scope: ReturnType<typeof runScope> | undefined
  if (send !== undefined) {
    let sent: { accepted: MessageAccepted; replayed: boolean }
    try {
      sent = await send()
    } catch (error) {
      subscription.close()
      throw error
    }
    scope = runScope(sent.accepted.run.id)
    if (sent.replayed) {
      subscription.close()
      relay.clear()
      subscription = await service.subscribe(ses, { ...options, after: sent.accepted.last_event_seq }, relay.push)
    }
  }
  const writer = openSse(reply)
  const current = subscription
  writer.onClose(() => { current.close() })
  relay.drainTo((event) => {
    if (scope !== undefined && !scope.includes(event)) return
    writer.send(event)
    if (scope?.ends(event) === true) writer.close()
  })
  return reply
}

/** Holds events until the response is ready to write them. */
class EventRelay {
  private readonly held: AgentApiEvent[] = []
  private target: ((event: AgentApiEvent) => void) | undefined

  readonly push = (event: AgentApiEvent): void => {
    if (this.target === undefined) this.held.push(event)
    else this.target(event)
  }

  clear(): void {
    this.held.length = 0
  }

  drainTo(target: (event: AgentApiEvent) => void): void {
    this.target = target
    for (const event of this.held.splice(0)) target(event)
  }
}

function idempotencyKey(request: FastifyRequest): string | undefined {
  const header = request.headers['idempotency-key']
  if (header === undefined) return undefined
  if (typeof header !== 'string' || header.trim() === '' || header.length > 255) {
    throw new AgentApiError('validation_failed', 'Idempotency-Key must be a non-empty string of at most 255 characters', { param: 'Idempotency-Key' })
  }
  return header.trim()
}

/** Multipart stops at the size limit silently; fail before the partial file is committed. */
async function* untruncated(file: AsyncIterable<Uint8Array> & { readonly truncated: boolean }, limit: number): AsyncIterable<Uint8Array> {
  yield* file
  if (file.truncated) throw new AgentApiError('file_too_large', `File exceeds the ${String(limit)} byte upload limit`)
}

function parse<T extends z.ZodType>(schema: T, value: unknown, prefix?: string): z.output<T> {
  const result = schema.safeParse(value)
  if (!result.success) throw validationError(result.error, prefix)
  return result.data
}

function sendError(error: unknown, request: FastifyRequest, reply: FastifyReply): FastifyReply {
  const apiError = toAgentApiError(error)
  if (apiError.status >= 500) request.log.error({ err: error }, 'Agent API request failed')
  if (apiError.code === 'queue_full') void reply.header('Retry-After', '30')
  return reply.code(apiError.status).send(errorBody(apiError, requestIds.get(request) ?? newId('req')))
}

function toAgentApiError(error: unknown): AgentApiError {
  // Storage adapters wrap stream failures; the original cause says what the client did wrong.
  for (let cause: unknown = error; cause instanceof Error; cause = cause.cause) {
    if (cause instanceof AgentApiError) return cause
    if (isFastifyError(cause) && cause.code === 'FST_REQ_FILE_TOO_LARGE') return new AgentApiError('file_too_large', cause.message)
  }
  if (error instanceof z.ZodError) return validationError(error)
  if (error instanceof SessionError) {
    if (error.kind === 'session-not-found') return new AgentApiError('not_found', error.message)
    if (error.kind === 'session-busy' || error.kind === 'run-mode-conflict') return new AgentApiError('session_busy', error.message)
    if (error.kind === 'invalid-request') return new AgentApiError('validation_failed', error.message)
  }
  if (error instanceof UserFileError) {
    if (error.kind === 'upload-too-large') return new AgentApiError('file_too_large', error.message)
    if (error.kind === 'invalid-request' || error.kind === 'invalid-path-segment' || error.kind === 'missing-field') {
      return new AgentApiError('validation_failed', error.message)
    }
  }
  if (isFastifyError(error)) {
    if (error.statusCode !== undefined && error.statusCode >= 400 && error.statusCode < 500) {
      return new AgentApiError(error.statusCode === 404 ? 'not_found' : 'validation_failed', error.message)
    }
  }
  return new AgentApiError('internal_error', 'Internal server error', { cause: error })
}

function isFastifyError(error: unknown): error is FastifyError {
  return error instanceof Error && 'code' in error && typeof error.code === 'string'
}
