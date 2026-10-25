import type { FastifyPluginCallback } from 'fastify'

import type { GitRepositoryService } from '../../../core/contract/git-repository-service.js'
import type { GitAction, GitDiffArea } from '../../../core/resource/git-repository.js'
import { gitActionSchema, gitCommitSchema, gitDiffSchema, gitHistorySchema, gitRepositorySchema } from '../schema/git-repository-schema.js'

export const gitRepositoryRoutes: FastifyPluginCallback<{ service: GitRepositoryService }> = (fastify, { service }, done) => {
  fastify.addHook('onRequest', async (_request, reply) => { void reply.header('Cache-Control', 'no-store') })
  fastify.get<{ Querystring: { cwd: string } }>('/api/sandbox/git/repository', { schema: gitRepositorySchema },
    async (request) => await service.read(request.query.cwd))
  fastify.get<{ Querystring: { cwd: string; skip: number; limit: number } }>('/api/sandbox/git/history', { schema: gitHistorySchema },
    async (request) => await service.history(request.query.cwd, request.query.skip, request.query.limit))
  fastify.get<{ Querystring: { cwd: string; commit: string } }>('/api/sandbox/git/commit', { schema: gitCommitSchema },
    async (request) => await service.commit(request.query.cwd, request.query.commit))
  fastify.get<{ Querystring: { cwd: string; path: string; area: GitDiffArea; commit?: string } }>('/api/sandbox/git/diff', { schema: gitDiffSchema },
    async (request) => await service.diff(request.query.cwd, request.query.path, request.query.area, request.query.commit))
  fastify.post<{ Body: GitAction }>('/api/sandbox/git/action', { schema: gitActionSchema },
    async (request) => await service.action(request.body))
  done()
}
