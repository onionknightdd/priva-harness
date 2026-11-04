import type { FastifyPluginCallback } from 'fastify'
import { z } from 'zod'
import type { ModelAssets, ModelSource, PointClouds } from '../../../core/contract/model-assets.js'
import { ResourceError } from '../../../core/resource/resource-catalog.js'
import { sendFile } from '../send-file.js'

const sourceSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('file'), path: z.string().min(1) }),
  z.object({ kind: z.literal('skill'), path: z.string().min(1), skillId: z.string().min(1),
    harness: z.enum(['claude', 'pi']), cwd: z.string().optional() }),
])
const querySchema = z.object({ source: z.enum(['file', 'skill']), path: z.string().min(1),
  skillId: z.string().optional(), harness: z.enum(['claude', 'pi']).optional(), cwd: z.string().optional(),
  resource: z.string().optional() })

export const modelAssetRoutes: FastifyPluginCallback<{ assets: ModelAssets; pointClouds?: PointClouds }> = (server, options, done) => {
  server.get('/api/sandbox/models/inspect', async (request) => {
    const { source } = parseQuery(request.query)
    const result = await options.assets.inspect(source)
    return { name: result.name, path: result.path, size: result.size, revision: result.revision,
      mediaType: result.mimeType, pointCloud: result.pointCloud }
  })
  server.get('/api/sandbox/models/asset', async (request, reply) => {
    const { source, resource } = parseQuery(request.query)
    return await sendFile(request, reply, await options.assets.resolve(source, resource))
  })
  const pointClouds = options.pointClouds
  if (pointClouds !== undefined) {
    server.post('/api/sandbox/pointclouds', async (request, reply) => {
      const body = z.object({ source: sourceSchema }).safeParse(request.body)
      if (!body.success) throw new ResourceError(422, 'Expected a file or skill point-cloud source')
      const job = await pointClouds.prepare(toSource(body.data.source))
      return await reply.code(job.status === 'ready' ? 200 : 202).send(job)
    })
    server.get<{ Params: { id: string } }>('/api/sandbox/pointclouds/:id', async (request) => await pointClouds.get(request.params.id))
    server.delete<{ Params: { id: string } }>('/api/sandbox/pointclouds/:id', async (request) => {
      const query = z.object({ consumer: z.uuid() }).safeParse(request.query)
      if (!query.success) throw new ResourceError(422, 'A point-cloud consumer token is required')
      return await pointClouds.cancel(request.params.id, query.data.consumer)
    })
    server.get<{ Params: { id: string } }>('/api/sandbox/pointclouds/:id/asset', async (request, reply) => {
      const file = await pointClouds.asset(request.params.id)
      let released = false
      const release = (): void => { if (!released) { released = true; pointClouds.release(request.params.id) } }
      reply.raw.once('finish', release)
      reply.raw.once('close', release)
      if (reply.raw.destroyed) release()
      try { return await sendFile(request, reply, file) } catch (error) { release(); throw error }
    })
    server.addHook('onClose', async () => { await pointClouds.close() })
  }
  done()
}

function parseQuery(input: unknown): { source: ModelSource; resource?: string } {
  const query = querySchema.safeParse(input)
  if (!query.success) throw new ResourceError(422, 'Expected a model source and path')
  const parsed = sourceSchema.safeParse({ ...query.data, kind: query.data.source })
  if (!parsed.success) throw new ResourceError(422, 'Skill models require skillId and harness')
  return { source: toSource(parsed.data), ...(query.data.resource === undefined ? {} : { resource: query.data.resource }) }
}

function toSource(source: z.infer<typeof sourceSchema>): ModelSource {
  if (source.kind === 'file') return source
  return { kind: source.kind, path: source.path, skillId: source.skillId, harness: source.harness,
    ...(source.cwd === undefined ? {} : { cwd: source.cwd }) }
}
