import { A2uiError } from '@a2ui/agent'
import type { FastifyPluginCallback } from 'fastify'
import { z } from 'zod'
import { A2uiSourceError, compileA2uiSource } from '../../../core/a2ui/compiler.js'

const compileRequestSchema = z.object({ source: z.string() }).strict()

export const a2uiRoutes: FastifyPluginCallback = (server, _options, done) => {
  server.setErrorHandler((error, request, reply) => {
    if (error instanceof z.ZodError) {
      void reply.code(400).send({ error: 'Provide a JSON object containing only source, a complete A2UI Express string.' })
      return
    }
    if (error instanceof A2uiError || error instanceof A2uiSourceError) {
      void reply.code(422).send({ error: `A2UI source is invalid: ${error.message}` })
      return
    }
    if (error instanceof Error && 'statusCode' in error && typeof error.statusCode === 'number' && error.statusCode >= 400 && error.statusCode < 500) {
      void reply.code(error.statusCode).send({ error: error.message })
      return
    }
    request.log.error({ err: error }, 'A2UI compilation failed')
    void reply.code(500).send({ error: 'Could not compile this visualization.' })
  })
  // Allow JSON escaping overhead; the compiler separately limits source characters.
  server.post('/api/sandbox/a2ui/compile', { bodyLimit: 512 * 1024 }, (request) => {
    const { source } = compileRequestSchema.parse(request.body)
    return compileA2uiSource(source)
  })
  done()
}
