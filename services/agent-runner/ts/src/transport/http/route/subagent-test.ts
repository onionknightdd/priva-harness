import { Readable } from 'node:stream'
import type { FastifyPluginCallback } from 'fastify'
import { z } from 'zod'

import type { ResourceService } from '../../../core/contract/resource-service.js'
import { ResourceError } from '../../../core/resource/resource-catalog.js'
import { rewriteProviderBaseUrl } from '../../../core/resource/run-harness.js'
import type { AgentHarness } from '../../../harness/agent-harness.js'
import type { AgentProfileService } from '../../../harness/config/agent-profile-service.js'
import type { ModelProfileService } from '../../../harness/config/model-profile-service.js'

function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value)
  if (!result.success) throw new ResourceError(422, result.error.issues.map((issue) => issue.message).join('; '))
  return result.data
}

export const subagentTestRoutes: FastifyPluginCallback<{
  service: ResourceService; harness: AgentHarness; models: ModelProfileService; profile: AgentProfileService; cwd: string
}> = (server, options, done) => {
  server.post('/api/sandbox/resource/subagents/:id/test/stream', async (request, reply) => {
    const query = parse(z.object({ harness: z.enum(['claude', 'pi']), cwd: z.string().optional() }), request.query)
    const { id } = parse(z.object({ id: z.string().regex(/^[A-Za-z0-9_-]{32}$/u) }), request.params)
    const { prompt, model } = parse(z.object({ prompt: z.string().trim().min(1).max(20000), model: z.string().min(1).optional() }).strict(), request.body)
    const context = { harness: query.harness, ...(query.cwd ? { cwd: query.cwd } : {}) }
    const original = await options.service.subagents.get(context, id)
    const cwd = query.cwd ?? original.source.cwd ?? options.cwd
    const detail = await options.service.subagents.get({ harness: query.harness, cwd }, id)
    if (!detail.enabled || detail.effective !== true) throw new ResourceError(409, 'This agent is disabled or overridden in the test project. Select its effective definition.')
    let modelRef = model
    if (!modelRef) {
      const list = await options.models.listProfiles()
      if (!list.defaultProfileId) throw new ResourceError(409, 'Configure a default model profile before testing')
      modelRef = (await options.models.getProfile(list.defaultProfileId)).defaultModel ?? undefined
    }
    if (!modelRef) throw new ResourceError(409, 'Select a default model before testing')
    const resolved = await options.models.resolve(modelRef)
    const profile = await options.profile.read()
    const controller = new AbortController()
    const abort = () => controller.abort()
    reply.raw.once('close', abort)
    const text = `Use the Agent tool to delegate the following task to subagent_type ${JSON.stringify(detail.name)}. Set run_in_background to false and wait for its result. Do not substitute a different subagent.\n\nTask:\n${prompt}`
    async function* events() {
      try {
        for await (const frame of options.harness.run({ text }, { signal: controller.signal }, {
          provider: query.harness, cwd, model: resolved.model,
          baseUrl: rewriteProviderBaseUrl(resolved.profile.baseUrl, query.harness), authToken: resolved.profile.authToken,
          profileId: resolved.profile.id, modelContext: resolved.capabilities.context, queueBehavior: profile.queueBehavior,
        }, { source: 'subagent-test', keepRuntimeWarm: false })) yield `data: ${JSON.stringify(frame)}\n\n`
      } catch (error) {
        if (!controller.signal.aborted) yield `data: ${JSON.stringify({ type: 'run.failed', message: error instanceof Error ? error.message : String(error) })}\n\n`
      } finally { reply.raw.off('close', abort); controller.abort() }
    }
    return reply.type('text/event-stream').header('Cache-Control', 'no-cache').header('X-Accel-Buffering', 'no').send(Readable.from(events()))
  })
  done()
}
