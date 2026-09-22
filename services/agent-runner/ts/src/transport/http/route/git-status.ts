import type { FastifyPluginCallback } from 'fastify'

import type { GitStatusReader } from '../../../core/contract/git-status-reader.js'
import { gitStatusSchema } from '../schema/git-status-schema.js'

export const gitStatusRoutes: FastifyPluginCallback<{ reader: GitStatusReader }> = (
  fastify, { reader }, done,
) => {
  fastify.get<{ Querystring: { cwd: string } }>(
    '/api/sandbox/git/status',
    { schema: gitStatusSchema },
    async (request, reply) => {
      void reply.header('Cache-Control', 'no-store')
      return await reader.read(request.query.cwd)
    },
  )
  done()
}
