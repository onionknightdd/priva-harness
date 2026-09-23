import type { FastifyPluginCallback } from 'fastify'
import { z } from 'zod'

import type { TerminalSessionState } from '../../../core/contract/terminal-service.js'
import type { AgentHarness } from '../../../harness/agent-harness.js'

export const TERMINAL_EVENTS_PATH = '/api/sandbox/agent/terminal/:harness/events'
const addressSchema = z.object({ harness: z.enum(['claude', 'pi']) })
const terminalSchema = z.object({ terminalId: z.string().regex(/^[a-f0-9]{24}$/u) })
const stateSchema = z.object({
  sessionId: z.string().min(1), instanceId: z.string().min(1), cwd: z.string().min(1), updatedAt: z.number().nonnegative(),
  phase: z.enum(['idle', 'running', 'exited']), event: z.enum(['ready', 'prompt', 'stop', 'failure', 'exit']),
  prompt: z.string().optional(), message: z.string().optional(),
  source: z.string().optional(), reason: z.string().optional(),
})
const questionSchema = z.object({ sessionId: z.string().min(1), instanceId: z.string().min(1), cwd: z.string().min(1),
  tool: z.string().optional(), toolUseId: z.string().optional(), agentId: z.string().optional(), input: z.record(z.string(), z.unknown()) })
const elicitationSchema = z.object({ sessionId: z.string().min(1), instanceId: z.string().min(1), cwd: z.string().min(1),
  serverName: z.string(), elicitationId: z.string().optional(), message: z.string(), schema: z.record(z.string(), z.unknown()).optional(), mode: z.enum(['form', 'url']).optional() })

export const terminalEventRoutes: FastifyPluginCallback<{ harness: AgentHarness }> = (fastify, options, done) => {
  fastify.post(TERMINAL_EVENTS_PATH, async (request, reply) => {
    // Hooks originate on the runner host. Browser and remote callers use the
    // session/terminal WebSockets, never the provider lifecycle ingress.
    if (!['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(request.ip)) return reply.code(403).send({ detail: 'Terminal events must originate on the runner host' })
    const address = addressSchema.safeParse(request.params)
    const terminal = terminalSchema.safeParse(request.body)
    const state = stateSchema.safeParse(request.body)
    if (!address.success || !state.success || !terminal.success) {
      return reply.code(400).send({ detail: 'Invalid terminal event' })
    }
    const { prompt, message, source, reason, ...required } = state.data
    const event: TerminalSessionState = { ...required, ...(prompt === undefined ? {} : { prompt }), ...(message === undefined ? {} : { message }),
      ...(source === undefined ? {} : { source }), ...(reason === undefined ? {} : { reason }) }
    const ref = await options.harness.sessionForTerminal(terminal.data.terminalId)
    if (ref?.provider !== address.data.harness) return reply.code(409).send({ detail: 'Terminal binding is no longer active' })
    await options.harness.terminalEvent(ref, event)
    return {}
  })
  fastify.post('/api/sandbox/agent/terminal/:harness/question', async (request, reply) => {
    if (!['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(request.ip)) return reply.code(403).send({ detail: 'Terminal hooks must originate on the runner host' })
    const address = addressSchema.safeParse(request.params)
    const terminal = terminalSchema.safeParse(request.body)
    const parsed = questionSchema.safeParse(request.body)
    if (!address.success || !parsed.success || !terminal.success) return reply.code(400).send({ detail: 'Invalid terminal question' })
    const ref = await options.harness.sessionForTerminal(terminal.data.terminalId)
    if (ref?.provider !== address.data.harness || parsed.data.sessionId !== ref.id) return reply.code(409).send({ detail: 'Terminal question belongs to an inactive session' })
    const { toolUseId, tool, agentId, ...question } = parsed.data
    const cancel = new AbortController()
    const disconnected = () => cancel.abort()
    reply.raw.once('close', disconnected)
    try {
      return await options.harness.terminalQuestion(ref,
        { ...question, ...(toolUseId ? { toolUseId } : {}), ...(tool ? { tool } : {}), ...(agentId ? { agentId } : {}) }, cancel.signal)
    } finally { reply.raw.off('close', disconnected) }
  })
  fastify.post('/api/sandbox/agent/terminal/:harness/elicitation', async (request, reply) => {
    if (!['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(request.ip)) return reply.code(403).send({ detail: 'Terminal hooks must originate on the runner host' })
    const address = addressSchema.safeParse(request.params), terminal = terminalSchema.safeParse(request.body), parsed = elicitationSchema.safeParse(request.body)
    if (!address.success || !parsed.success || !terminal.success) return reply.code(400).send({ detail: 'Invalid terminal elicitation' })
    const ref = await options.harness.sessionForTerminal(terminal.data.terminalId)
    if (ref?.provider !== address.data.harness || parsed.data.sessionId !== ref.id) return reply.code(409).send({ detail: 'Terminal elicitation belongs to an inactive session' })
    const { schema, mode, elicitationId, ...input } = parsed.data
    const cancel = new AbortController(), disconnected = () => cancel.abort()
    reply.raw.once('close', disconnected)
    try { return await options.harness.terminalElicitation(ref, { ...input, ...(schema ? { schema } : {}), ...(mode ? { mode } : {}), ...(elicitationId ? { elicitationId } : {}) }, cancel.signal) }
    finally { reply.raw.off('close', disconnected) }
  })
  done()
}
