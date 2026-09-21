import type { FastifyPluginCallback } from 'fastify'
import type { WebSocket } from 'ws'
import { z } from 'zod'

import type { SessionTarget } from '../../core/contract/agent-provider.js'
import { isEffortLevel } from '../../core/contract/agent-provider.js'
import { TerminalError, type TerminalAttachment } from '../../core/contract/terminal-service.js'
import { isRunHarnessId, providerIdForHarness } from '../../core/resource/run-harness.js'
import type { AgentProfileService } from '../../harness/config/agent-profile-service.js'
import type { ModelProfileService } from '../../harness/config/model-profile-service.js'
import type { SessionTerminals } from '../../harness/terminal/session-terminals.js'
import { buildRunSpec } from './run-spec.js'

export const TERMINAL_WEBSOCKET_PATH = '/api/sandbox/agent/ws/terminal'

export interface TerminalRouteOptions {
  readonly terminals: SessionTerminals
  readonly modelProfileService: ModelProfileService
  readonly agentProfileService: AgentProfileService
}

/**
 * Wire protocol (both directions use the WebSocket frame type as the
 * discriminator):
 *   server → client  binary: raw terminal output;
 *                    text:   `{type:'ready', harness, sessionId, adopted, cols, rows}`
 *                            `{type:'exit', reason}` `{type:'error', kind, message}`
 *   client → server  binary: keystrokes;
 *                    text:   `{type:'resize', cols, rows}`
 */
const querySchema = z.object({
  harness: z.string().refine(isRunHarnessId, 'Unknown harness'),
  sessionId: z.string().trim().min(1).optional(),
  cwd: z.string().trim().min(1),
  model: z.string().trim().min(1),
  effort: z.string().refine(isEffortLevel, 'Unknown effort level').optional(),
  cols: z.coerce.number().int().min(20).max(500).default(120),
  rows: z.coerce.number().int().min(5).max(300).default(40),
})

const clientMessageSchema = z.object({
  type: z.literal('resize'),
  cols: z.number().int().min(20).max(500),
  rows: z.number().int().min(5).max(300),
})

export const terminalWebsocketRoutes: FastifyPluginCallback<TerminalRouteOptions> = (fastify, options, done) => {
  fastify.get(TERMINAL_WEBSOCKET_PATH, { websocket: true }, (socket, request) => {
    void handleTerminalSocket(socket, request.query, options)
  })
  done()
}

async function handleTerminalSocket(socket: WebSocket, rawQuery: unknown, options: TerminalRouteOptions): Promise<void> {
  const query = querySchema.safeParse(rawQuery)
  if (!query.success) {
    fail(socket, 'invalid-request', query.error.issues.map((issue) => issue.message).join('; '))
    return
  }
  const { harness, sessionId, cwd, model, effort, cols, rows } = query.data
  const provider = providerIdForHarness(harness)
  const target: SessionTarget = sessionId === undefined
    ? { kind: 'new', provider }
    : { kind: 'resume', session: { provider, id: sessionId } }
  let attachment: TerminalAttachment | undefined
  socket.once('close', () => { void attachment?.detach() })
  try {
    const spec = await buildRunSpec(options, {
      harness, model, cwd, ...(effort === undefined ? {} : { effort }),
    })
    const opened = await options.terminals.open(target, spec, { cols, rows })
    if (!socketOpen(socket)) return
    attachment = await options.terminals.attach(opened.session)
    if (!socketOpen(socket)) { await attachment.detach(); return }
    sendJson(socket, {
      type: 'ready', harness, sessionId: opened.session.id, adopted: opened.adopted,
      cols: attachment.cols, rows: attachment.rows,
    })
    if (socketOpen(socket)) socket.send(attachment.screen, { binary: true })
    attachment.onOutput((chunk) => { if (socketOpen(socket)) socket.send(chunk, { binary: true }) })
    attachment.onExit((reason) => {
      sendJson(socket, { type: 'exit', reason })
      socket.close(1000, 'terminal exited')
    })
    const live = attachment
    socket.on('message', (data, isBinary) => {
      if (isBinary) {
        live.write(toBytes(data)).catch((error: unknown) => { fail(socket, 'io-failure', describe(error)) })
        return
      }
      const parsed = clientMessageSchema.safeParse(parseJson(toBytes(data)))
      if (!parsed.success) { fail(socket, 'invalid-request', 'Text frames must be a resize message'); return }
      live.resize(parsed.data.cols, parsed.data.rows).catch((error: unknown) => { fail(socket, 'io-failure', describe(error)) })
    })
    // The snapshot was taken at the terminal's current size; the redraw the
    // viewer's own size triggers streams through the output listener above.
    if (live.cols !== cols || live.rows !== rows) await live.resize(cols, rows)
  } catch (error) {
    if (error instanceof TerminalError) fail(socket, error.kind, error.message)
    else fail(socket, 'io-failure', describe(error))
  }
}

function fail(socket: WebSocket, kind: string, message: string): void {
  sendJson(socket, { type: 'error', kind, message })
  if (socketOpen(socket)) socket.close(kind === 'invalid-request' ? 1008 : 1011, message.slice(0, 120))
}

function sendJson(socket: WebSocket, value: unknown): void {
  if (socketOpen(socket)) socket.send(JSON.stringify(value))
}

function socketOpen(socket: WebSocket): boolean {
  return socket.readyState === 1
}

function parseJson(bytes: Uint8Array): unknown {
  try {
    return JSON.parse(Buffer.from(bytes).toString('utf8')) as unknown
  } catch {
    return undefined
  }
}

function toBytes(data: WebSocket.RawData): Uint8Array {
  if (typeof data === 'string') return Buffer.from(data, 'utf8')
  if (Buffer.isBuffer(data)) return data
  if (Array.isArray(data)) return Buffer.concat(data)
  return Buffer.from(data)
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
